/**
 * Pure parser for Antigravity's on-disk conversation stores.
 *
 * The other three providers append JSONL. `agy` does not: every conversation is
 * its own SQLite database under `conversations/<id>.db`, and the rows that carry
 * usage are protobuf blobs shipped without a schema. So this module is a small
 * wire-format reader plus the handful of field numbers we need, and the SQLite
 * read itself lives in `usageTranscriptReader`.
 *
 * The field numbers below were fixed against ground truth rather than guessed:
 * running `agy -p --output-format stream-json` prints a `usage` object with
 * named keys, and summing the per-step blobs of the resulting conversation
 * reproduces the CLI's own `input_tokens` / `output_tokens` / `thinking_tokens`
 * exactly. Anything unrecognised is skipped, so a field added upstream costs a
 * blob we cannot read rather than a wrong number.
 *
 * @module antigravityTranscripts
 */
import type { UsageTokenTotals } from "@t3tools/contracts";

import { totalTokens, type UsageRecord } from "./usageTranscripts.ts";

/* -------------------------------------------------------------------------- */
/* Minimal protobuf wire reader                                               */
/* -------------------------------------------------------------------------- */

const WIRE_VARINT = 0;
const WIRE_I64 = 1;
const WIRE_LEN = 2;
const WIRE_I32 = 5;

interface WireField {
  readonly field: number;
  /** Present for varint fields. Values beyond 2^53 are not used by any field we read. */
  readonly value: number;
  /** Present for length-delimited fields. */
  readonly bytes: Uint8Array | null;
}

/**
 * Walks a protobuf message, yielding one entry per encoded field.
 *
 * Stops at the first malformed byte rather than throwing: these blobs come off
 * a database another process is actively writing, and a truncated tail should
 * cost the fields after it, not the whole conversation.
 */
function* readFields(buffer: Uint8Array): Generator<WireField> {
  let offset = 0;

  const varint = (): number | null => {
    let result = 0;
    let shift = 0;
    while (offset < buffer.length) {
      const byte = buffer[offset] as number;
      offset += 1;
      // Beyond 2^53 the arithmetic below stops being exact. No field we read is
      // ever that large, so give up rather than return a rounded value.
      if (shift > 49) return null;
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
    return null;
  };

  while (offset < buffer.length) {
    const key = varint();
    if (key === null) return;
    const field = Math.floor(key / 8);
    const wireType = key % 8;

    if (wireType === WIRE_VARINT) {
      const value = varint();
      if (value === null) return;
      yield { field, value, bytes: null };
      continue;
    }
    if (wireType === WIRE_LEN) {
      const length = varint();
      if (length === null || offset + length > buffer.length) return;
      yield { field, value: 0, bytes: buffer.subarray(offset, offset + length) };
      offset += length;
      continue;
    }
    if (wireType === WIRE_I64) {
      if (offset + 8 > buffer.length) return;
      offset += 8;
      continue;
    }
    if (wireType === WIRE_I32) {
      if (offset + 4 > buffer.length) return;
      offset += 4;
      continue;
    }
    // Groups (3, 4) are not emitted by this producer and cannot be skipped
    // safely without a matching end marker.
    return;
  }
}

function submessage(buffer: Uint8Array, field: number): Uint8Array | null {
  for (const entry of readFields(buffer)) {
    if (entry.field === field && entry.bytes !== null) return entry.bytes;
  }
  return null;
}

function varintField(buffer: Uint8Array, field: number): number {
  for (const entry of readFields(buffer)) {
    if (entry.field === field && entry.bytes === null) return entry.value;
  }
  return 0;
}

function stringField(buffer: Uint8Array, field: number): string {
  const bytes = submessage(buffer, field);
  return bytes === null ? "" : new TextDecoder().decode(bytes);
}

/** Packed varints, as protobuf encodes a `repeated int32` field. */
function packedVarints(buffer: Uint8Array): readonly number[] {
  const values: number[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    let result = 0;
    let shift = 0;
    let complete = false;
    while (offset < buffer.length) {
      const byte = buffer[offset] as number;
      offset += 1;
      if (shift > 28) return values;
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) {
        complete = true;
        break;
      }
      shift += 7;
    }
    if (!complete) return values;
    values.push(result);
  }
  return values;
}

/* -------------------------------------------------------------------------- */
/* Field numbers                                                              */
/* -------------------------------------------------------------------------- */

/** `steps.metadata`. */
const STEP_CREATED_AT = 1;
const STEP_USAGE = 9;

/** `google.protobuf.Timestamp`. */
const TIMESTAMP_SECONDS = 1;
const TIMESTAMP_NANOS = 2;

/**
 * The usage submessage, shared by `steps.metadata` and `gen_metadata`.
 *
 * Field 1 is a constant per system prompt (1298 on a normal turn, 1050 on the
 * CLI's internal checkpoint run) and is absent from every figure the CLI itself
 * reports, so it is deliberately not read. Input and cache reads are disjoint:
 * the CLI's own `total_tokens` is `input + output + cache_read`.
 */
const USAGE_UNCACHED_INPUT = 2;
const USAGE_OUTPUT = 3;
const USAGE_CACHE_READ = 5;
const USAGE_REASONING = 9;

/** `gen_metadata.data`. */
const GEN_RECORD = 1;
const GEN_STEP_INDICES = 2;
const GEN_MODEL = 19;

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

export interface AntigravityStepRow {
  readonly idx: number;
  readonly metadata: Uint8Array | null;
}

export interface AntigravityConversation {
  /** The conversation id, which is the database's own filename. */
  readonly conversationId: string;
  readonly steps: readonly AntigravityStepRow[];
  /** `gen_metadata.data` blobs, in any order. */
  readonly generations: readonly (Uint8Array | null)[];
}

function readTimestampMs(metadata: Uint8Array): number | null {
  const stamp = submessage(metadata, STEP_CREATED_AT);
  if (stamp === null) return null;
  const seconds = varintField(stamp, TIMESTAMP_SECONDS);
  if (seconds <= 0) return null;
  return seconds * 1000 + Math.floor(varintField(stamp, TIMESTAMP_NANOS) / 1e6);
}

function readTotals(usage: Uint8Array): UsageTokenTotals {
  const outputTokens = varintField(usage, USAGE_OUTPUT);
  return {
    uncachedInputTokens: varintField(usage, USAGE_UNCACHED_INPUT),
    cachedInputTokens: varintField(usage, USAGE_CACHE_READ),
    // Antigravity reports no cache-write figure of its own. Reporting the cache
    // reads as writes would price them at a premium instead of a discount.
    cacheCreationTokens: 0,
    outputTokens,
    // Reported inside the output count, surfaced separately for the token mix.
    reasoningTokens: Math.min(outputTokens, varintField(usage, USAGE_REASONING)),
  };
}

/**
 * Maps step index to the model that produced it.
 *
 * A `gen_metadata` row names its model once and lists the step indices that
 * generation wrote, so this is the only place a model appears in the store. The
 * row repeats the steps' usage as well, which is why usage is read from the
 * steps alone -- counting both would double every turn.
 */
function readModelByStep(generations: readonly (Uint8Array | null)[]): ReadonlyMap<number, string> {
  const byStep = new Map<number, string>();
  for (const blob of generations) {
    if (blob === null) continue;
    const record = submessage(blob, GEN_RECORD);
    if (record === null) continue;
    const model = stringField(record, GEN_MODEL).trim();
    if (model.length === 0) continue;
    const indices = submessage(blob, GEN_STEP_INDICES);
    if (indices === null) continue;
    for (const step of packedVarints(indices)) byStep.set(step, model);
  }
  return byStep;
}

/**
 * Turns one conversation's rows into usage records, one per step that billed
 * tokens.
 *
 * Steps the CLI runs for itself -- the checkpoint pass that follows a turn --
 * carry usage but never a `gen_metadata` row, so their model is carried forward
 * from the preceding generation the way Codex carries a model across
 * `turn_context`. A conversation that opens with one of those instead borrows
 * the first model named anywhere in the file, since the whole conversation is
 * in hand here rather than arriving as a stream.
 */
export function parseAntigravityConversation(
  conversation: AntigravityConversation,
): readonly UsageRecord[] {
  const modelByStep = readModelByStep(conversation.generations);
  if (modelByStep.size === 0) return [];

  const ordered = [...conversation.steps].sort((a, b) => a.idx - b.idx);
  const firstModel = ordered.reduce<string | null>(
    (found, step) => found ?? modelByStep.get(step.idx) ?? null,
    null,
  );
  if (firstModel === null) return [];

  const records: UsageRecord[] = [];
  let currentModel = firstModel;

  for (const step of ordered) {
    const named = modelByStep.get(step.idx);
    if (named !== undefined) currentModel = named;
    if (step.metadata === null) continue;

    const usage = submessage(step.metadata, STEP_USAGE);
    if (usage === null) continue;

    const timestampMs = readTimestampMs(step.metadata);
    if (timestampMs === null) continue;

    const totals = readTotals(usage);
    if (totalTokens(totals) === 0) continue;

    records.push({
      provider: "antigravity",
      timestampMs,
      model: currentModel,
      sessionId: conversation.conversationId,
      totals,
      // Antigravity records no cost of its own; the rate table prices it.
      reportedCostUsd: null,
      // A step is unique within its conversation, which is what makes this
      // stable across a store being copied and across the CLI and the editor
      // both holding a copy of the same conversation.
      dedupeKey: `${conversation.conversationId}:${step.idx}`,
    });
  }

  return records;
}

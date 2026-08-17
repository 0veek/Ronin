import { describe, expect, it } from "@effect/vitest";

import {
  type AntigravityConversation,
  parseAntigravityConversation,
} from "./antigravityTranscripts.ts";

/* -------------------------------------------------------------------------- */
/* Protobuf fixtures                                                          */
/* -------------------------------------------------------------------------- */

function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  do {
    const byte = rest % 128;
    rest = Math.floor(rest / 128);
    bytes.push(rest > 0 ? byte | 0x80 : byte);
  } while (rest > 0);
  return bytes;
}

function scalar(field: number, value: number): number[] {
  return [...varint(field * 8), ...varint(value)];
}

function bytes(field: number, payload: readonly number[]): number[] {
  return [...varint(field * 8 + 2), ...varint(payload.length), ...payload];
}

function text(field: number, value: string): number[] {
  return bytes(field, [...new TextEncoder().encode(value)]);
}

function packed(field: number, values: readonly number[]): number[] {
  return bytes(field, values.flatMap(varint));
}

const STEP_CREATED_AT = 1;
const STEP_USAGE = 9;
const GEN_RECORD = 1;
const GEN_STEP_INDICES = 2;
const GEN_MODEL = 19;

/** `agy` stamps every step with a `google.protobuf.Timestamp`. */
function stepMetadata(input: {
  readonly seconds: number;
  readonly nanos?: number;
  readonly usage?: {
    readonly uncachedInput?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly reasoning?: number;
  };
}): Uint8Array {
  const parts = [
    ...bytes(STEP_CREATED_AT, [...scalar(1, input.seconds), ...scalar(2, input.nanos ?? 0)]),
  ];
  if (input.usage !== undefined) {
    parts.push(
      ...bytes(STEP_USAGE, [
        // Field 1 is the constant per-system-prompt baseline the CLI excludes
        // from every figure it reports. Present here so the parser is exercised
        // against a blob carrying it.
        ...scalar(1, 1298),
        ...scalar(2, input.usage.uncachedInput ?? 0),
        ...scalar(3, input.usage.output ?? 0),
        ...(input.usage.cacheRead === undefined ? [] : scalar(5, input.usage.cacheRead)),
        ...(input.usage.reasoning === undefined ? [] : scalar(9, input.usage.reasoning)),
      ]),
    );
  }
  return new Uint8Array(parts);
}

/** A `gen_metadata` row: the model, and the steps that generation wrote. */
function generation(model: string, steps: readonly number[]): Uint8Array {
  return new Uint8Array([
    ...packed(GEN_STEP_INDICES, steps),
    // The row repeats the steps' usage. Included so the test proves it is not
    // counted a second time.
    ...bytes(GEN_RECORD, [
      ...bytes(4, [...scalar(2, 999_999), ...scalar(3, 999_999)]),
      ...text(GEN_MODEL, model),
    ]),
  ]);
}

function conversation(overrides: Partial<AntigravityConversation> = {}): AntigravityConversation {
  return {
    conversationId: "4f4f0139-bb22-4999-998e-e37500a88c12",
    steps: [
      { idx: 0, metadata: stepMetadata({ seconds: 1_786_951_387 }) },
      {
        idx: 2,
        metadata: stepMetadata({
          seconds: 1_786_951_387,
          nanos: 355_132_671,
          usage: { uncachedInput: 14_965, output: 24, reasoning: 22 },
        }),
      },
    ],
    generations: [generation("gemini-3.7-flash", [2])],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */

describe("parseAntigravityConversation", () => {
  it("reads one record per billing step, from the step rather than the generation", () => {
    const records = parseAntigravityConversation(conversation());

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      provider: "antigravity",
      timestampMs: 1_786_951_387_355,
      model: "gemini-3.7-flash",
      sessionId: "4f4f0139-bb22-4999-998e-e37500a88c12",
      totals: {
        uncachedInputTokens: 14_965,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 24,
        reasoningTokens: 22,
      },
      reportedCostUsd: null,
      dedupeKey: "4f4f0139-bb22-4999-998e-e37500a88c12:2",
    });
  });

  it("keeps cache reads disjoint from uncached input", () => {
    const records = parseAntigravityConversation(
      conversation({
        steps: [
          {
            idx: 2,
            metadata: stepMetadata({
              seconds: 1_786_951_387,
              usage: { uncachedInput: 2287, output: 85, cacheRead: 16_252 },
            }),
          },
        ],
      }),
    );

    // The CLI's own total for this turn is input + output + cache_read, so the
    // two input figures must not overlap.
    expect(records[0]?.totals.uncachedInputTokens).toBe(2287);
    expect(records[0]?.totals.cachedInputTokens).toBe(16_252);
    expect(records[0]?.totals.cacheCreationTokens).toBe(0);
  });

  it("clamps reasoning to the output it is reported inside", () => {
    const records = parseAntigravityConversation(
      conversation({
        steps: [
          {
            idx: 2,
            metadata: stepMetadata({
              seconds: 1_786_951_387,
              usage: { uncachedInput: 10, output: 24, reasoning: 900 },
            }),
          },
        ],
      }),
    );

    expect(records[0]?.totals.reasoningTokens).toBe(24);
  });

  it("carries the model forward onto the checkpoint step that follows a turn", () => {
    const records = parseAntigravityConversation(
      conversation({
        steps: [
          {
            idx: 2,
            metadata: stepMetadata({
              seconds: 1_786_951_387,
              usage: { uncachedInput: 14_965, output: 24 },
            }),
          },
          // The CLI's own checkpoint pass bills tokens but never gets a
          // gen_metadata row of its own.
          {
            idx: 3,
            metadata: stepMetadata({
              seconds: 1_786_951_390,
              usage: { uncachedInput: 98, output: 3 },
            }),
          },
        ],
      }),
    );

    expect(records.map((record) => record.model)).toEqual(["gemini-3.7-flash", "gemini-3.7-flash"]);
  });

  it("borrows the first named model for a leading unattributed step", () => {
    const records = parseAntigravityConversation(
      conversation({
        steps: [
          {
            idx: 1,
            metadata: stepMetadata({
              seconds: 1_786_951_380,
              usage: { uncachedInput: 40, output: 2 },
            }),
          },
          {
            idx: 2,
            metadata: stepMetadata({
              seconds: 1_786_951_387,
              usage: { uncachedInput: 14_965, output: 24 },
            }),
          },
        ],
      }),
    );

    expect(records.map((record) => record.model)).toEqual(["gemini-3.7-flash", "gemini-3.7-flash"]);
  });

  it("switches model at the step the next generation claims", () => {
    const records = parseAntigravityConversation(
      conversation({
        steps: [
          {
            idx: 2,
            metadata: stepMetadata({ seconds: 1, usage: { uncachedInput: 10, output: 1 } }),
          },
          {
            idx: 6,
            metadata: stepMetadata({ seconds: 2, usage: { uncachedInput: 20, output: 2 } }),
          },
        ],
        generations: [generation("gemini-3.7-flash", [2]), generation("claude-sonnet-4-6", [6])],
      }),
    );

    expect(records.map((record) => record.model)).toEqual([
      "gemini-3.7-flash",
      "claude-sonnet-4-6",
    ]);
  });

  it("drops steps that billed nothing", () => {
    const records = parseAntigravityConversation(
      conversation({
        steps: [
          {
            idx: 2,
            metadata: stepMetadata({ seconds: 1, usage: { uncachedInput: 0, output: 0 } }),
          },
        ],
      }),
    );

    expect(records).toEqual([]);
  });

  it("reports nothing when no generation names a model", () => {
    expect(parseAntigravityConversation(conversation({ generations: [] }))).toEqual([]);
    expect(parseAntigravityConversation(conversation({ generations: [null] }))).toEqual([]);
  });

  it("survives a store truncated mid-write", () => {
    const full = conversation();
    const complete = full.steps[1]?.metadata as Uint8Array;

    // These are read off a database another process is appending to, so a
    // partial blob has to cost its own record rather than the conversation.
    for (let length = 0; length < complete.length; length += 1) {
      expect(() =>
        parseAntigravityConversation({
          ...full,
          steps: [{ idx: 2, metadata: complete.subarray(0, length) }],
        }),
      ).not.toThrow();
    }
  });
});

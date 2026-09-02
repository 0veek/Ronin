// @effect-diagnostics nodeBuiltinImport:off
/**
 * Raw filesystem access for transcript scanning.
 *
 * Isolated here so the rest of the usage code stays on Effect's `FileSystem`.
 * The direct `node:fs` streaming is deliberate: a cold 30-day window is ~1.4 GB
 * across ~1,500 files, and buffer-level streaming is roughly an order of
 * magnitude cheaper than materialising each file. The equivalent Effect stream
 * pipeline is idiomatic but not fast enough to sit behind a page load.
 *
 * Transcripts are append-only, so a parse also reports the byte position it
 * stopped at. A later scan of the same file resumes from that position and
 * parses only the appended bytes, which is what keeps a warm scan cheap while a
 * session is actively writing a multi-hundred-megabyte rollout.
 *
 * @module usageTranscriptReader
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { UsageProviderKind } from "@t3tools/contracts";

import { type AntigravityStepRow, parseAntigravityConversation } from "./antigravityTranscripts.ts";
import {
  initialCodexScanState,
  mightCarryUsage,
  parseClaudeLine,
  parseCodexLine,
  parseGrokLine,
  type CodexScanState,
  type UsageRecord,
} from "./usageTranscripts.ts";

export interface TranscriptFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * Where a parse stopped, with enough state to continue from there.
 *
 * The guard hash fingerprints the bytes immediately before `resumeOffset`. A
 * resume only proceeds when those bytes still match: transcripts are
 * append-only by design, but a rotated or rewritten file silently mis-parsed
 * from the middle would corrupt usage totals. The window is a cheap tripwire
 * for those realistic failure shapes, all of which disturb the file's tail at
 * that exact offset; it deliberately does not hash the whole prefix, which
 * would cost the full re-read the resume exists to avoid.
 */
export interface TranscriptParsePosition {
  /** Byte offset just past the last newline-terminated line consumed. */
  readonly resumeOffset: number;
  /** Length of the fingerprinted window ending at `resumeOffset`. */
  readonly guardLength: number;
  /** FNV-1a hash of that window. */
  readonly guardHash: number;
  /** Codex reducer state as of `resumeOffset`; `null` for stateless providers. */
  readonly codexState: CodexScanState | null;
}

export interface TranscriptParseResult {
  /** Records from newline-terminated lines at or after the parse start. */
  readonly records: readonly UsageRecord[];
  /**
   * Records from a trailing segment the writer has not newline-terminated yet.
   * Kept out of `records` because `position` deliberately excludes that
   * segment: the next scan re-reads it once the writer finishes the line.
   */
  readonly tailRecords: readonly UsageRecord[];
  readonly position: TranscriptParsePosition;
  /** Whether the parse continued from `resumeFrom` rather than byte 0. */
  readonly resumed: boolean;
}

/** 64 bytes of JSONL tail is ample to distinguish a replaced file. */
export const GUARD_LENGTH = 64;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * A store read whole rather than streamed reports no resumable position, so
 * `readTranscriptRecords` always re-parses it from scratch.
 */
const WHOLE_FILE_POSITION: TranscriptParsePosition = {
  resumeOffset: 0,
  guardLength: 0,
  guardHash: 0,
  codexState: null,
};

function fnv1a(buffer: Buffer): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < buffer.length; index += 1) {
    hash ^= buffer[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Lists `.jsonl` transcripts under `root` last modified at or after `sinceMs`.
 *
 * `fileName` narrows the walk to one basename. Grok keeps four `.jsonl` files
 * per session and only `updates.jsonl` carries usage; without the filter every
 * scan would also stream the chat history, which is the bulk of the bytes and
 * none of the answer.
 *
 * Errors on individual entries are swallowed: session files rotate and get
 * removed while the walk is in flight, and a partial listing is far better than
 * failing the page.
 */
export async function listTranscriptFiles(
  root: string,
  sinceMs: number,
  fileName?: string,
): Promise<readonly TranscriptFile[]> {
  const found: TranscriptFile[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await NodeFSP.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (fileName === undefined ? !entry.name.endsWith(".jsonl") : entry.name !== fileName) {
        continue;
      }
      try {
        const stats = await NodeFSP.stat(child);
        if (stats.mtimeMs >= sinceMs) {
          found.push({ path: child, size: stats.size, mtimeMs: stats.mtimeMs });
        }
      } catch {
        // Vanished between readdir and stat.
      }
    }
  };

  await walk(root);
  return found;
}

/**
 * Lists Antigravity conversation stores under `root` touched at or after
 * `sinceMs`.
 *
 * The reported size and mtime cover the write-ahead log as well as the database
 * itself, because they are the scan cache's key and the database file alone is
 * a poor witness to change: SQLite appends to the `-wal` sibling and only folds
 * it back on a checkpoint, so a conversation can gain half a megabyte of turns
 * while its `.db` keeps the same size and mtime for hours. Keyed on the pair,
 * every write invalidates.
 */
export async function listAntigravityConversations(
  root: string,
  sinceMs: number,
): Promise<readonly TranscriptFile[]> {
  let entries;
  try {
    entries = await NodeFSP.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: TranscriptFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".db")) continue;
    const child = NodePath.join(root, entry.name);
    try {
      const database = await NodeFSP.stat(child);
      const log = await NodeFSP.stat(`${child}-wal`).catch(() => null);
      const size = database.size + (log?.size ?? 0);
      const mtimeMs = Math.max(database.mtimeMs, log?.mtimeMs ?? 0);
      if (mtimeMs >= sinceMs) found.push({ path: child, size, mtimeMs });
    } catch {
      // Vanished between readdir and stat.
    }
  }
  return found;
}

/**
 * Filesystem identity of a directory, as `device:inode`.
 *
 * Used to tell "two servers reading the same transcript directory" apart from
 * "two machines whose hostname and home path happen to match". Returns an empty
 * string when the directory cannot be stat'd.
 */
export async function readDirectoryVolumeId(path: string): Promise<string> {
  try {
    const stats = await NodeFSP.stat(path);
    return `${stats.dev}:${stats.ino}`;
  } catch {
    return "";
  }
}

/** The two rowsets an Antigravity conversation store contributes. */
interface ConversationRows {
  readonly steps: readonly AntigravityStepRow[];
  readonly generations: readonly (Uint8Array | null)[];
}

type ConversationReader = (filePath: string) => ConversationRows;

/**
 * Opens conversation stores read-only, on whichever SQLite binding this runtime
 * has.
 *
 * Node and Bun ship incompatible built-ins -- Bun has no `node:sqlite` and Node
 * has no `bin:sqlite` -- so the binding is resolved once, the same way the
 * persistence layer picks its client. Read-only is not a detail: this is the
 * developer's live Antigravity install, open in another process, and a scan must
 * never be able to write to it.
 */
let conversationReader: Promise<ConversationReader | null> | null = null;

/** Column reads, defensive because both bindings type a row as `unknown`. */
function blobColumn(row: unknown, column: string): Uint8Array | null {
  const value = (row as Record<string, unknown> | null)?.[column];
  return value instanceof Uint8Array ? value : null;
}

function stepRow(row: unknown): AntigravityStepRow {
  const idx = Number((row as Record<string, unknown> | null)?.["idx"]);
  return { idx: Number.isFinite(idx) ? idx : -1, metadata: blobColumn(row, "metadata") };
}

function toRows(steps: readonly unknown[], generations: readonly unknown[]): ConversationRows {
  return {
    steps: steps.map(stepRow),
    generations: generations.map((row) => blobColumn(row, "data")),
  };
}

const STEPS_QUERY = "select idx, metadata from steps";
const GENERATIONS_QUERY = "select data from gen_metadata";

function loadConversationReader(): Promise<ConversationReader | null> {
  conversationReader ??= (async (): Promise<ConversationReader> => {
    if (process.versions.bun !== undefined) {
      const { Database } = await import(/* @vite-ignore */ "bun:sqlite");
      return (filePath: string) => {
        const database = new Database(filePath, { readonly: true });
        try {
          return toRows(
            database.query(STEPS_QUERY).all() as readonly unknown[],
            database.query(GENERATIONS_QUERY).all() as readonly unknown[],
          );
        } finally {
          database.close();
        }
      };
    }

    const { DatabaseSync } = await import("node:sqlite");
    return (filePath: string) => {
      const database = new DatabaseSync(filePath, { readOnly: true });
      try {
        return toRows(
          database.prepare(STEPS_QUERY).all(),
          database.prepare(GENERATIONS_QUERY).all(),
        );
      } finally {
        database.close();
      }
    };
  })().catch(() => null);

  return conversationReader;
}

/**
 * Reads one Antigravity conversation store, or `null` when it could not be
 * opened.
 *
 * A store the CLI is mid-write on is a normal transient failure -- a read-only
 * connection cannot always attach to a WAL database whose shared-memory file it
 * may not create -- and `null` keeps it out of the scan cache so the next scan
 * tries again.
 */
async function readAntigravityRecords(filePath: string): Promise<readonly UsageRecord[] | null> {
  const read = await loadConversationReader();
  if (read === null) return null;

  let rows: ConversationRows;
  try {
    rows = read(filePath);
  } catch {
    return null;
  }

  return parseAntigravityConversation({
    conversationId: NodePath.basename(filePath, ".db"),
    steps: rows.steps,
    generations: rows.generations,
  });
}

async function guardMatches(
  handle: NodeFSP.FileHandle,
  position: TranscriptParsePosition,
): Promise<boolean> {
  if (position.guardLength <= 0 || position.guardLength > GUARD_LENGTH) return false;
  try {
    const window = Buffer.alloc(position.guardLength);
    const { bytesRead } = await handle.read(
      window,
      0,
      position.guardLength,
      position.resumeOffset - position.guardLength,
    );
    return bytesRead === position.guardLength && fnv1a(window) === position.guardHash;
  } catch {
    return false;
  }
}

/**
 * Streams one transcript and returns the usage records it contains, or `null`
 * when the file could not be read.
 *
 * `null` is deliberately distinct from an empty transcript: a read that failed
 * midway must not be cached as "this file has no usage", because a later hit
 * under the same `(size, mtime)` key would silently drop that file's usage
 * until the file next changes.
 *
 * With `resumeFrom`, parsing continues from that position when its guard bytes
 * still match, so only appended lines are read; otherwise the whole file is
 * re-parsed from the start and `resumed` reports `false`.
 *
 * Codex carries the active model on `turn_context` lines that hold no usage of
 * their own, so those still have to pass through the reducer to keep model
 * attribution correct.
 */
export async function readTranscriptRecords(
  filePath: string,
  provider: UsageProviderKind,
  resumeFrom?: TranscriptParsePosition,
): Promise<TranscriptParseResult | null> {
  if (provider === "antigravity") {
    // The conversation store is a SQLite database read whole, not an
    // append-only line log, so it has no resumable position.
    const records = await readAntigravityRecords(filePath);
    return records === null
      ? null
      : { records, tailRecords: [], position: WHOLE_FILE_POSITION, resumed: false };
  }

  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(filePath, "r");
  } catch {
    return null;
  }

  try {
    let codexState = initialCodexScanState();
    let resumed = false;
    let start = 0;
    if (
      resumeFrom !== undefined &&
      resumeFrom.resumeOffset > 0 &&
      (provider !== "codex" || resumeFrom.codexState !== null) &&
      (await guardMatches(handle, resumeFrom))
    ) {
      if (resumeFrom.codexState !== null) codexState = { ...resumeFrom.codexState };
      start = resumeFrom.resumeOffset;
      resumed = true;
    }

    const parseLine = (line: string, state: CodexScanState, out: UsageRecord[]): void => {
      if (provider === "codex") {
        if (
          !mightCarryUsage(line, provider) &&
          !line.includes('"turn_context"') &&
          !line.includes('"session_meta"')
        ) {
          return;
        }
        const record = parseCodexLine(line, state);
        if (record !== null) out.push(record);
        return;
      }
      if (!mightCarryUsage(line, provider)) return;
      if (provider === "grok") {
        for (const grokRecord of parseGrokLine(line)) out.push(grokRecord);
        return;
      }
      const record = parseClaudeLine(line);
      if (record !== null) out.push(record);
    };

    const toLineString = (lineBuffer: Buffer): string => {
      const content =
        lineBuffer.length > 0 && lineBuffer[lineBuffer.length - 1] === CARRIAGE_RETURN
          ? lineBuffer.subarray(0, -1)
          : lineBuffer;
      return content.toString("utf8");
    };

    const records: UsageRecord[] = [];
    // Buffer-level line splitting rather than `readline`, because resuming
    // needs byte-exact offsets and decoded strings cannot provide them.
    // Newline-free chunks are collected rather than concatenated as they
    // arrive, so a single huge line costs one copy instead of one per chunk.
    let resumeOffset = start;
    let pendingChunks: Buffer[] = [];
    const stream = handle.createReadStream({
      start,
      autoClose: false,
    }) as AsyncIterable<Buffer>;
    for await (const chunk of stream) {
      if (!chunk.includes(NEWLINE)) {
        pendingChunks.push(chunk);
        continue;
      }
      const buffer: Buffer =
        pendingChunks.length === 0 ? chunk : Buffer.concat([...pendingChunks, chunk]);
      pendingChunks = [];
      let lineStart = 0;
      for (;;) {
        const newlineIndex = buffer.indexOf(NEWLINE, lineStart);
        if (newlineIndex === -1) break;
        parseLine(toLineString(buffer.subarray(lineStart, newlineIndex)), codexState, records);
        lineStart = newlineIndex + 1;
      }
      resumeOffset += lineStart;
      if (lineStart < buffer.length) pendingChunks.push(buffer.subarray(lineStart));
    }

    // A trailing segment without its newline is parsed for this result but not
    // consumed: a writer may still be appending to it, and counting a half
    // record now and its full form later would double count.
    const tailRecords: UsageRecord[] = [];
    if (pendingChunks.length > 0) {
      const pending = pendingChunks.length === 1 ? pendingChunks[0]! : Buffer.concat(pendingChunks);
      if (pending.length > 0) parseLine(toLineString(pending), { ...codexState }, tailRecords);
    }

    const guardLength = Math.min(GUARD_LENGTH, resumeOffset);
    let guardHash = 0;
    if (guardLength > 0) {
      const window = Buffer.alloc(guardLength);
      await handle.read(window, 0, guardLength, resumeOffset - guardLength);
      guardHash = fnv1a(window);
    }

    return {
      records,
      tailRecords,
      position: {
        resumeOffset,
        guardLength,
        guardHash,
        codexState: provider === "codex" ? codexState : null,
      },
      resumed,
    };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

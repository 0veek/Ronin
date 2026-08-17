// @effect-diagnostics nodeBuiltinImport:off
/**
 * Raw filesystem access for transcript scanning.
 *
 * Isolated here so the rest of the usage code stays on Effect's `FileSystem`.
 * The direct `node:fs` streaming is deliberate: a cold 30-day window is ~1.4 GB
 * across ~1,500 files, and `readline` over a read stream is roughly an order of
 * magnitude cheaper than materialising each file. The equivalent Effect stream
 * pipeline is idiomatic but not fast enough to sit behind a page load.
 *
 * @module usageTranscriptReader
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import type { UsageProviderKind } from "@t3tools/contracts";

import { type AntigravityStepRow, parseAntigravityConversation } from "./antigravityTranscripts.ts";
import {
  initialCodexScanState,
  mightCarryUsage,
  parseClaudeLine,
  parseCodexLine,
  parseGrokLine,
  type UsageRecord,
} from "./usageTranscripts.ts";

export interface TranscriptFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
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

/**
 * Streams one transcript and returns the usage records it contains, or `null`
 * when the file could not be read.
 *
 * The distinction matters to the caller's cache: a genuinely empty transcript
 * is a stable fact worth memoising, while a transient read failure memoised
 * under the same `(size, mtime)` key would silently drop that file's usage
 * until the file next changes.
 *
 * Codex carries the active model on `turn_context` lines that hold no usage of
 * their own, so those still have to pass through the reducer to keep model
 * attribution correct. Claude and Grok lines are each self-contained, so they
 * need no rolling state; a Grok turn can name several models at once and so
 * yields a record per model. Antigravity is not line-based at all and takes the
 * SQLite path above.
 */
export async function readTranscriptRecords(
  filePath: string,
  provider: UsageProviderKind,
): Promise<readonly UsageRecord[] | null> {
  if (provider === "antigravity") return readAntigravityRecords(filePath);

  const records: UsageRecord[] = [];
  const codexState = initialCodexScanState();

  try {
    const lines = NodeReadline.createInterface({
      input: NodeFS.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of lines) {
      if (provider === "codex") {
        if (
          !mightCarryUsage(line, provider) &&
          !line.includes('"turn_context"') &&
          !line.includes('"session_meta"')
        ) {
          continue;
        }
        const record = parseCodexLine(line, codexState);
        if (record !== null) records.push(record);
        continue;
      }

      if (!mightCarryUsage(line, provider)) continue;

      if (provider === "grok") {
        records.push(...parseGrokLine(line));
        continue;
      }

      const record = parseClaudeLine(line);
      if (record !== null) records.push(record);
    }
  } catch {
    return null;
  }

  return records;
}

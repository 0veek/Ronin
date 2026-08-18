/**
 * What happened while you were not looking.
 *
 * Agents run unattended — overnight, on a schedule, in four worktrees at once
 * — and the first question on coming back is not "what is every thread doing"
 * but "what changed since I last looked, and what is stuck". The sidebar and
 * the board both answer the first question well and neither answers the
 * second, because both are live views with no memory of when you last saw
 * them.
 *
 * A digest is that memory. It is computed from the thread shells the client
 * already holds and a single remembered instant, so it costs one pass over a
 * list and asks the server for nothing.
 *
 * @module digest
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import { sortThreadsByBlockedDuration, threadNeedsYou } from "./components/Sidebar.logic";

export interface DigestEntry {
  readonly thread: EnvironmentThreadShell;
  /**
   * How long this thread has been waiting on the user, in milliseconds. Zero
   * for entries that are not waiting.
   *
   * A blocked thread does not change, so its `updatedAt` *is* the moment it
   * started waiting — the same substitution the sidebar's needs-you queue
   * makes, and sound for the same reason.
   */
  readonly waitedMs: number;
}

export interface Digest {
  /** Blocked threads, longest-waiting first. */
  readonly needsYou: ReadonlyArray<DigestEntry>;
  /** Turns that completed since the mark, newest first, and are not blocked. */
  readonly finished: ReadonlyArray<DigestEntry>;
  /** Still running right now. */
  readonly working: ReadonlyArray<DigestEntry>;
  /** The instant this digest reports from. */
  readonly since: string;
  readonly isEmpty: boolean;
}

function parseMs(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWorking(thread: EnvironmentThreadShell): boolean {
  return thread.session?.status === "running" || thread.session?.status === "starting";
}

/**
 * Build the digest.
 *
 * A thread appears in exactly one section, in priority order: blocked beats
 * running beats finished. A thread that finished a turn and then raised its
 * hand is news for one reason only — that it is waiting — and listing it
 * twice would make the counts lie.
 */
export function buildDigest(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly since: string;
  readonly now: string;
}): Digest {
  const sinceMs = parseMs(input.since) ?? 0;
  const nowMs = parseMs(input.now) ?? 0;

  const blocked: EnvironmentThreadShell[] = [];
  const running: EnvironmentThreadShell[] = [];
  const finished: EnvironmentThreadShell[] = [];

  for (const thread of input.threads) {
    // Archived and deleted threads are not news; the user filed them away.
    if (thread.archivedAt != null) continue;
    if (threadNeedsYou(thread)) {
      blocked.push(thread);
      continue;
    }
    if (isWorking(thread)) {
      running.push(thread);
      continue;
    }
    const completedAtMs = parseMs(thread.latestTurn?.completedAt);
    if (completedAtMs !== null && completedAtMs > sinceMs) {
      finished.push(thread);
    }
  }

  const waited = (thread: EnvironmentThreadShell): DigestEntry => ({
    thread,
    waitedMs: Math.max(0, nowMs - (parseMs(thread.updatedAt) ?? nowMs)),
  });
  const idle = (thread: EnvironmentThreadShell): DigestEntry => ({ thread, waitedMs: 0 });

  const needsYou = sortThreadsByBlockedDuration(blocked).map(waited);
  const finishedEntries = finished
    .toSorted(
      (left, right) =>
        (parseMs(right.latestTurn?.completedAt) ?? 0) -
        (parseMs(left.latestTurn?.completedAt) ?? 0),
    )
    .map(idle);
  const workingEntries = running.map(idle);

  return {
    needsYou,
    finished: finishedEntries,
    working: workingEntries,
    since: input.since,
    isEmpty: needsYou.length === 0 && finishedEntries.length === 0 && workingEntries.length === 0,
  };
}

/** `4m`, `2h 10m`, `3d` — how long something has been waiting. */
export function formatWaitedLabel(waitedMs: number): string {
  const minutes = Math.floor(waitedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  }
  return `${Math.floor(hours / 24)}d`;
}

/**
 * One line summarising the digest, for a toast or a button's tooltip.
 *
 * Leads with what is blocked, because that is the part only the user can
 * unblock. Says so plainly when there is nothing to report — an empty digest
 * is a real answer and worth stating rather than hiding.
 */
export function summarizeDigest(digest: Digest): string {
  if (digest.isEmpty) return "Nothing new since you last looked.";
  const parts: string[] = [];
  if (digest.needsYou.length > 0) parts.push(`${digest.needsYou.length} waiting on you`);
  if (digest.working.length > 0) parts.push(`${digest.working.length} still working`);
  if (digest.finished.length > 0) parts.push(`${digest.finished.length} finished`);
  return parts.join(" · ");
}

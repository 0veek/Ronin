/**
 * Replaying one turn as a timeline you can scrub.
 *
 * A finished turn scrolls past as a wall of tool rows, and the question people
 * actually ask afterwards — "what did it do while I was away, and in what
 * order" — is hard to answer by reading a transcript that shows everything at
 * once. A replay answers it by putting the turn back on a clock.
 *
 * The clock is not wall-clock. A turn is mostly waiting: twenty seconds of
 * thinking, a two-minute test run, four edits in the same second. Played back
 * at true speed it is unwatchable, and played back at a flat speed the four
 * edits blur into one frame. So idle gaps are compressed to a cap while short
 * ones keep their shape, which preserves the rhythm of the turn — burst,
 * pause, burst — without preserving its dead air.
 *
 * All of this is derived from the timeline the client already holds. A replay
 * asks the server for nothing.
 *
 * @module turnReplay
 */
import type { TurnId } from "@t3tools/contracts";

import type { TimelineEntry } from "./session-logic";

/**
 * Longest a single gap may occupy during playback.
 *
 * A pause has to stay legible as a pause — collapsing every gap to nothing
 * would make a test run look instantaneous — but nobody wants to sit through
 * the real two minutes.
 */
export const REPLAY_MAX_GAP_MS = 1_200;

/**
 * Below this, a gap plays at true length.
 *
 * Steps this close together are one burst of work, and stretching them apart
 * would invent a rhythm the turn never had.
 */
export const REPLAY_VERBATIM_GAP_MS = 400;

/** Playback time given to the last step so it is readable before the end. */
export const REPLAY_TAIL_MS = 600;

export interface TurnReplayStep {
  readonly entry: TimelineEntry;
  /** Milliseconds from the turn's first entry, on the real clock. */
  readonly atMs: number;
  /** Milliseconds from the start of playback, on the compressed clock. */
  readonly playheadMs: number;
  /** Real gap since the previous step, for showing "waited 2m 14s". */
  readonly gapMs: number;
}

export interface TurnReplay {
  readonly turnId: TurnId;
  readonly steps: ReadonlyArray<TurnReplayStep>;
  /** How long the turn actually took, first entry to last. */
  readonly durationMs: number;
  /** How long the replay runs. Always at least {@link REPLAY_TAIL_MS}. */
  readonly playbackDurationMs: number;
}

function entryTurnId(entry: TimelineEntry): TurnId | null {
  switch (entry.kind) {
    case "message":
      return entry.message.turnId ?? null;
    case "work":
      return entry.entry.turnId ?? null;
    // Plans are proposals about a turn rather than steps inside one, so they
    // are not part of what the turn "did".
    case "proposed-plan":
    case "turn-plan":
      return null;
  }
}

/** Compressed playback length for a real gap. */
function playbackGap(gapMs: number): number {
  if (gapMs <= REPLAY_VERBATIM_GAP_MS) return gapMs;
  // Past the verbatim threshold the gap grows logarithmically, so a 2-second
  // pause and a 2-minute one stay distinguishable without being proportional.
  const overflow = gapMs - REPLAY_VERBATIM_GAP_MS;
  const eased = Math.log10(1 + overflow / 100) * 300;
  return REPLAY_VERBATIM_GAP_MS + Math.min(eased, REPLAY_MAX_GAP_MS - REPLAY_VERBATIM_GAP_MS);
}

/**
 * The replay for one turn, or `null` when there is nothing to replay.
 *
 * Null rather than an empty replay: a turn with a single entry has no order to
 * show, and opening a scrubber on it would be a UI that does nothing.
 */
export function buildTurnReplay(
  entries: ReadonlyArray<TimelineEntry>,
  turnId: TurnId,
): TurnReplay | null {
  const owned = entries.filter((entry) => entryTurnId(entry) === turnId);
  if (owned.length < 2) return null;

  // Timeline order is already chronological, but two entries can share a
  // millisecond, so the sort must be stable on the original position rather
  // than reordering equal timestamps arbitrarily.
  const ordered = owned
    .map((entry, index) => ({ entry, index, at: Date.parse(entry.createdAt) }))
    .filter((row) => Number.isFinite(row.at))
    .sort((left, right) => left.at - right.at || left.index - right.index);
  if (ordered.length < 2) return null;

  const startedAt = ordered[0]!.at;
  let playheadMs = 0;
  let previousAt = startedAt;
  const steps: TurnReplayStep[] = ordered.map((row, index) => {
    const gapMs = index === 0 ? 0 : Math.max(0, row.at - previousAt);
    playheadMs += index === 0 ? 0 : playbackGap(gapMs);
    previousAt = row.at;
    return {
      entry: row.entry,
      atMs: Math.max(0, row.at - startedAt),
      playheadMs,
      gapMs,
    };
  });

  return {
    turnId,
    steps,
    durationMs: steps.at(-1)!.atMs,
    playbackDurationMs: playheadMs + REPLAY_TAIL_MS,
  };
}

/**
 * How long playback should rest on `index` before advancing.
 *
 * Playback moves step to step on a timer rather than sweeping a playhead every
 * frame: a turn is a sequence of discrete events, and animating between them
 * would repaint continuously for no information gained.
 */
export function replayStepDelayMs(replay: TurnReplay, index: number): number {
  const current = replay.steps[index];
  const next = replay.steps[index + 1];
  if (current === undefined || next === undefined) return REPLAY_TAIL_MS;
  return Math.max(next.playheadMs - current.playheadMs, 1);
}

/** How a step reads in the replay list. */
export interface ReplayStepDescription {
  readonly actor: "You" | "Agent" | "Work";
  readonly label: string;
  readonly detail: string | null;
  readonly tone: "thinking" | "tool" | "info" | "error";
}

/** Longest excerpt a step shows before it is cut. The list is a scan of what
    happened, not a second copy of the transcript. */
export const REPLAY_EXCERPT_MAX_CHARS = 180;

function excerpt(text: string): string | null {
  const collapsed = text.replaceAll(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.length <= REPLAY_EXCERPT_MAX_CHARS
    ? collapsed
    : `${collapsed.slice(0, REPLAY_EXCERPT_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * What a step says in the replay list.
 *
 * Deliberately flat — one line, one excerpt — because the value of a replay is
 * the order and the pauses, and rendering full message bodies would rebuild
 * the transcript the reader is trying to get above.
 */
export function describeReplayStep(entry: TimelineEntry): ReplayStepDescription {
  if (entry.kind === "message") {
    const isUser = entry.message.role === "user";
    return {
      actor: isUser ? "You" : "Agent",
      label: isUser ? "Sent the prompt" : "Replied",
      detail: excerpt(entry.message.text),
      tone: "info",
    };
  }
  if (entry.kind === "work") {
    const work = entry.entry;
    return {
      actor: "Work",
      label: work.label,
      detail: excerpt(work.command ?? work.detail ?? ""),
      tone: work.tone,
    };
  }
  // Plans never reach a replay (buildTurnReplay drops them), but the union has
  // to be closed and a silent `undefined` here would be worse than a label.
  return { actor: "Work", label: "Plan", detail: null, tone: "info" };
}

/** `1.4s`, `2m 14s`, `1h 03m` — the gap label under a step. */
export function formatReplayGap(gapMs: number): string | null {
  if (gapMs < 1_000) return null;
  const totalSeconds = Math.round(gapMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** `0:00` / `12:04` — the clock beside the scrubber, on real turn time. */
export function formatReplayClock(atMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(atMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

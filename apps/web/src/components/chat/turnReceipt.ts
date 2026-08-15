import type { TurnId } from "@t3tools/contracts";
import type { TimelineEntry } from "../../session-logic";

/**
 * How long each turn took, for the receipt on its changed-files card.
 *
 * A turn's clock starts when the user sends and stops at the checkpoint, so
 * the start is the first timeline entry carrying the turn's id — the user
 * message that opened it. That is the number a reader means by "how long did
 * that take", and it is derivable from what the timeline already holds, which
 * is why it lives here instead of on the wire.
 *
 * @module turnReceipt
 */

/** Below this, the number is noise: everything interactive finishes in under a
    second and reporting "0s" on a card reads as a bug rather than a fact. */
const MIN_REPORTABLE_MS = 1_000;

export function deriveTurnStartedAtByTurnId(
  timelineEntries: ReadonlyArray<TimelineEntry>,
): ReadonlyMap<TurnId, string> {
  const startedAtByTurnId = new Map<TurnId, string>();

  for (const entry of timelineEntries) {
    const turnId = entry.kind === "message" ? entry.message.turnId : null;
    if (turnId === null || turnId === undefined) continue;
    // First wins: entries arrive in timeline order, and the opening message is
    // the one that dates the turn.
    if (!startedAtByTurnId.has(turnId)) {
      startedAtByTurnId.set(turnId, entry.createdAt);
    }
  }

  return startedAtByTurnId;
}

/**
 * A compact elapsed label — `4s`, `1m 12s`, `2h 5m`.
 *
 * Two units at most and never a unit that is zero, so the label stays short
 * enough to sit inline in a card header that already carries a file count and
 * a diff stat.
 */
export function formatTurnDuration(startedAt: string, completedAt: string): string | null {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  const elapsedMs = end - start;
  // A clock that ran backwards is a clock skew between machines, not a fact
  // about the turn.
  if (elapsedMs < MIN_REPORTABLE_MS) return null;

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** The label for one turn, or nothing when its start is unknown (a thread
    loaded from a window that does not include the opening message). */
export function turnDurationLabel(input: {
  readonly turnId: TurnId;
  readonly completedAt: string;
  readonly startedAtByTurnId: ReadonlyMap<TurnId, string>;
}): string | null {
  const startedAt = input.startedAtByTurnId.get(input.turnId);
  if (startedAt === undefined) return null;
  return formatTurnDuration(startedAt, input.completedAt);
}

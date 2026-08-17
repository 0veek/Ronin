/**
 * Countdown wording for a parked turn.
 *
 * Kept out of the component so the phrasing can be tested directly: a banner
 * that says "in 0m" for fifty seconds, or "in 90m" instead of "in 1h 30m",
 * reads as broken even when the scheduler underneath is perfect.
 *
 * @module quotaResumeCountdown
 */

/**
 * How often the banner needs to re-render to stay honest.
 *
 * A whole minute is too coarse near zero — the last minute would sit on
 * "in 1m" and then jump straight to resuming. Ten seconds is under the
 * resolution of every label except the final "in under a minute", and is
 * cheap enough that a visible countdown does not cost a repaint per frame.
 */
export const QUOTA_RESUME_TICK_MS = 10_000;

/**
 * Time left until a parked turn goes, as a phrase that completes
 * "Resuming <phrase>".
 *
 * Returns `null` once the wait is over, which is the banner's cue to stop
 * showing a clock and say it is resuming instead.
 */
export function formatQuotaResumeCountdown({
  resumeAtMs,
  nowMs,
}: {
  readonly resumeAtMs: number;
  readonly nowMs: number;
}): string | null {
  const remainingMs = resumeAtMs - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;

  const totalMinutes = Math.ceil(remainingMs / 60_000);
  if (totalMinutes <= 1) return "in under a minute";
  if (totalMinutes < 60) return `in ${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  // Past a day the minutes stop being information and start being noise; a
  // weekly cap reset is not something anyone reads to the minute.
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainderHours = hours % 24;
    return remainderHours === 0 ? `in ${days}d` : `in ${days}d ${remainderHours}h`;
  }
  return minutes === 0 ? `in ${hours}h` : `in ${hours}h ${minutes}m`;
}

/** Provider name as the banner says it. */
export function formatQuotaResumeProvider(provider: "claude" | "codex" | "grok"): string {
  switch (provider) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "grok":
      return "Grok";
  }
}

/**
 * Which window ran out, phrased for a sentence rather than a table.
 *
 * `null` when the provider did not say — the banner then talks about the
 * plan limit generically rather than inventing a window.
 */
export function formatQuotaResumeWindow(
  windowKind: "session" | "weekly" | "monthly" | null,
): string | null {
  switch (windowKind) {
    case "session":
      return "5-hour limit";
    case "weekly":
      return "weekly limit";
    case "monthly":
      return "monthly limit";
    case null:
      return null;
  }
}

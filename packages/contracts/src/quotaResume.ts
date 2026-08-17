/**
 * Quota resume contract.
 *
 * A turn that dies because the subscription window is spent is not a failure
 * the user can act on — the only remedy is to wait. Ronin already knows when
 * each window resets ({@link ./rateLimit.ts}), so instead of leaving a dead
 * turn in the thread it parks the prompt and replays it once the window turns
 * over. This module is the shape of that parked work: what is waiting, for
 * which provider, and when it will go.
 *
 * A resume is deliberately *not* part of the orchestration read model. It is
 * scheduler state, not thread history — it never survives a restart with the
 * clock still running, and replaying the event log must not replay a wait that
 * has since become irrelevant. It therefore rides its own snapshot, the same
 * way quota itself does.
 *
 * @module quotaResume
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { RateLimitProviderKind, RateLimitWindowKind } from "./rateLimit.ts";

/**
 * Why a parked turn is waiting.
 *
 * - `scheduled` - the window reset is known and the replay is armed.
 * - `resuming` - the replay is going out now. Held briefly so the banner can
 *   say what happened rather than blinking out of existence.
 * - `blocked` - the reset is farther out than the user's maximum wait, so
 *   nothing is armed. The row stays visible with a manual retry, because
 *   silently dropping the prompt is worse than showing a wait we declined.
 */
export const QuotaResumeState = Schema.Literals(["scheduled", "resuming", "blocked"]);
export type QuotaResumeState = typeof QuotaResumeState.Type;

/**
 * One parked turn.
 *
 * `resumeAt` is the authority for the countdown: the client ticks against it
 * locally rather than being pushed a new snapshot every second.
 */
export const QuotaResume = Schema.Struct({
  threadId: ThreadId,
  provider: RateLimitProviderKind,
  /** Which window ran out, when the provider named one. */
  windowKind: Schema.NullOr(RateLimitWindowKind),
  state: QuotaResumeState,
  /** When the replay fires. In the past only while `state` is `resuming`. */
  resumeAt: IsoDateTime,
  parkedAt: IsoDateTime,
  /**
   * How many times this prompt has been parked. A provider that answers
   * "limit reached" again the instant the window turns over pushes this up,
   * and the scheduler gives up rather than looping.
   */
  attempt: PositiveInt,
  /**
   * The provider's own words, trimmed and bounded. Shown under the countdown
   * so the user can tell a weekly cap from a five-hour one at a glance.
   */
  detail: Schema.NullOr(TrimmedNonEmptyString),
});
export type QuotaResume = typeof QuotaResume.Type;

export const QuotaResumeSnapshot = Schema.Struct({
  resumes: Schema.Array(QuotaResume),
  readAt: IsoDateTime,
});
export type QuotaResumeSnapshot = typeof QuotaResumeSnapshot.Type;

export const QuotaResumeCancelInput = Schema.Struct({
  threadId: ThreadId,
});
export type QuotaResumeCancelInput = typeof QuotaResumeCancelInput.Type;

export const QuotaResumeCancelResult = Schema.Struct({
  /** False when nothing was parked — a second click, or a race with the fire. */
  cancelled: Schema.Boolean,
});
export type QuotaResumeCancelResult = typeof QuotaResumeCancelResult.Type;

export const QuotaResumeRunNowInput = Schema.Struct({
  threadId: ThreadId,
});
export type QuotaResumeRunNowInput = typeof QuotaResumeRunNowInput.Type;

export const QuotaResumeRunNowResult = Schema.Struct({
  started: Schema.Boolean,
});
export type QuotaResumeRunNowResult = typeof QuotaResumeRunNowResult.Type;

/**
 * How long Ronin is willing to hold a prompt.
 *
 * A five-hour window is worth waiting out unattended; a weekly cap generally
 * is not, which is why the ceiling is a user setting rather than a constant.
 */
export const QuotaResumeMaximumWait = Schema.Literals(["off", "6h", "24h", "unlimited"]);
export type QuotaResumeMaximumWait = typeof QuotaResumeMaximumWait.Type;

export const DEFAULT_QUOTA_RESUME_MAXIMUM_WAIT: QuotaResumeMaximumWait = "6h";

/** Milliseconds a setting allows, or `null` for no ceiling. `off` disables. */
export function quotaResumeMaximumWaitMs(wait: QuotaResumeMaximumWait): number | null {
  switch (wait) {
    case "off":
      return 0;
    case "6h":
      return 6 * 60 * 60 * 1_000;
    case "24h":
      return 24 * 60 * 60 * 1_000;
    case "unlimited":
      return null;
  }
}

/**
 * Attempts before the scheduler stops re-parking the same prompt.
 *
 * Two is enough to ride out a reset the provider reported a minute early;
 * beyond that the window is not the real problem.
 */
export const QUOTA_RESUME_MAX_ATTEMPTS = 3;

export class QuotaResumeError extends Schema.TaggedErrorClass<QuotaResumeError>()(
  "QuotaResumeError",
  {
    reason: Schema.Literals(["readFailed", "dispatchFailed"]),
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Quota resume failed (${this.reason}): ${this.detail}`;
  }
}

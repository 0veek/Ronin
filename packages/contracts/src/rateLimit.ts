/**
 * Provider rate-limit contract.
 *
 * This is quota, not spend. {@link ./usage.ts} answers "how many tokens did I
 * burn and what would they have cost at API rates" by scanning transcripts;
 * this answers "how much of my subscription window is gone", which is the
 * number that decides whether you can keep working in the next hour.
 *
 * The providers already emit rate-limit events mid-turn
 * (`account.rate-limits.updated`), but a meter fed only by those is blank on
 * launch and blank again after a restart -- exactly when someone wants to
 * check it. So the server reads each CLI's own credential file and calls the
 * same usage endpoint the CLI calls, which works at rest and covers turns that
 * were never driven through Ronin.
 *
 * @module rateLimit
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Providers whose subscription quota Ronin can read.
 *
 * Narrower than `ProviderDriverKind` on purpose: a driver only belongs here
 * once there is a real endpoint behind it. Every other provider is absent
 * rather than reported as zero.
 */
export const RateLimitProviderKind = Schema.Literals(["claude", "codex", "grok"]);
export type RateLimitProviderKind = typeof RateLimitProviderKind.Type;

/**
 * Which rolling window a percentage belongs to.
 *
 * - `session` - Claude's and Codex's 5-hour bucket.
 * - `weekly` - the 7-day bucket. Grok's credit period is also weekly.
 * - `monthly` - Grok unified billing, which reports a 30-day included budget
 *   instead of weekly credits.
 */
export const RateLimitWindowKind = Schema.Literals(["session", "weekly", "monthly"]);
export type RateLimitWindowKind = typeof RateLimitWindowKind.Type;

export const RateLimitWindow = Schema.Struct({
  kind: RateLimitWindowKind,
  /** Share of the window consumed, 0-100. Clamped at the fetch boundary. */
  usedPercent: Schema.Number,
  /**
   * Window length as the provider reported it, not as `kind` implies. Codex
   * has shipped buckets a minute off the nominal length, and the classifier
   * tolerates that drift, so the reported figure is kept for display.
   */
  windowMinutes: NonNegativeInt,
  resetsAt: Schema.NullOr(IsoDateTime),
});
export type RateLimitWindow = typeof RateLimitWindow.Type;

/**
 * Why a provider's row looks the way it does.
 *
 * - `ok` - windows are current.
 * - `unavailable` - nothing to show and nothing wrong: not signed in, or on a
 *   billing mode with no subscription quota (API key, Bedrock, Vertex). The
 *   row states that rather than showing an alert.
 * - `error` - a read or request failed. `message` says how.
 */
export const RateLimitStatus = Schema.Literals(["ok", "unavailable", "error"]);
export type RateLimitStatus = typeof RateLimitStatus.Type;

export const ProviderRateLimits = Schema.Struct({
  provider: RateLimitProviderKind,
  status: RateLimitStatus,
  /**
   * Windows the provider reported, in no guaranteed order. Empty whenever
   * status is not `ok`.
   */
  windows: Schema.Array(RateLimitWindow),
  /** Subscription tier when the provider names one, e.g. Codex's `plus`. */
  planLabel: Schema.NullOr(TrimmedNonEmptyString),
  observedAt: IsoDateTime,
  /** Bounded, non-identifying reason. Never contains a path or a token. */
  message: Schema.NullOr(TrimmedNonEmptyString),
});
export type ProviderRateLimits = typeof ProviderRateLimits.Type;

export const ProviderRateLimitsSnapshot = Schema.Struct({
  providers: Schema.Array(ProviderRateLimits),
  readAt: IsoDateTime,
});
export type ProviderRateLimitsSnapshot = typeof ProviderRateLimitsSnapshot.Type;

export class RateLimitReadError extends Schema.TaggedErrorClass<RateLimitReadError>()(
  "RateLimitReadError",
  {
    reason: Schema.Literals(["readFailed"]),
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Rate limit read failed (${this.reason}): ${this.detail}`;
  }
}

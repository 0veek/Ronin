/**
 * Deciding whether a dead turn was a quota wall.
 *
 * Providers do not agree on how to say "you are out of subscription quota",
 * and none of them say it in a structured field a turn failure carries — it
 * arrives as prose in `lastError`. This module is the whole of that judgement,
 * kept pure and separate so it can be tested against real strings rather than
 * inferred from a running provider.
 *
 * The bias is deliberately conservative. A false positive parks a prompt the
 * user expected to fail and replays it hours later, which is surprising in a
 * way a plain error is not. A false negative just leaves today's behaviour.
 *
 * @module quotaFailureClassification
 */
import type { RateLimitProviderKind, RateLimitWindowKind } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * Phrases that only appear when a subscription window is spent.
 *
 * Deliberately excludes bare "rate limit" and "429": those also cover the
 * short per-minute throttles a provider recovers from on its own within
 * seconds, and parking a turn for those would be wrong.
 */
const QUOTA_PHRASES = [
  "usage limit reached",
  "usage limit exceeded",
  "you've reached your usage limit",
  "you have reached your usage limit",
  "quota exceeded",
  "out of credits",
  "insufficient credits",
  "weekly limit reached",
  "monthly limit reached",
  "plan limit reached",
  "limit will reset",
  "limit resets",
  "resets at",
  "upgrade to continue",
  "your limit will reset at",
] as const;

/**
 * Phrases that look quota-shaped but are not a window running out.
 *
 * Checked first: a message can contain both ("quota exceeded — add a payment
 * method"), and in that case waiting will never help.
 */
const NON_QUOTA_PHRASES = [
  "invalid api key",
  "authentication",
  "unauthorized",
  "add a payment method",
  "billing",
  "payment required",
  "account suspended",
  "context window",
  "too many tokens",
  "prompt is too long",
] as const;

/** Which rolling window the message names, when it names one. */
function detectWindowKind(text: string): RateLimitWindowKind | null {
  if (text.includes("week")) return "weekly";
  if (text.includes("month")) return "monthly";
  if (text.includes("5-hour") || text.includes("5 hour") || text.includes("session")) {
    return "session";
  }
  return null;
}

/**
 * An explicit reset instant in the provider's own message.
 *
 * Worth parsing because it is the only reset time available when the CLI is
 * signed into an account whose usage endpoint Ronin cannot read. Only absolute
 * ISO-ish timestamps are taken; a bare "resets at 3pm" has no date and no zone
 * and guessing either produces a wait that is hours wrong.
 */
export function parseExplicitResetAt(message: string, nowMs: number): string | null {
  const match =
    /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(
      message,
    );
  const literal = match?.[1];
  if (literal === undefined) return null;
  const parsed = Date.parse(literal.replace(" ", "T"));
  if (Number.isNaN(parsed)) return null;
  // A reset already behind us, or implausibly far ahead, is a parse that
  // happened to match something else in the message.
  if (parsed <= nowMs || parsed - nowMs > 40 * 24 * 60 * 60 * 1_000) return null;
  return DateTime.formatIso(DateTime.makeUnsafe(parsed));
}

export interface QuotaFailure {
  readonly windowKind: RateLimitWindowKind | null;
  /** Reset instant the message stated outright, when it stated one. */
  readonly explicitResetAt: string | null;
}

/**
 * Whether this turn failure is a subscription window running out.
 *
 * `null` means "not a quota wall" and the failure should stay a failure.
 */
export function classifyQuotaFailure({
  message,
  nowMs,
}: {
  readonly message: string | null | undefined;
  readonly nowMs: number;
}): QuotaFailure | null {
  const text = (message ?? "").toLowerCase();
  if (text.length === 0) return null;
  if (NON_QUOTA_PHRASES.some((phrase) => text.includes(phrase))) return null;
  if (!QUOTA_PHRASES.some((phrase) => text.includes(phrase))) return null;

  return {
    windowKind: detectWindowKind(text),
    explicitResetAt: parseExplicitResetAt(message ?? "", nowMs),
  };
}

/**
 * The provider whose quota this thread was spending.
 *
 * Only the three Ronin can read a window for are resumable: for anything else
 * there is no reset time to wait for, so the failure stays a failure.
 */
export function resumableProviderKind(
  driverKind: string | null | undefined,
): RateLimitProviderKind | null {
  switch (driverKind) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "grok":
      return "grok";
    default:
      return null;
  }
}

/**
 * When the parked turn should go.
 *
 * Prefers the provider's own words over the usage endpoint: the message came
 * from the request that actually got refused, while the snapshot may be up to
 * its TTL stale. A small pad past the stated reset absorbs clock skew between
 * this machine and the provider — firing a second early just burns an attempt.
 */
export const RESUME_PAD_MS = 30_000;

export function resolveResumeAt({
  explicitResetAt,
  windowResetAt,
  nowMs,
}: {
  readonly explicitResetAt: string | null;
  readonly windowResetAt: string | null;
  readonly nowMs: number;
}): string | null {
  const candidate = explicitResetAt ?? windowResetAt;
  if (candidate === null) return null;
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) return null;
  // A window that already reset means the refusal was about a different one,
  // or the snapshot is stale. Retrying immediately would just fail again, so
  // wait out the pad and let the attempt counter bound the loop.
  return DateTime.formatIso(DateTime.makeUnsafe(Math.max(parsed, nowMs) + RESUME_PAD_MS));
}

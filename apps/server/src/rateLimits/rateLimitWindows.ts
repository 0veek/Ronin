/**
 * Pure mapping from each provider's usage payload to {@link RateLimitWindow}.
 *
 * Kept free of I/O so the fiddly parts -- unit-ambiguous reset stamps, Codex's
 * unlabelled window pair, Grok's omitted zero -- are testable without a network
 * or a credential file.
 *
 * @module rateLimitWindows
 */
import type { RateLimitWindow, RateLimitWindowKind } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export const SESSION_WINDOW_MINUTES = 300;
export const WEEKLY_WINDOW_MINUTES = 10_080;
export const MONTHLY_WINDOW_MINUTES = 43_200;

/**
 * Codex has shipped buckets a minute off the nominal length. Tolerate that
 * much drift when classifying, but no more -- widening this far enough to
 * absorb an unrelated duration would silently mislabel it.
 */
const WINDOW_DURATION_TOLERANCE_MINUTES = 1;

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Normalises a reset stamp to ISO 8601.
 *
 * Providers disagree on the unit: Claude's OAuth usage endpoint sends seconds,
 * Codex's app server sends seconds, and some payloads send milliseconds or an
 * ISO string. 1e10 sits between any plausible seconds epoch (year 2286) and
 * any plausible millisecond epoch (year 2001), which separates the two without
 * needing the provider to say which it meant.
 */
export function normalizeResetsAt(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const asNumber = typeof value === "number" ? value : Number(value);
  const numeric = isFiniteNumber(asNumber) && (typeof value === "number" || value.trim() !== "");
  const input = numeric ? (asNumber > 10_000_000_000 ? asNumber : asNumber * 1000) : value;

  return Option.match(DateTime.make(input), {
    onNone: () => null,
    onSome: (instant) => DateTime.formatIso(instant),
  });
}

export function makeWindow(
  kind: RateLimitWindowKind,
  usedPercent: number,
  windowMinutes: number,
  resetsAt: string | number | null | undefined,
): RateLimitWindow {
  return {
    kind,
    usedPercent: clampPercent(usedPercent),
    windowMinutes: Math.max(0, Math.round(windowMinutes)),
    resetsAt: normalizeResetsAt(resetsAt),
  };
}

/** One window as Claude's OAuth usage endpoint reports it. */
export type ClaudeUsageWindowInput = {
  readonly utilization?: number | null;
  readonly resets_at?: string | number | null;
};

export function mapClaudeWindow(
  raw: ClaudeUsageWindowInput | null | undefined,
  kind: RateLimitWindowKind,
  windowMinutes: number,
): RateLimitWindow | null {
  if (!raw || !isFiniteNumber(raw.utilization)) return null;
  return makeWindow(kind, raw.utilization, windowMinutes, raw.resets_at);
}

/** One window as Codex reports it, from either the app server or the backend. */
export type CodexRateWindowSnapshot = {
  readonly usedPercent?: unknown;
  readonly windowDurationMins?: unknown;
  readonly resetsAt?: unknown;
};

type MappableCodexWindow = CodexRateWindowSnapshot & { readonly usedPercent: number };

function isMappable(raw: CodexRateWindowSnapshot | null | undefined): raw is MappableCodexWindow {
  return isFiniteNumber(raw?.usedPercent);
}

function classifyDuration(raw: MappableCodexWindow): RateLimitWindowKind | null {
  const duration = raw.windowDurationMins;
  if (!isFiniteNumber(duration)) return null;
  if (Math.abs(duration - SESSION_WINDOW_MINUTES) <= WINDOW_DURATION_TOLERANCE_MINUTES) {
    return "session";
  }
  if (Math.abs(duration - WEEKLY_WINDOW_MINUTES) <= WINDOW_DURATION_TOLERANCE_MINUTES) {
    return "weekly";
  }
  return null;
}

/**
 * Sorts Codex's `primary`/`secondary` pair into session and weekly.
 *
 * The field names carry no meaning -- which bucket lands in which slot has
 * changed across Codex releases -- so classification goes by the reported
 * duration. A window whose duration is missing or unrecognised falls back to
 * the positional reading (primary is the session, secondary the week), because
 * showing the older layout beats dropping the row entirely.
 */
export function classifyCodexWindows(input: {
  readonly primary?: CodexRateWindowSnapshot | null;
  readonly secondary?: CodexRateWindowSnapshot | null;
}): { session: MappableCodexWindow | null; weekly: MappableCodexWindow | null } {
  const primary = isMappable(input.primary) ? input.primary : null;
  const secondary = isMappable(input.secondary) ? input.secondary : null;

  let session: MappableCodexWindow | null = null;
  let weekly: MappableCodexWindow | null = null;

  for (const window of [primary, secondary]) {
    if (!window) continue;
    const kind = classifyDuration(window);
    if (kind === "session" && !session) session = window;
    else if (kind === "weekly" && !weekly) weekly = window;
  }

  if (!session && primary && classifyDuration(primary) === null) session = primary;
  if (!weekly && secondary && classifyDuration(secondary) === null) weekly = secondary;

  return { session, weekly };
}

export function mapCodexWindow(
  raw: MappableCodexWindow | null,
  kind: RateLimitWindowKind,
  fallbackMinutes: number,
): RateLimitWindow | null {
  if (!raw) return null;
  const duration = isFiniteNumber(raw.windowDurationMins)
    ? raw.windowDurationMins
    : fallbackMinutes;
  const resetsAt =
    typeof raw.resetsAt === "number" || typeof raw.resetsAt === "string" ? raw.resetsAt : null;
  return makeWindow(kind, raw.usedPercent, duration > 0 ? duration : fallbackMinutes, resetsAt);
}

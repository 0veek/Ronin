/**
 * Reads each provider CLI's own credential file and calls the same usage
 * endpoint that CLI calls.
 *
 * Ronin already sees `account.rate-limits.updated` mid-turn, but a meter fed
 * only by the session stream is blank on launch, blank after a restart, and
 * blank for any provider you have not run yet -- which is most of the time
 * someone glances at it. Reading at rest is what makes the meter answerable.
 *
 * Nothing here ever runs a login. The token is whatever the CLI already wrote;
 * if it is missing or stale the provider reports `unavailable` and the row says
 * so, because prompting a re-login from a sidebar meter would be worse than a
 * blank row.
 *
 * Tokens are read, sent to that provider's own host, and never logged, cached,
 * or included in an error message. Failure text is bounded and carries no path,
 * so a screenshot of the sidebar cannot leak a username or a custom home.
 *
 * @module providerRateLimitSources
 */
import * as NodeOS from "node:os";

import type { ProviderRateLimits, RateLimitWindow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  classifyCodexWindows,
  makeWindow,
  mapClaudeWindow,
  mapCodexWindow,
  MONTHLY_WINDOW_MINUTES,
  SESSION_WINDOW_MINUTES,
  WEEKLY_WINDOW_MINUTES,
} from "./rateLimitWindows.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

/**
 * Grok's CLI talks to a proxy rather than the public xAI API, and the override
 * exists because the CLI honours the same variable. Both the URL and the
 * headers below have to match what the CLI sends or xAI rejects the request.
 */
const GROK_PROXY_BASE =
  process.env.GROK_CLI_CHAT_PROXY_BASE_URL?.trim().replace(/\/$/, "") ||
  "https://cli-chat-proxy.grok.com/v1";
const GROK_CREDITS_URL = `${GROK_PROXY_BASE}/billing?format=credits`;
const GROK_BILLING_URL = `${GROK_PROXY_BASE}/billing`;

/** Stale alternate issuers can precede the real session in Grok's auth file. */
const GROK_PREFERRED_ISSUER = "https://auth.x.ai";
const GROK_TOKEN_SKEW_MS = 5 * 60 * 1000;

type Provider = ProviderRateLimits["provider"];

/**
 * Services are handed in rather than pulled from context so each reader stays
 * requirement-free, which is what lets RateLimitService expose `readSnapshot`
 * with no environment of its own.
 */
export type RateLimitSourceDeps = {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly httpClient: HttpClient.HttpClient;
  /** Read once per snapshot from the Effect clock, never from `Date.now()`. */
  readonly nowMs: number;
  readonly observedAt: string;
};

function outcome(
  provider: Provider,
  status: ProviderRateLimits["status"],
  observedAt: string,
  message: string | null,
  windows: ReadonlyArray<RateLimitWindow> = [],
  planLabel: string | null = null,
): ProviderRateLimits {
  return { provider, status, windows, planLabel, observedAt, message };
}

/**
 * Reads and parses a credential file.
 *
 * A missing file is a signed-out account, not a failure, so it resolves to
 * `null` rather than erroring; an unparseable one resolves to `null` too,
 * because the only honest thing a meter can say about a corrupt auth file is
 * that it has no data.
 */
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const readJsonFile = Effect.fn("rateLimits.readJsonFile")(function* (
  deps: RateLimitSourceDeps,
  filePath: string,
) {
  const raw = yield* deps.fileSystem
    .readFileString(filePath)
    .pipe(Effect.catchCause(() => Effect.succeed(null)));
  if (raw === null) return null;
  const parsed = yield* decodeJson(raw).pipe(Effect.catchCause(() => Effect.succeed(null)));
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
});

const getJson = Effect.fn("rateLimits.getJson")(function* (
  deps: RateLimitSourceDeps,
  url: string,
  headers: Record<string, string>,
) {
  const request = HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers));
  return yield* deps.httpClient.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.timeout(REQUEST_TIMEOUT_MS),
    Effect.catchCause(() => Effect.succeed(null)),
  );
});

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

type ClaudeUsageResponse = {
  readonly five_hour?: { utilization?: number | null; resets_at?: string | number | null } | null;
  readonly seven_day?: { utilization?: number | null; resets_at?: string | number | null } | null;
};

/**
 * @param claudeHome the resolved HOME for the Claude CLI, not the `.claude`
 * directory -- an overridden home puts the config at the root, a default
 * install nests it, and both are probed.
 */
export const readClaudeRateLimits = Effect.fn("rateLimits.readClaudeRateLimits")(function* (
  deps: RateLimitSourceDeps,
  claudeHome: string,
) {
  const observedAt = deps.observedAt;
  const candidates = [
    deps.path.join(claudeHome, ".claude", ".credentials.json"),
    deps.path.join(claudeHome, ".credentials.json"),
  ];

  let token: string | null = null;
  for (const candidate of candidates) {
    const parsed = yield* readJsonFile(deps, candidate);
    const oauth = parsed?.["claudeAiOauth"];
    if (typeof oauth === "object" && oauth !== null) {
      const accessToken = (oauth as Record<string, unknown>)["accessToken"];
      if (typeof accessToken === "string" && accessToken.length > 0) {
        token = accessToken;
        break;
      }
    }
  }

  if (token === null) {
    // On macOS the CLI can keep this in the login keychain instead of on disk,
    // which Ronin does not read. Absent is reported as "no data", never as a
    // fault, so a keychain install shows an empty row rather than an alert.
    return outcome("claude", "unavailable", observedAt, "Not signed in to Claude");
  }

  // The locally stored expiry is not authoritative for this endpoint -- these
  // credentials still authenticate against it past that stamp -- so the request
  // goes out regardless and the server decides.
  const data = (yield* getJson(deps, CLAUDE_USAGE_URL, {
    authorization: `Bearer ${token}`,
    "anthropic-beta": CLAUDE_OAUTH_BETA,
    accept: "application/json",
  })) as ClaudeUsageResponse | null;

  if (data === null) {
    return outcome("claude", "error", observedAt, "Claude usage request failed");
  }

  const windows = [
    mapClaudeWindow(data.five_hour, "session", SESSION_WINDOW_MINUTES),
    mapClaudeWindow(data.seven_day, "weekly", WEEKLY_WINDOW_MINUTES),
  ].filter((window): window is RateLimitWindow => window !== null);

  if (windows.length === 0) {
    // API-key, Bedrock and Vertex billing have no subscription window at all.
    return outcome("claude", "unavailable", observedAt, "No plan limits on this account");
  }

  return outcome("claude", "ok", observedAt, null, windows);
});

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

type CodexUsageResponse = {
  readonly plan_type?: unknown;
  readonly rate_limit?: {
    readonly primary_window?: unknown;
    readonly secondary_window?: unknown;
  } | null;
};

/**
 * Normalises one window from either Codex surface.
 *
 * The two disagree on names and units. The backend REST endpoint this module
 * calls sends `used_percent` / `limit_window_seconds` / `reset_at`, in seconds;
 * the app server's `account/rateLimits/read` sends camelCase with the duration
 * already in minutes. Both are read so a window is never dropped for being
 * spelled the other way.
 *
 * Getting the duration wrong is not cosmetic. It is the only thing that tells a
 * 5-hour bucket from a weekly one, and without it classification falls back to
 * position -- which labels a lone weekly window as the 5-hour one.
 */
export function codexWindowSnapshot(raw: unknown) {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const limitWindowSeconds = value["limit_window_seconds"];
  const windowDurationMins =
    typeof limitWindowSeconds === "number" &&
    Number.isFinite(limitWindowSeconds) &&
    limitWindowSeconds > 0
      ? Math.ceil(limitWindowSeconds / 60)
      : value["windowDurationMins"];

  return {
    usedPercent: value["used_percent"] ?? value["usedPercent"],
    windowDurationMins,
    resetsAt: value["reset_at"] ?? value["resetsAt"],
  };
}

/** @param codexHome the `.codex` directory itself, as CodexHomeLayout resolves it. */
export const readCodexRateLimits = Effect.fn("rateLimits.readCodexRateLimits")(function* (
  deps: RateLimitSourceDeps,
  codexHome: string,
) {
  const observedAt = deps.observedAt;
  const parsed = yield* readJsonFile(deps, deps.path.join(codexHome, "auth.json"));

  const tokens = parsed?.["tokens"];
  const tokenBag =
    typeof tokens === "object" && tokens !== null ? (tokens as Record<string, unknown>) : null;
  const accessToken = tokenBag?.["access_token"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return outcome("codex", "unavailable", observedAt, "Not signed in to Codex");
  }

  const accountId = tokenBag?.["account_id"];
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    // These four are what the CLI sends. The endpoint is version-gated on them.
    "user-agent": "codex-cli",
    "openai-beta": "codex-1",
    originator: "Codex Desktop",
    accept: "application/json",
  };
  if (typeof accountId === "string" && accountId.length > 0) {
    headers["chatgpt-account-id"] = accountId;
  }

  const data = (yield* getJson(deps, CODEX_USAGE_URL, headers)) as CodexUsageResponse | null;
  if (data === null) {
    return outcome("codex", "error", observedAt, "Codex usage request failed");
  }

  const classified = classifyCodexWindows({
    primary: codexWindowSnapshot(data.rate_limit?.primary_window),
    secondary: codexWindowSnapshot(data.rate_limit?.secondary_window),
  });

  const windows = [
    mapCodexWindow(classified.session, "session", SESSION_WINDOW_MINUTES),
    mapCodexWindow(classified.weekly, "weekly", WEEKLY_WINDOW_MINUTES),
  ].filter((window): window is RateLimitWindow => window !== null);

  if (windows.length === 0) {
    return outcome("codex", "unavailable", observedAt, "No plan limits on this account");
  }

  const planType = data.plan_type;
  const planLabel =
    typeof planType === "string" && planType.trim().length > 0 ? planType.trim() : null;

  return outcome("codex", "ok", observedAt, null, windows, planLabel);
});

// ---------------------------------------------------------------------------
// Grok
// ---------------------------------------------------------------------------

type GrokMoney = { readonly val?: string | number };

type GrokBillingConfig = {
  readonly creditUsagePercent?: number;
  readonly currentPeriod?: { type?: string; start?: string; end?: string };
  readonly billingPeriodStart?: string;
  readonly billingPeriodEnd?: string;
  readonly subscriptionTier?: string;
  readonly monthlyLimit?: GrokMoney;
  readonly used?: GrokMoney;
};

type GrokBillingResponse = GrokBillingConfig & { readonly config?: GrokBillingConfig };

/** Grok has no configurable home in Ronin's settings, so this mirrors the CLI. */
export function resolveGrokHome(): string {
  const override = process.env.GROK_HOME?.trim();
  if (override !== undefined && override.length > 0) return override;
  return NodeOS.homedir();
}

type GrokSession = { accessToken: string; userId: string | null; expiresAtMs: number | null };

function grokSessionFromEntry(entry: Record<string, unknown>): GrokSession | null {
  const key = entry["key"];
  if (typeof key !== "string" || key.length === 0) return null;
  const userId = entry["user_id"];
  const expiresAt = entry["expires_at"];
  const expiresAtMs = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
  return {
    accessToken: key,
    userId: typeof userId === "string" ? userId : null,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
  };
}

function isGrokTokenFresh(session: GrokSession, nowMs: number): boolean {
  // A file without an expiry is treated as fresh: a dead token still surfaces
  // as an HTTP 401 below, which is a better signal than guessing here.
  if (session.expiresAtMs === null) return true;
  return session.expiresAtMs - nowMs > GROK_TOKEN_SKEW_MS;
}

function selectGrokSession(parsed: Record<string, unknown>, nowMs: number): GrokSession | null {
  let preferredSeen = false;
  let expiredPreferred: GrokSession | null = null;
  let fallback: GrokSession | null = null;

  for (const [key, value] of Object.entries(parsed)) {
    const isPreferred =
      key === GROK_PREFERRED_ISSUER || key.startsWith(`${GROK_PREFERRED_ISSUER}::`);
    preferredSeen ||= isPreferred;
    if (typeof value !== "object" || value === null) continue;
    const session = grokSessionFromEntry(value as Record<string, unknown>);
    if (session === null) continue;
    if (isPreferred) {
      if (isGrokTokenFresh(session, nowMs)) return session;
      expiredPreferred ??= session;
      continue;
    }
    fallback ??= session;
  }

  // Alternate issuers are a compatibility fallback only when the default
  // issuer is absent entirely; a stale default still outranks them.
  return expiredPreferred ?? (preferredSeen ? null : fallback);
}

function grokMoney(value: GrokMoney | undefined): number | null {
  const raw = value?.val;
  const parsed = typeof raw === "string" ? Number.parseFloat(raw) : raw;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function timestampsMatch(left: string | undefined, right: string | undefined): boolean {
  const a = left ? Date.parse(left) : Number.NaN;
  const b = right ? Date.parse(right) : Number.NaN;
  return Number.isFinite(a) && a === b;
}

/**
 * Grok's weekly credit window.
 *
 * `creditUsagePercent` is a protobuf field, so a genuine zero is omitted from
 * the JSON entirely and is indistinguishable from "not reported". A weekly
 * `currentPeriod` whose bounds match the billing period identifies the zero
 * case unambiguously; without that match an absent field stays absent.
 */
function grokWeeklyWindow(config: GrokBillingConfig): RateLimitWindow | null {
  const confirmedWeekly =
    config.currentPeriod?.type === "USAGE_PERIOD_TYPE_WEEKLY" &&
    timestampsMatch(config.currentPeriod.start, config.billingPeriodStart) &&
    timestampsMatch(config.currentPeriod.end, config.billingPeriodEnd);

  const usedPercent =
    config.creditUsagePercent === undefined && confirmedWeekly ? 0 : config.creditUsagePercent;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return null;

  const periodEnd = config.currentPeriod?.end ?? config.billingPeriodEnd;
  return makeWindow("weekly", usedPercent, WEEKLY_WINDOW_MINUTES, periodEnd ?? null);
}

function grokMonthlyWindow(config: GrokBillingConfig): RateLimitWindow | null {
  const limit = grokMoney(config.monthlyLimit);
  const used = grokMoney(config.used);
  if (limit === null || used === null || limit <= 0) return null;
  const periodEnd = config.currentPeriod?.end ?? config.billingPeriodEnd;
  return makeWindow("monthly", (used / limit) * 100, MONTHLY_WINDOW_MINUTES, periodEnd ?? null);
}

export const readGrokRateLimits = Effect.fn("rateLimits.readGrokRateLimits")(function* (
  deps: RateLimitSourceDeps,
  grokHome: string,
) {
  const observedAt = deps.observedAt;
  const parsed = yield* readJsonFile(deps, deps.path.join(grokHome, ".grok", "auth.json"));
  const session = parsed === null ? null : selectGrokSession(parsed, deps.nowMs);

  if (session === null) {
    return outcome("grok", "unavailable", observedAt, "Not signed in to Grok");
  }
  if (!isGrokTokenFresh(session, deps.nowMs)) {
    // Reaching here means a stored but expired session -- a real sign-out
    // returned `unavailable` above. The CLI refreshes on its next run, so this
    // does not ask for a fresh login.
    return outcome("grok", "error", observedAt, "Grok sign-in expired — run grok to refresh it");
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${session.accessToken}`,
    "x-xai-token-auth": "xai-grok-cli",
    accept: "application/json",
  };
  if (session.userId !== null) headers["x-userid"] = session.userId;

  const credits = (yield* getJson(deps, GROK_CREDITS_URL, headers)) as GrokBillingResponse | null;
  if (credits === null) {
    return outcome("grok", "error", observedAt, "Grok usage request failed");
  }

  const config =
    credits.config ?? (typeof credits.creditUsagePercent === "number" ? credits : null);
  if (config === null) {
    return outcome("grok", "unavailable", observedAt, "No plan limits on this account");
  }

  const planLabel = config.subscriptionTier?.trim() || null;

  const weekly = grokWeeklyWindow(config);
  if (weekly !== null) {
    return outcome("grok", "ok", observedAt, null, [weekly], planLabel);
  }

  // Unified-billing accounts expose a monthly included budget instead, and
  // their credits view omits the percentage, so the default view is the only
  // place that figure exists.
  const billing = (yield* getJson(deps, GROK_BILLING_URL, headers)) as GrokBillingResponse | null;
  const monthly = billing === null ? null : grokMonthlyWindow(billing.config ?? billing);
  if (monthly !== null) {
    return outcome("grok", "ok", observedAt, null, [monthly], planLabel);
  }

  return outcome("grok", "unavailable", observedAt, "No plan limits on this account");
});

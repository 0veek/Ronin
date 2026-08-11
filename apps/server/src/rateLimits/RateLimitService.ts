/**
 * RateLimitService - the current subscription-quota snapshot for every
 * provider Ronin can read one from.
 *
 * Reads are cached for {@link SNAPSHOT_TTL_MS}. The sidebar meter polls, three
 * providers means three outbound requests per refresh, and none of these
 * numbers move fast enough to be worth asking more often than that.
 *
 * A provider that fails does not fail the snapshot: each lands as its own row
 * carrying its own status, so one signed-out CLI cannot blank the other two.
 *
 * @module RateLimitService
 */
import type { ProviderRateLimits, ProviderRateLimitsSnapshot } from "@t3tools/contracts";
import { RateLimitReadError } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient } from "effect/unstable/http";

import * as ServerSettings from "../serverSettings.ts";
import { resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import {
  readClaudeRateLimits,
  readCodexRateLimits,
  readGrokRateLimits,
  resolveGrokHome,
} from "./providerRateLimitSources.ts";

/**
 * The real rate guard.
 *
 * The client polls on this same interval, but that only paces one reader --
 * this cache is what stops a second window, a reconnect, or a re-render from
 * each opening its own round trips to the three provider hosts. Shortening it
 * below the client's interval would let those pile up again.
 */
export const SNAPSHOT_TTL_MS = 30_000;

export class RateLimitService extends Context.Service<
  RateLimitService,
  {
    readonly readSnapshot: Effect.Effect<ProviderRateLimitsSnapshot, RateLimitReadError>;
  }
>()("t3/rateLimits/RateLimitService") {}

/** Empty snapshot, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  RateLimitService,
  RateLimitService.of({
    readSnapshot: Effect.succeed({ providers: [], readAt: "1970-01-01T00:00:00.000Z" }),
  }),
);

export const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = yield* HttpClient.HttpClient;

  let cached: ProviderRateLimitsSnapshot | null = null;
  let cachedAtMs: number | null = null;

  const readSnapshot = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    if (cached !== null && cachedAtMs !== null && nowMs - cachedAtMs < SNAPSHOT_TTL_MS) {
      return cached;
    }

    // A settings failure has to surface: serving "every provider reports
    // nothing" as a valid answer would be indistinguishable from being signed
    // out of all three.
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(
        (cause) =>
          new RateLimitReadError({
            reason: "readFailed",
            detail: "Server settings could not be read.",
            cause: Cause.squash(cause),
          }),
      ),
    );

    const claudeHome = yield* resolveClaudeHomePath(settings.providers.claudeAgent);
    const codexLayout = yield* resolveCodexHomeLayout(settings.providers.codex);
    const observedAt = DateTime.formatIso(yield* DateTime.now);
    const deps = { fileSystem, path, httpClient, nowMs, observedAt };

    // Concurrent because these are three independent network round trips to
    // three different hosts; serially they would stack their timeouts.
    const providers = yield* Effect.all(
      [
        readClaudeRateLimits(deps, claudeHome),
        readCodexRateLimits(deps, codexLayout.sharedHomePath),
        readGrokRateLimits(deps, resolveGrokHome()),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.fail(
          new RateLimitReadError({
            reason: "readFailed",
            detail: "Provider usage could not be read.",
            cause: Cause.squash(cause),
          }),
        ),
      ),
    );

    const snapshot: ProviderRateLimitsSnapshot = {
      providers: providers as ReadonlyArray<ProviderRateLimits>,
      readAt: observedAt,
    };
    cached = snapshot;
    cachedAtMs = nowMs;
    return snapshot;
  }).pipe(
    // The two home resolvers below take Path from context. Providing the
    // instance captured in `make` keeps `readSnapshot` requirement-free, so the
    // RPC handler can call it without threading a platform layer through.
    Effect.provideService(Path.Path, path),
  );

  return RateLimitService.of({ readSnapshot });
});

export const layer = Layer.effect(RateLimitService, make);

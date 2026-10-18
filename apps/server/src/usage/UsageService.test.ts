// @effect-diagnostics nodeBuiltinImport:off - the suite seeds and grows real
// transcript trees on disk, outside the service's Effect FileSystem.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  UsageDay,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scheduler from "effect/Scheduler";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { totalTokens } from "./usageTranscripts.ts";
import * as Schema from "effect/Schema";
const encodeUnknownJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

import * as UsageService from "./UsageService.ts";
import * as CursorUsageReader from "./cursorUsageReader.ts";

function claudeLine(id: number, outputTokens: number): string {
  return `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-01T10:00:00Z",
    requestId: `req_${id}`,
    sessionId: "session-1",
    message: {
      id: `msg_${id}`,
      model: "claude-fable-5",
      usage: { input_tokens: 10, output_tokens: outputTokens },
    },
  })}\n`;
}

const WINDOW: UsageSummaryInput = {
  timeZone: "UTC",
  sinceDay: UsageDay.make("2026-07-31"),
  untilDay: UsageDay.make("2026-08-02"),
};

const setup = Effect.gen(function* () {
  const home = yield* Effect.promise(() =>
    NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-service-test-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
  );
  const transcriptDir = NodePath.join(home, "claude", "projects", "proj");
  yield* Effect.promise(() => NodeFSP.mkdir(transcriptDir, { recursive: true }));
  return {
    home,
    transcript: NodePath.join(transcriptDir, "session.jsonl"),
    settings: {
      providers: {
        claudeAgent: { homePath: NodePath.join(home, "claude") },
        codex: { homePath: NodePath.join(home, "codex") },
      },
    },
  };
});

const serviceLayers = (input: {
  readonly prefix: string;
  readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
  readonly onRatesFetch?: () => void;
  /** Defaults to an unparsable document so every scan retries the fetch. */
  readonly ratesDocument?: unknown;
  readonly environment?: NodeJS.ProcessEnv;
  readonly readCursor?: CursorUsageReader.CursorAccountReader["Service"]["read"];
}) =>
  ServerConfig.layerTest(process.cwd(), { prefix: input.prefix }).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(
      Layer.succeed(CursorUsageReader.CursorAccountReader, {
        read:
          input.readCursor ??
          (() => Effect.succeed({ accountKey: null, records: [], missing: true, error: null })),
      }),
    ),
    Layer.provideMerge(ServerSettings.layerTest(input.settings)),
    Layer.provideMerge(
      Layer.succeed(HostProcessEnvironment, {
        PI_CODING_AGENT_DIR: NodePath.join(NodeOS.tmpdir(), `ronin-unused-pi-${input.prefix}`),
        ...input.environment,
      }),
    ),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            input.onRatesFetch?.();
            // Unparsable rates: every scan retries the fetch, which makes the
            // fetch count a boundary-level observation of how many scans ran.
            return HttpClientResponse.fromWeb(request, Response.json(input.ratesDocument ?? {}));
          }),
        ),
      ),
    ),
  );

function totalOutputTokens(summary: { buckets: readonly { totals: { outputTokens: number } }[] }) {
  return summary.buckets.reduce((sum, bucket) => sum + bucket.totals.outputTokens, 0);
}

describe("UsageService", () => {
  it.live("uses Pi's configured agent directory and session directory overrides", () =>
    Effect.gen(function* () {
      const { home, settings } = yield* setup;
      for (const sessionOverride of [false, true]) {
        const configured = NodePath.join(home, "configured-pi");
        const target = sessionOverride
          ? NodePath.join(home, "explicit-sessions")
          : NodePath.join(configured, "sessions");
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(target, { recursive: true });
          await NodeFSP.writeFile(
            NodePath.join(target, "usage.jsonl"),
            [
              { type: "session", id: "custom-session" },
              {
                type: "usage",
                id: "call",
                timestamp: "2026-08-01T10:00:00Z",
                provider: "openai",
                model: "unknown",
                usage: { input: 7 },
              },
            ]
              .map((line) => JSON.stringify(line))
              .join("\n") + "\n",
          );
        });
        const service = yield* UsageService.make.pipe(
          Effect.provide(
            serviceLayers({
              prefix: `usage-pi-override-${sessionOverride}`,
              settings: {
                ...settings,
                providers: { ...settings.providers, pi: { agentDir: configured } },
              },
              environment: {
                PI_CODING_AGENT_DIR: NodePath.join(home, "ignored-pi"),
                ...(sessionOverride ? { PI_CODING_AGENT_SESSION_DIR: target } : {}),
              },
            }),
          ),
        );
        const summary = yield* service.readSummary(WINDOW);
        const source = summary.sources.find((source) => source.fingerprint.provider === "pi");
        assert.strictEqual(source?.fingerprint.resolvedHomePath, target);
        assert.strictEqual(
          summary.buckets.find((bucket) => bucket.provider === "pi")?.totals.uncachedInputTokens,
          7,
        );
      }
    }).pipe(Effect.scoped),
  );

  it.live(
    "reads Pi per-model usage and auxiliary costs once across forks and repeated entries",
    () =>
      Effect.gen(function* () {
        const { home, settings } = yield* setup;
        const dir = NodePath.join(home, "pi", "sessions", "project");
        const usage = {
          input: 10,
          output: 5,
          cacheRead: 20,
          cacheWrite: 3,
          reasoning: 2,
          totalTokens: 38,
          cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
        };
        const parent = {
          type: "message",
          id: "a123abcd",
          parentId: null,
          timestamp: "2026-08-01T10:00:00Z",
          message: {
            role: "assistant",
            provider: "anthropic",
            model: "requested-model",
            responseModel: "actual-model",
            usage,
          },
        };
        const auxiliary = [
          {
            type: "message",
            id: "tool",
            message: { role: "toolResult", toolName: "classify", usage },
          },
          {
            type: "message",
            id: "image",
            message: {
              role: "toolResult",
              toolName: "image",
              usage: { ...usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          },
          { type: "compaction", id: "compact", usage },
          { type: "branch_summary", id: "summary", usage },
        ].map((entry) => ({ ...entry, timestamp: "2026-08-01T11:00:00Z" }));
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(dir, { recursive: true });
          await NodeFSP.writeFile(
            NodePath.join(dir, "parent.jsonl"),
            [
              { type: "session", id: "parent" },
              parent,
              ...auxiliary,
              {
                type: "usage",
                id: "warm",
                timestamp: "2026-08-01T12:00:00Z",
                kind: "cache_warm",
                provider: "openai",
                model: "actual-model",
                usage: { ...usage, cost: { ...usage.cost, total: 0 } },
              },
            ]
              .map((line) => encodeUnknownJsonString(line))
              .join("\n") + "\n",
          );
          await NodeFSP.writeFile(
            NodePath.join(dir, "fork.jsonl"),
            [
              { type: "session", id: "fork", parentSession: NodePath.join(dir, "parent.jsonl") },
              { ...parent, parentId: "relinked" },
              parent,
              ...auxiliary,
              {
                ...parent,
                timestamp: "2026-08-01T13:00:00Z",
                message: { ...parent.message, provider: "openai", responseModel: "another-model" },
              },
              { type: "get_session_stats", usage: { ...usage, cost: { total: 1000 } } },
            ]
              .map((line) => encodeUnknownJsonString(line))
              .join("\n") + "\n",
          );
        });
        yield* Effect.gen(function* () {
          const service = yield* UsageService.make;
          const first = yield* service.readSummary(WINDOW);
          const pi = first.buckets.filter((bucket) => bucket.provider === "pi");
          assert.strictEqual(
            pi.reduce((total, bucket) => total + bucket.costUsd, 0),
            44,
          );
          assert.strictEqual(
            pi.reduce((total, bucket) => total + totalTokens(bucket.totals), 0),
            228,
          );
          assert.deepStrictEqual(pi.map((bucket) => bucket.model).sort(), [
            "Tools/summaries",
            "anthropic/actual-model",
            "openai/actual-model",
            "openai/another-model",
          ]);
          const assistant = pi.find((bucket) => bucket.model === "anthropic/actual-model");
          assert.deepStrictEqual(assistant?.totals, {
            uncachedInputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 20,
            cacheCreationTokens: 3,
            reasoningTokens: 2,
          });
          assert.strictEqual(assistant?.costSource, "providerReported");
          assert.approximately(assistant?.categoryCostUsd?.input ?? NaN, 10 / 38, 1e-6);
          assert.approximately(assistant?.categoryCostUsd?.cacheRead ?? NaN, 2 / 38, 1e-6);
          assert.approximately(assistant?.categoryCostUsd?.cacheWrite ?? NaN, 6 / 38, 1e-6);
          assert.approximately(assistant?.categoryCostUsd?.output ?? NaN, 20 / 38, 1e-6);
          assert.strictEqual(assistant?.cacheSavingsUsd, 18);
          const warm = pi.find((bucket) => bucket.model === "openai/actual-model");
          assert.strictEqual(warm?.costSource, "modelPriced");
          assert.strictEqual(warm?.costUsd, 38);
          assert.deepStrictEqual(warm?.categoryCostUsd, {
            input: 10,
            cacheRead: 2,
            cacheWrite: 6,
            output: 20,
          });
          assert.strictEqual(warm?.cacheSavingsUsd, 18);
          assert.strictEqual(
            first.sources.filter((source) => source.fingerprint.provider === "pi").length,
            1,
          );
          // Warm scans retain header state and only charge appended entries.
          yield* Effect.promise(() =>
            NodeFSP.appendFile(
              NodePath.join(dir, "fork.jsonl"),
              encodeUnknownJsonString({
                ...parent,
                id: "new",
                timestamp: "2026-08-01T14:00:00Z",
                message: { ...parent.message, responseModel: "latest-model" },
              }) + "\n",
            ),
          );
          const grown = yield* service.readSummary(WINDOW);
          assert.strictEqual(
            grown.buckets
              .filter((bucket) => bucket.provider === "pi")
              .reduce((total, bucket) => total + bucket.costUsd, 0),
            45,
          );
          yield* service.awaitPersisted;
          const restarted = yield* UsageService.make;
          assert.deepStrictEqual((yield* restarted.readSummary(WINDOW)).buckets, grown.buckets);
        }).pipe(
          Effect.scoped,
          Effect.provide(
            serviceLayers({
              prefix: "usage-pi-fork",
              environment: { PI_CODING_AGENT_DIR: NodePath.join(home, "pi") },
              ratesDocument: {
                "actual-model": {
                  input_cost_per_token: 1,
                  output_cost_per_token: 4,
                  cache_read_input_token_cost: 0.1,
                  cache_creation_input_token_cost: 2,
                },
              },
              settings: {
                ...settings,
                providerInstances: {
                  [ProviderInstanceId.make("pi-extra")]: {
                    driver: ProviderDriverKind.make("pi"),
                    enabled: false,
                    environment: [
                      {
                        name: "PI_CODING_AGENT_DIR",
                        value: NodePath.join(home, "pi"),
                        sensitive: false,
                      },
                    ],
                  },
                },
              },
            }),
          ),
        );
      }).pipe(Effect.scoped),
  );

  it.live("reports missing Pi history and skips malformed records without losing valid usage", () =>
    Effect.gen(function* () {
      const { home, settings } = yield* setup;
      yield* Effect.gen(function* () {
        const service = yield* UsageService.make;
        const missing = yield* service.readSummary(WINDOW);
        assert.strictEqual(
          missing.sources.find((source) => source.fingerprint.provider === "pi")?.status,
          "missing",
        );
        const dir = NodePath.join(home, "pi", "sessions");
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(dir, { recursive: true });
          await NodeFSP.writeFile(
            NodePath.join(dir, "session.jsonl"),
            [
              "{broken",
              "null",
              encodeUnknownJsonString({ type: "session", id: "valid" }),
              encodeUnknownJsonString({
                type: "message",
                id: "bad",
                timestamp: "invalid",
                message: {
                  role: "assistant",
                  provider: "openai",
                  model: "model",
                  usage: { input: 100 },
                },
              }),
              encodeUnknownJsonString({
                type: "message",
                id: "valid",
                timestamp: "2026-08-01T10:00:00Z",
                message: {
                  role: "assistant",
                  provider: "openai",
                  model: "model",
                  usage: {
                    input: -1,
                    cacheRead: "100",
                    output: 7,
                    reasoning: 50,
                    cost: { total: -1 },
                  },
                },
              }),
            ].join("\n") + "\n",
          );
        });
        const summary = yield* service.readSummary(WINDOW);
        const pi = summary.buckets.filter((bucket) => bucket.provider === "pi");
        assert.strictEqual(pi.length, 1);
        assert.strictEqual(pi[0] && totalTokens(pi[0].totals), 7);
        assert.strictEqual(pi[0]?.totals.reasoningTokens, 7);
        assert.strictEqual(pi[0]?.costSource, "unpriced");
      }).pipe(
        Effect.scoped,
        Effect.provide(
          serviceLayers({
            prefix: "usage-pi-malformed",
            settings,
            environment: { PI_CODING_AGENT_DIR: NodePath.join(home, "pi") },
          }),
        ),
      );
    }).pipe(Effect.scoped),
  );

  it.live.skipIf(HostProcessPlatform.defaultValue() === "win32" || process.getuid?.() === 0)(
    "reports unreadable transcripts as partial and recovers once they can be read",
    () =>
      Effect.gen(function* () {
        const { transcript, settings, home } = yield* setup;
        const unreadable = NodePath.join(NodePath.dirname(transcript), "other.jsonl");
        yield* Effect.promise(async () => {
          await NodeFSP.writeFile(transcript, claudeLine(1, 5));
          await NodeFSP.writeFile(unreadable, claudeLine(2, 7));
          await NodeFSP.chmod(unreadable, 0);
        });
        yield* Effect.addFinalizer(() => Effect.promise(() => NodeFSP.chmod(unreadable, 0o600)));
        const service = yield* UsageService.make.pipe(
          Effect.provide(
            serviceLayers({
              prefix: "usage-unreadable-test",
              settings,
              environment: {
                GROK_HOME: NodePath.join(home, "grok"),
                OPENCODE_DATA_DIR: NodePath.join(home, "opencode"),
                ANTIGRAVITY_DATA_DIR: NodePath.join(home, "antigravity"),
              },
            }),
          ),
        );
        const partial = yield* service.readSummary(WINDOW);
        assert.strictEqual(totalOutputTokens(partial), 5);
        assert.strictEqual(partial.sources[0]?.status, "partial");
        yield* Effect.promise(() => NodeFSP.chmod(unreadable, 0o600));
        const healthy = yield* service.readSummary(WINDOW);
        assert.strictEqual(totalOutputTokens(healthy), 12);
        assert.strictEqual(healthy.sources[0]?.status, "ok");
        assert.isNull(healthy.sources[0]?.message);
      }).pipe(Effect.scoped),
  );

  it.live("answers local usage before Cursor and joins one refresh for the final summary", () =>
    Effect.gen(function* () {
      const { home, transcript, settings } = yield* setup;
      yield* Effect.promise(async () => {
        await NodeFSP.writeFile(transcript, claudeLine(1, 17));
        await NodeFSP.mkdir(NodePath.join(home, "cursor"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(home, "cursor", "auth.json"), "{}");
      });
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let reads = 0;
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-provisional-test",
            settings,
            environment: {
              HOME: home,
              XDG_CONFIG_HOME: home,
              OPENCODE_DATA_DIR: NodePath.join(home, "opencode"),
              ANTIGRAVITY_DATA_DIR: NodePath.join(home, "antigravity"),
              GROK_HOME: NodePath.join(home, "grok"),
            },
            readCursor: () =>
              Effect.gen(function* () {
                reads += 1;
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
                return {
                  accountKey: "test-account",
                  missing: false,
                  error: null,
                  records: [
                    {
                      provider: "cursor" as const,
                      timestampMs: Date.parse("2026-08-01T10:00:00Z"),
                      model: "test",
                      sessionId: "cursor-session",
                      totals: {
                        uncachedInputTokens: 0,
                        cachedInputTokens: 0,
                        cacheCreationTokens: 0,
                        outputTokens: 50,
                        reasoningTokens: 0,
                      },
                      reportedCostUsd: null,
                      speed: "standard" as const,
                      dedupeKey: "cursor-record",
                    },
                  ],
                };
              }),
          }).pipe(Layer.provideMerge(Layer.succeed(HostProcessPlatform, "linux"))),
        ),
      );
      const provisional = yield* service.readSummary(WINDOW);
      yield* Deferred.await(started);
      assert.isTrue(
        provisional.sources.some(
          (source) => source.fingerprint.provider === "cursor" && source.refreshing === true,
        ),
      );
      assert.strictEqual(totalOutputTokens(provisional), 17);
      const final = yield* service
        .readSummary({ ...WINDOW, awaitRefresh: true })
        .pipe(Effect.forkChild);
      yield* Deferred.succeed(release, undefined);
      const summary = yield* Fiber.join(final);
      assert.strictEqual(totalOutputTokens(summary), 67);
      assert.isFalse(summary.sources.some((source) => source.refreshing));
      assert.strictEqual(reads, 1);
      yield* service.awaitPersisted;
    }).pipe(Effect.scoped),
  );
  it.live("reads history from disabled configured account homes", () =>
    Effect.gen(function* () {
      const { settings, home } = yield* setup;
      const accountHome = NodePath.join(home, "claude-account");
      const transcript = NodePath.join(accountHome, "projects", "session.jsonl");
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.dirname(transcript), { recursive: true });
        await NodeFSP.writeFile(transcript, claudeLine(2, 17));
      });

      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-service-account-home-test",
            environment: { GROK_HOME: NodePath.join(home, "grok") },
            settings: {
              ...settings,
              providerInstances: {
                [ProviderInstanceId.make("claude-work")]: {
                  driver: ProviderDriverKind.make("claudeAgent"),
                  enabled: false,
                  environment: [
                    { name: "CLAUDE_CONFIG_DIR", value: accountHome, sensitive: false },
                  ],
                },
              },
            },
          }),
        ),
      );

      const summary = yield* service.readSummary(WINDOW);
      assert.include(
        summary.sources.map((source) => source.fingerprint.resolvedHomePath),
        NodePath.join(accountHome, "projects"),
      );
    }).pipe(Effect.scoped),
  );

  it.live("counts appended usage on a rescan of a grown transcript", () =>
    Effect.gen(function* () {
      const { transcript, settings } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));

      const service = yield* UsageService.make.pipe(
        Effect.provide(serviceLayers({ prefix: "usage-service-grow-test", settings })),
      );

      // Deltas, not absolutes: Grok and Antigravity read fixed homes that this
      // suite cannot redirect, so a developer's own transcripts may also land
      // in the window. The appended line is what the resume path is about.
      const first = yield* service.readSummary(WINDOW);

      yield* Effect.promise(() => NodeFSP.appendFile(transcript, claudeLine(2, 7)));
      const second = yield* service.readSummary(WINDOW);
      assert.strictEqual(totalOutputTokens(second) - totalOutputTokens(first), 7);
    }).pipe(Effect.scoped),
  );

  it.live("keeps concurrent usage reads on their own provider settings snapshot", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      const nextHome = NodePath.join(home, "next-claude");
      yield* Effect.promise(async () => {
        await NodeFSP.writeFile(transcript, claudeLine(1, 5));
        await NodeFSP.mkdir(NodePath.join(nextHome, "projects"), { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(nextHome, "projects", "session.jsonl"),
          claudeLine(2, 17),
        );
        await NodeFSP.mkdir(NodePath.join(home, "cursor"));
        await NodeFSP.writeFile(NodePath.join(home, "cursor", "auth.json"), "{}");
      });
      const cursorStarted = yield* Deferred.make<void>();
      const releaseCursor = yield* Deferred.make<void>();
      const secondScan = yield* Deferred.make<void>();
      let rates = 0;
      yield* Effect.gen(function* () {
        const service = yield* UsageService.make;
        const settingsService = yield* ServerSettings.ServerSettingsService;
        const first = yield* service
          .readSummary({ ...WINDOW, awaitRefresh: true })
          .pipe(Effect.forkChild);
        yield* Deferred.await(cursorStarted);
        yield* settingsService.updateSettings({
          providers: { claudeAgent: { homePath: nextHome } },
        });
        const second = yield* service
          .readSummary({ ...WINDOW, awaitRefresh: true })
          .pipe(Effect.forkChild);
        yield* Deferred.await(secondScan);
        yield* Deferred.succeed(releaseCursor, undefined);
        const firstResult = yield* Fiber.join(first);
        const secondResult = yield* Fiber.join(second);
        assert.strictEqual(totalOutputTokens(firstResult), 5);
        assert.strictEqual(totalOutputTokens(secondResult), 17);
        assert.include(
          secondResult.sources.map((source) => source.fingerprint.resolvedHomePath),
          NodePath.join(nextHome, "projects"),
        );
      }).pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-settings-snapshot-test",
            settings,
            environment: {
              HOME: home,
              XDG_CONFIG_HOME: home,
              GROK_HOME: NodePath.join(home, "grok"),
              OPENCODE_DATA_DIR: NodePath.join(home, "opencode"),
              ANTIGRAVITY_DATA_DIR: NodePath.join(home, "antigravity"),
            },
            onRatesFetch: () => {
              rates += 1;
              if (rates === 2) Deferred.doneUnsafe(secondScan, Effect.void);
            },
            readCursor: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(cursorStarted, undefined);
                yield* Deferred.await(releaseCursor);
                return { accountKey: null, records: [], missing: true, error: null };
              }),
          }).pipe(Layer.provideMerge(Layer.succeed(HostProcessPlatform, "linux"))),
        ),
      );
    }).pipe(Effect.scoped),
  );

  it.live("shares one scan between concurrent identical requests", () =>
    Effect.gen(function* () {
      const { transcript, settings } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));

      let ratesFetches = 0;
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-service-flight-test",
            settings,
            onRatesFetch: () => {
              ratesFetches += 1;
            },
          }),
        ),
      );

      const [first, second] = yield* Effect.all(
        [service.readSummary(WINDOW), service.readSummary(WINDOW)],
        { concurrency: 2 },
      );
      assert.deepStrictEqual(first, second);
      assert.strictEqual(ratesFetches, 1);

      // A later request is fresh work again, not a stale cached answer.
      yield* service.readSummary(WINDOW);
      assert.strictEqual(ratesFetches, 2);
    }).pipe(Effect.scoped),
  );

  it.live("refetches a rate table inside its TTL only when the client asks", () =>
    Effect.gen(function* () {
      const { transcript, settings } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));

      let ratesFetches = 0;
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-service-rates-refresh-test",
            settings,
            ratesDocument: {
              "claude-fable-5": { input_cost_per_token: 1e-5, output_cost_per_token: 5e-5 },
            },
            onRatesFetch: () => {
              ratesFetches += 1;
            },
          }),
        ),
      );

      const first = yield* service.readSummary(WINDOW);
      assert.strictEqual(ratesFetches, 1);
      assert.strictEqual(first.pricing.status, "fresh");

      // Inside the daily TTL a plain rescan keeps the cached table.
      yield* TestClock.adjust(Duration.minutes(2));
      yield* service.readSummary(WINDOW);
      assert.strictEqual(ratesFetches, 1);

      // An explicit refresh fetches again so a newly listed model gets priced.
      // A burst of refreshes shares that one fetch.
      const [refreshed] = yield* Effect.all([service.refreshRates, service.refreshRates], {
        concurrency: 2,
      });
      assert.strictEqual(ratesFetches, 2);
      assert.strictEqual(refreshed.status, "fresh");
      assert.strictEqual(refreshed.knownModels, 1);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.live("does not orphan an in-flight scan when its first caller is interrupted", () =>
    Effect.gen(function* () {
      const { settings } = yield* setup;
      const service = yield* UsageService.make.pipe(
        Effect.provide(serviceLayers({ prefix: "usage-service-interruption-test", settings })),
      );

      let orphanedAt: number | undefined;
      for (let interruptAt = 1; interruptAt <= 31; interruptAt += 1) {
        const tasks: Array<() => void> = [];
        const dispatcher: Scheduler.SchedulerDispatcher = {
          scheduleTask: (task) => tasks.push(task),
          flush: () => {
            let task: (() => void) | undefined;
            while ((task = tasks.shift()) !== undefined) task();
          },
        };

        let requestFiber: Fiber.Fiber<unknown, unknown> | undefined;
        let requestChecks = 0;
        const scheduler: Scheduler.Scheduler = {
          executionMode: "async",
          makeDispatcher: () => dispatcher,
          shouldYield: (fiber) => {
            if (fiber !== requestFiber) return false;
            requestChecks += 1;
            if (requestChecks !== interruptAt) return false;
            fiber.interruptUnsafe();
            return true;
          },
        };

        // Each candidate needs a distinct key because the broken case leaves
        // its entry in the service's private in-flight map. The invalid window
        // keeps the real scan synchronous once its detached fiber starts.
        const input: UsageSummaryInput = {
          ...WINDOW,
          sinceDay: UsageDay.make("2026-09-01"),
          untilDay: UsageDay.make(`2026-08-${String(interruptAt).padStart(2, "0")}`),
        };
        const first = yield* service
          .readSummary(input)
          .pipe(
            Effect.exit,
            Effect.provideService(Scheduler.Scheduler, scheduler),
            Effect.forkChild,
          );
        requestFiber = first;
        yield* Effect.yieldNow;
        dispatcher.flush();

        const second = yield* service.readSummary(input).pipe(
          Effect.match({
            onFailure: (error) => error.reason,
            onSuccess: () => "success" as const,
          }),
          Effect.provideService(Scheduler.Scheduler, scheduler),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        dispatcher.flush();
        const secondExit = second.pollUnsafe();
        if (secondExit === undefined) {
          second.interruptUnsafe();
          orphanedAt = interruptAt;
          break;
        }
        if (Exit.isFailure(secondExit)) {
          assert.fail("the matching request fiber was interrupted");
        }
        assert.strictEqual(secondExit.value, "invalidWindow");
      }

      assert.isUndefined(
        orphanedAt,
        `interruption left the next matching request pending at scheduler check ${orphanedAt}`,
      );
    }).pipe(Effect.scoped),
  );
});

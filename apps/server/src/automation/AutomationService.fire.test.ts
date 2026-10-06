/**
 * What firing an automation actually dispatches.
 *
 * This suite exists because of a real defect: `fire` originally sent a single
 * `thread.turn.start` carrying a `bootstrap.createThread` payload. That field
 * is expanded by the WebSocket layer, not by the engine — the decider requires
 * the thread to already exist — so every scheduled run failed its invariant,
 * got swallowed by the error handler, and was recorded as `failed` with no
 * thread. The pure schedule tests all passed throughout.
 *
 * So these assert the *order of dispatched commands*, which is the thing that
 * was wrong. A test that only checked "a run was recorded" would have passed
 * against the broken version too.
 */
import {
  type Automation,
  AutomationId,
  type AutomationRun,
  type ModelSelection,
  type OrchestrationCommand,
  ProjectId,
  ProviderInstanceId,
  SecretRef,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import { AutomationService, make } from "./AutomationService.ts";
import { AutomationStore } from "./AutomationStore.ts";
import type { AutomationWebhookCredentials } from "./AutomationStore.ts";
import { SecretRequests } from "../secrets/SecretRequests.ts";

const PROJECT_ID = ProjectId.make("project-1");
const MODEL: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
};

const automation = (overrides: Partial<Automation> = {}): Automation => ({
  id: AutomationId.make("automation-1"),
  projectId: PROJECT_ID,
  title: "Triage issues",
  prompt: "Check for new issues.",
  schedule: { _tag: "interval", everyMinutes: 60 },
  envMode: "local",
  modelSelection: null,
  enabled: true,
  stopAfterConsecutiveFailures: 3,
  consecutiveFailureCount: 0,
  disabledReason: null,
  disabledAt: null,
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
  lastRunAt: null,
  nextRunAt: "2026-08-17T01:00:00.000Z",
  ...overrides,
});

interface Harness {
  readonly credentials: Map<string, AutomationWebhookCredentials>;
  readonly consumed: Array<{ ref: SecretRef; projectId: ProjectId }>;
  readonly dispatched: OrchestrationCommand[];
  readonly stored: Map<string, Automation>;
  readonly runs: Array<{ outcome: string; threadId: string | null; detail: string | null }>;
}

function makeHarness(options?: {
  readonly isRepo?: boolean;
  readonly failTurnStart?: boolean;
  readonly projectMissing?: boolean;
  readonly defaultModelSelection?: ModelSelection | null;
  readonly onTurnStart?: Effect.Effect<void>;
  readonly onListDue?: Effect.Effect<void>;
}) {
  const state: Harness = {
    dispatched: [],
    stored: new Map(),
    runs: [],
    credentials: new Map(),
    consumed: [],
  };

  const storeLayer = Layer.succeed(AutomationStore, {
    list: () => Effect.succeed([...state.stored.values()]),
    get: (id: string) =>
      Effect.succeed(() => {
        const found = state.stored.get(id);
        return found === undefined ? Option.none() : Option.some(found);
      }).pipe(Effect.map((resolve) => resolve())),
    getWebhookCredentials: (id: AutomationId) =>
      Effect.sync(() => state.credentials.get(id) ?? null),
    upsert: (value: Automation, credentials?: AutomationWebhookCredentials | null) =>
      Effect.sync(() => {
        state.stored.set(value.id, value);
        if (credentials === null) state.credentials.delete(value.id);
        else if (credentials !== undefined) state.credentials.set(value.id, credentials);
      }),
    remove: (id: AutomationId) => Effect.sync(() => state.stored.delete(id)),
    listDue: () =>
      Effect.sync(() => [...state.stored.values()]).pipe(
        Effect.tap(() => options?.onListDue ?? Effect.void),
      ),
    appendRun: (run: AutomationRun) =>
      Effect.sync(() => {
        state.runs.push({
          outcome: run.outcome,
          threadId: run.threadId,
          detail: run.detail,
        });
      }),
    listRuns: () => Effect.succeed([]),
  } as never);

  const engineLayer = Layer.succeed(OrchestrationEngineService, {
    readEvents: () => Stream.empty,
    dispatch: (command: OrchestrationCommand) =>
      Effect.gen(function* () {
        if (options?.failTurnStart === true && command.type === "thread.turn.start") {
          return yield* Effect.die(new Error("turn start refused"));
        }
        state.dispatched.push(command);
        if (command.type === "thread.turn.start") yield* options?.onTurnStart ?? Effect.void;
        return { sequence: state.dispatched.length };
      }),
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
  } as never);

  const snapshotLayer = Layer.succeed(ProjectionSnapshotQuery, {
    getSnapshot: () =>
      Effect.succeed({
        snapshotSequence: 0,
        projects: [{ id: PROJECT_ID }],
        threads: [],
        updatedAt: "2026-08-17T00:00:00.000Z",
      }),
    getProjectShellById: () =>
      Effect.succeed(
        options?.projectMissing === true
          ? Option.none()
          : Option.some({
              id: PROJECT_ID,
              workspaceRoot: "/tmp/project",
              defaultModelSelection:
                options?.defaultModelSelection === undefined
                  ? MODEL
                  : options.defaultModelSelection,
            }),
      ),
  } as never);

  const gitLayer = Layer.succeed(GitWorkflowService, {
    localStatus: () =>
      Effect.succeed({
        isRepo: options?.isRepo ?? true,
        refName: (options?.isRepo ?? true) ? "main" : null,
      }),
    remoteExists: () => Effect.succeed(false),
    fetchRemote: () => Effect.void,
    resolveRemoteTrackingCommit: () =>
      Effect.succeed({ commitSha: "abc123", remoteRefName: "origin/main" }),
    createWorktree: () =>
      Effect.succeed({
        worktree: { path: "/tmp/project-worktree", refName: "t3/deadbeef" },
      }),
  } as never);

  const settingsLayer = Layer.succeed(ServerSettings.ServerSettingsService, {
    getSettings: Effect.succeed({ newWorktreesStartFromOrigin: false }),
  } as never);

  // Counter-seeded rather than random so every generated id in a run is
  // distinct and the assertions stay deterministic.
  let cryptoSeed = 0;
  const cryptoLayer = Layer.succeed(
    Crypto.Crypto,
    Crypto.make({
      randomBytes: (size) => {
        cryptoSeed += 1;
        return Uint8Array.from({ length: size }, (_value, index) => (cryptoSeed + index) % 256);
      },
      digest: (_algorithm, data) => Effect.succeed(data),
    }),
  );

  const layer = Layer.effect(AutomationService, make).pipe(
    Layer.provide(
      Layer.mergeAll(
        storeLayer,
        engineLayer,
        snapshotLayer,
        gitLayer,
        settingsLayer,
        cryptoLayer,
        Layer.mock(SecretRequests)({
          consume: (input) =>
            Effect.sync(() => {
              state.consumed.push(input);
              return "private-signing-value";
            }),
        }),
      ),
    ),
  );

  return { state, layer };
}

const dispatchedTypes = (state: Harness) => state.dispatched.map((command) => command.type);

it.effect(
  "consumes a signing secret reference in its project without putting the value in the schedule",
  () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const service = yield* AutomationService;
      const ref = SecretRef.make("secret-ref:0123456789abcdef0123456789abcdef");
      const created = yield* service.create({
        projectId: PROJECT_ID,
        title: "Webhook",
        prompt: "Review {{body.number}}",
        envMode: "worktree",
        schedule: {
          _tag: "webhook",
          signature: {
            header: "x-hub-signature-256",
            prefix: "sha256=",
            encoding: "hex",
            secretRef: ref,
          },
        },
      });
      expect(harness.state.consumed).toEqual([{ ref, projectId: PROJECT_ID }]);
      expect(created.webhook?.hasSecret).toBe(true);
      expect(created.nextRunAt).toBeNull();
      const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(created);
      expect(encoded).not.toContain("private-signing-value");
      expect(encoded).not.toContain(ref);
      expect(harness.state.credentials.get(created.id)?.secret).toBe("private-signing-value");
      const edited = yield* service.update({
        id: created.id,
        schedule: {
          _tag: "webhook",
          signature: { header: "x-signature", prefix: "", encoding: "base64" },
        },
      });
      expect(edited.webhook?.path).toBe(created.webhook?.path);
      expect(harness.state.consumed).toHaveLength(1);
      const timed = yield* service.update({
        id: created.id,
        schedule: { _tag: "interval", everyMinutes: 60 },
      });
      expect(timed.webhook).toBeUndefined();
      expect(harness.state.credentials.has(created.id)).toBe(false);
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect("replaces a webhook URL while retaining its signature and rejecting the old URL", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const service = yield* AutomationService;
    const created = yield* service.create({
      projectId: PROJECT_ID,
      title: "Webhook",
      prompt: "Review event",
      envMode: "local",
      schedule: {
        _tag: "webhook",
        signature: { header: "x-signature", encoding: "hex", prefix: "", secret: "signing-value" },
      },
    });
    const oldToken = harness.state.credentials.get(created.id)!.token;
    const replaced = yield* service.rotateWebhookToken(created.id);
    const credentials = harness.state.credentials.get(created.id)!;
    expect(replaced.webhook?.path).not.toBe(created.webhook?.path);
    expect(credentials.secret).toBe("signing-value");
    expect(credentials.token).not.toBe(oldToken);
    expect(
      yield* service
        .runWebhook({ id: created.id, token: oldToken, prompt: "Old event" })
        .pipe(Effect.flip),
    ).toMatchObject({ reason: "notFound" });
    expect(harness.state.dispatched).toEqual([]);
    expect(
      (yield* service.runWebhook({ id: created.id, token: credentials.token, prompt: "New event" }))
        .outcome,
    ).toBe("started");
    expect(
      harness.state.dispatched.find((command) => command.type === "thread.turn.start"),
    ).toMatchObject({ message: { text: "New event" } });
    yield* service.update({ id: created.id, enabled: false });
    expect(
      yield* service
        .runWebhook({ id: created.id, token: credentials.token, prompt: "Disabled event" })
        .pipe(Effect.flip),
    ).toMatchObject({ reason: "notFound" });
    yield* service.remove(created.id);
    expect(
      yield* service
        .runWebhook({ id: created.id, token: credentials.token, prompt: "Removed event" })
        .pipe(Effect.flip),
    ).toMatchObject({ reason: "notFound" });
    expect(harness.state.runs).toHaveLength(1);
  }).pipe(Effect.provide(harness.layer));
});

/** Runs `runNow` against a harness and hands back its captured state. */
const runNowWith = (harness: ReturnType<typeof makeHarness>) =>
  Effect.flatMap(Effect.service(AutomationService), (service) =>
    service.runNow(AutomationId.make("automation-1")),
  ).pipe(Effect.provide(harness.layer), Effect.as(harness.state));

describe("AutomationService.fire", () => {
  it.effect("creates the thread before starting the turn", () =>
    Effect.gen(function* () {
      // The regression: `thread.turn.start` alone fails `requireThread` in the
      // decider, because `bootstrap` is only ever expanded by the WS layer.
      const harness = makeHarness();
      harness.state.stored.set("automation-1", automation());

      const state = yield* runNowWith(harness);

      expect(dispatchedTypes(state)).toEqual(["thread.create", "thread.turn.start"]);
      expect(state.runs.at(-1)?.outcome).toBe("started");
      expect(state.runs.at(-1)?.threadId).not.toBeNull();
    }),
  );

  it.effect("sends the turn into the thread it just created", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.state.stored.set("automation-1", automation());

      const state = yield* runNowWith(harness);

      const created = state.dispatched.find((command) => command.type === "thread.create");
      const started = state.dispatched.find((command) => command.type === "thread.turn.start");
      expect(created).toBeDefined();
      expect(started).toBeDefined();
      expect((started as { threadId: string }).threadId).toBe(
        (created as { threadId: string }).threadId,
      );
    }),
  );

  it.effect("carries the automation's prompt as the user message", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.state.stored.set("automation-1", automation({ prompt: "Summarise yesterday." }));

      const state = yield* runNowWith(harness);

      const started = state.dispatched.find((command) => command.type === "thread.turn.start") as {
        message: { text: string };
      };
      expect(started.message.text).toBe("Summarise yesterday.");
    }),
  );

  it.effect("actually makes a worktree in worktree mode", () =>
    Effect.gen(function* () {
      // The panel promises isolation here; before the fix nothing was created
      // and the run would have used the project checkout.
      const harness = makeHarness();
      harness.state.stored.set("automation-1", automation({ envMode: "worktree" }));

      const state = yield* runNowWith(harness);

      expect(dispatchedTypes(state)).toEqual([
        "thread.create",
        "thread.meta.update",
        "thread.turn.start",
      ]);
      const meta = state.dispatched.find((command) => command.type === "thread.meta.update") as {
        worktreePath: string;
      };
      expect(meta.worktreePath).toBe("/tmp/project-worktree");
    }),
  );

  it.effect("refuses worktree mode outside a repo rather than writing into the checkout", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ isRepo: false });
      harness.state.stored.set("automation-1", automation({ envMode: "worktree" }));

      const state = yield* runNowWith(harness);

      expect(dispatchedTypes(state)).not.toContain("thread.turn.start");
      expect(state.runs.at(-1)?.outcome).toBe("failed");
    }),
  );

  it.effect("deletes the thread it created when the turn will not start", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ failTurnStart: true });
      harness.state.stored.set("automation-1", automation());

      const state = yield* runNowWith(harness);

      // No empty thread left behind in the sidebar.
      expect(dispatchedTypes(state)).toContain("thread.delete");
      expect(state.runs.at(-1)?.outcome).toBe("failed");
    }),
  );

  it.effect("skips without dispatching when the project is gone", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ projectMissing: true });
      harness.state.stored.set("automation-1", automation());

      const state = yield* runNowWith(harness);

      expect(state.dispatched).toEqual([]);
      expect(state.runs.at(-1)?.outcome).toBe("skipped");
    }),
  );

  it.effect("skips when there is no model to send to", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ defaultModelSelection: null });
      harness.state.stored.set("automation-1", automation({ modelSelection: null }));

      const state = yield* runNowWith(harness);

      expect(state.dispatched).toEqual([]);
      expect(state.runs.at(-1)?.outcome).toBe("skipped");
    }),
  );

  it.effect("re-anchors the schedule after a manual run", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.state.stored.set("automation-1", automation({ lastRunAt: null }));

      const state = yield* runNowWith(harness);

      expect(state.stored.get("automation-1")?.lastRunAt).not.toBeNull();
    }),
  );

  it.effect("counts a failed start and pauses at the threshold", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ failTurnStart: true });
      harness.state.stored.set(
        "automation-1",
        automation({ stopAfterConsecutiveFailures: 1, consecutiveFailureCount: 0 }),
      );

      const state = yield* runNowWith(harness);
      const stored = state.stored.get("automation-1");

      expect(state.runs.at(-1)?.outcome).toBe("failed");
      expect(stored?.enabled).toBe(false);
      expect(stored?.consecutiveFailureCount).toBe(1);
      expect(stored?.disabledReason).toBe("failures");
      expect(stored?.nextRunAt).toBeNull();
    }),
  );

  it.effect("resets the streak after a successful start", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.state.stored.set("automation-1", automation({ consecutiveFailureCount: 2 }));

      const state = yield* runNowWith(harness);

      expect(state.runs.at(-1)?.outcome).toBe("started");
      expect(state.stored.get("automation-1")?.consecutiveFailureCount).toBe(0);
    }),
  );

  it.effect("keeps failure evidence when a disabled row is rerun by hand", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.state.stored.set(
        "automation-1",
        automation({
          enabled: false,
          consecutiveFailureCount: 3,
          disabledReason: "failures",
          disabledAt: "2026-08-17T00:30:00.000Z",
          nextRunAt: null,
        }),
      );

      const state = yield* runNowWith(harness);
      const stored = state.stored.get("automation-1");

      expect(state.runs.at(-1)?.outcome).toBe("started");
      expect(stored?.enabled).toBe(false);
      expect(stored?.consecutiveFailureCount).toBe(3);
      expect(stored?.disabledReason).toBe("failures");
    }),
  );
});

describe("automation concurrency", () => {
  for (const mutation of ["edit-and-pause", "delete"] as const) {
    it.effect(`preserves a concurrent ${mutation} when a run finishes`, () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const harness = makeHarness({
          onTurnStart: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        });
        const original = automation();
        harness.state.stored.set(original.id, original);
        yield* Effect.gen(function* () {
          const service = yield* AutomationService;
          const run = yield* Effect.forkChild(service.runNow(original.id));
          yield* Deferred.await(entered);
          const change = yield* Effect.forkChild(
            mutation === "delete"
              ? service.remove(original.id).pipe(Effect.asVoid)
              : service
                  .update({
                    id: original.id,
                    enabled: false,
                    title: "Edited",
                    prompt: "New prompt",
                  })
                  .pipe(Effect.asVoid),
          );
          yield* Effect.yieldNow;
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(run);
          yield* Fiber.join(change);
        }).pipe(Effect.provide(harness.layer));
        if (mutation === "delete") expect(harness.state.stored.has(original.id)).toBe(false);
        else
          expect(harness.state.stored.get(original.id)).toMatchObject({
            enabled: false,
            title: "Edited",
            prompt: "New prompt",
            nextRunAt: null,
          });
      }),
    );
  }

  it.effect("does not fire a due snapshot after a manual run has rescheduled it", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const dueRead = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const harness = makeHarness({
        onTurnStart: Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
        ),
        onListDue: Deferred.succeed(dueRead, undefined),
      });
      const original = automation({
        nextRunAt: DateTime.formatIso(yield* DateTime.now),
      });
      harness.state.stored.set(original.id, original);
      yield* Effect.gen(function* () {
        const service = yield* AutomationService;
        const run = yield* Effect.forkChild(service.runNow(original.id));
        yield* Deferred.await(entered);
        const tick = yield* Effect.forkChild(service.tick);
        yield* Deferred.await(dueRead);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);
        yield* Fiber.join(tick);
      }).pipe(Effect.provide(harness.layer));
      expect(
        harness.state.dispatched.filter((command) => command.type === "thread.turn.start"),
      ).toHaveLength(1);
      expect(harness.state.runs).toHaveLength(1);
    }),
  );
});

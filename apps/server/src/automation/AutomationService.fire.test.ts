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
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "@effect/vitest";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import { AutomationService, make } from "./AutomationService.ts";
import { AutomationStore } from "./AutomationStore.ts";

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
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
  lastRunAt: null,
  nextRunAt: "2026-08-17T01:00:00.000Z",
  ...overrides,
});

interface Harness {
  readonly dispatched: OrchestrationCommand[];
  readonly stored: Map<string, Automation>;
  readonly runs: Array<{ outcome: string; threadId: string | null; detail: string | null }>;
}

function makeHarness(options?: {
  readonly isRepo?: boolean;
  readonly failTurnStart?: boolean;
  readonly projectMissing?: boolean;
  readonly defaultModelSelection?: ModelSelection | null;
}) {
  const state: Harness = { dispatched: [], stored: new Map(), runs: [] };

  const storeLayer = Layer.succeed(AutomationStore, {
    list: () => Effect.succeed([...state.stored.values()]),
    get: (id: string) =>
      Effect.succeed(() => {
        const found = state.stored.get(id);
        return found === undefined ? Option.none() : Option.some(found);
      }).pipe(Effect.map((resolve) => resolve())),
    upsert: (value: Automation) =>
      Effect.sync(() => {
        state.stored.set(value.id, value);
      }),
    remove: () => Effect.succeed(true),
    listDue: () => Effect.succeed([...state.stored.values()]),
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
      Layer.mergeAll(storeLayer, engineLayer, snapshotLayer, gitLayer, settingsLayer, cryptoLayer),
    ),
  );

  return { state, layer };
}

const dispatchedTypes = (state: Harness) => state.dispatched.map((command) => command.type);

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
});

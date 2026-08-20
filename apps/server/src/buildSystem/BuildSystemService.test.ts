/**
 * What coordinating a team actually dispatches.
 *
 * The store and engine are fakes so these assert the order of commands and
 * the run's recorded status — the things a green "a run was saved" test
 * would hide.
 */
import {
  type BuildSystem,
  BuildSystemId,
  type BuildSystemRole,
  BuildSystemRoleId,
  type BuildSystemRun,
  BuildSystemRunId,
  type BuildSystemRunStep,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
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
import { BuildSystemService, make } from "./BuildSystemService.ts";
import { BuildSystemStore } from "./BuildSystemStore.ts";

const PROJECT_ID = ProjectId.make("project-1");
const CLAUDE: ModelSelection = {
  instanceId: ProviderInstanceId.make("claude"),
  model: "opus",
};
const CODEX: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
};

const implementer: BuildSystemRole = {
  id: BuildSystemRoleId.make("role-implementer"),
  name: "implementer",
  instructions: "Write the code.",
  modelSelection: CODEX,
  gate: false,
};

const reviewer: BuildSystemRole = {
  id: BuildSystemRoleId.make("role-reviewer"),
  name: "reviewer",
  instructions: null,
  modelSelection: CLAUDE,
  gate: true,
};

const system = (overrides: Partial<BuildSystem> = {}): BuildSystem => ({
  id: BuildSystemId.make("bs-1"),
  projectId: PROJECT_ID,
  name: "Ship it",
  description: null,
  orchestrator: { modelSelection: CLAUDE, instructions: null },
  teammates: [implementer, reviewer],
  maxDelegations: 20,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  ...overrides,
});

const run = (overrides: Partial<BuildSystemRun> = {}): BuildSystemRun => ({
  id: BuildSystemRunId.make("run-1"),
  buildSystemId: BuildSystemId.make("bs-1"),
  projectId: PROJECT_ID,
  config: system(),
  task: "Add the parser.",
  orchestratorThreadId: ThreadId.make("thread-orch"),
  roleThreads: [],
  status: "orchestrating",
  pending: null,
  delegationCount: 0,
  summary: null,
  failureDetail: null,
  startedAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  settledAt: null,
  ...overrides,
});

interface Harness {
  readonly dispatched: OrchestrationCommand[];
  readonly systems: Map<string, BuildSystem>;
  readonly runs: Map<string, BuildSystemRun>;
  readonly steps: BuildSystemRunStep[];
  assistantText: string;
  /** Overrides the single-assistant-message default when a test needs a turn. */
  messages: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly text: string;
    readonly turnId?: string | null;
  }> | null;
  sessionStatus: "idle" | "running" | "error" | "interrupted" | "stopped";
}

function makeHarness(options?: {
  readonly isRepo?: boolean;
  readonly failTurnStart?: boolean;
  readonly projectMissing?: boolean;
}) {
  const state: Harness = {
    dispatched: [],
    systems: new Map(),
    runs: new Map(),
    steps: [],
    assistantText: "",
    messages: null,
    sessionStatus: "idle",
  };

  const storeLayer = Layer.succeed(BuildSystemStore, {
    list: () => Effect.succeed([...state.systems.values()]),
    get: (id: string) =>
      Effect.succeed(state.systems.has(id) ? Option.some(state.systems.get(id)!) : Option.none()),
    upsert: (value: BuildSystem) =>
      Effect.sync(() => {
        state.systems.set(value.id, value);
      }),
    remove: (id: string) =>
      Effect.sync(() => {
        const existed = state.systems.delete(id);
        return existed;
      }),
    upsertRun: (value: BuildSystemRun) =>
      Effect.sync(() => {
        state.runs.set(value.id, value);
      }),
    getRun: (id: string) =>
      Effect.succeed(state.runs.has(id) ? Option.some(state.runs.get(id)!) : Option.none()),
    listRuns: () => Effect.succeed([...state.runs.values()]),
    listActiveRuns: () =>
      Effect.succeed([...state.runs.values()].filter((entry) => entry.settledAt === null)),
    findActiveRunForThread: (threadId: string) =>
      Effect.succeed(() => {
        const match = [...state.runs.values()].find(
          (entry) =>
            entry.settledAt === null &&
            (entry.orchestratorThreadId === threadId ||
              entry.roleThreads.some((role) => role.threadId === threadId)),
        );
        return match === undefined ? Option.none() : Option.some(match);
      }).pipe(Effect.map((resolve) => resolve())),
    appendStep: (step: BuildSystemRunStep) =>
      Effect.sync(() => {
        state.steps.push(step);
      }),
    listSteps: (runId: string) =>
      Effect.succeed(state.steps.filter((step) => step.runId === runId)),
    nextStepSequence: (runId: string) =>
      Effect.succeed(state.steps.filter((step) => step.runId === runId).length),
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
        projects: options?.projectMissing === true ? [] : [{ id: PROJECT_ID }],
        threads: [],
        updatedAt: "2026-08-18T00:00:00.000Z",
      }),
    getProjectShellById: () =>
      Effect.succeed(
        options?.projectMissing === true
          ? Option.none()
          : Option.some({
              id: PROJECT_ID,
              workspaceRoot: "/tmp/project",
              defaultModelSelection: CLAUDE,
            }),
      ),
    getThreadShellById: () =>
      Effect.succeed(
        Option.some({
          id: ThreadId.make("thread-orch"),
          projectId: PROJECT_ID,
          branch: "t3/deadbeef",
          worktreePath: "/tmp/project-worktree",
          session: {
            status: state.sessionStatus,
            lastError: state.sessionStatus === "error" ? "provider died" : null,
          },
        }),
      ),
    getThreadDetailById: () =>
      Effect.succeed(
        Option.some({
          id: ThreadId.make("thread-orch"),
          messages: state.messages ?? [
            {
              id: "msg-1",
              role: "assistant",
              text: state.assistantText,
            },
          ],
          checkpoints: [],
        } as unknown as OrchestrationThread),
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

  const layer = Layer.effect(BuildSystemService, make).pipe(
    Layer.provide(
      Layer.mergeAll(storeLayer, engineLayer, snapshotLayer, gitLayer, settingsLayer, cryptoLayer),
    ),
  );

  return { state, layer };
}

const withService = <A, E>(
  harness: ReturnType<typeof makeHarness>,
  run: (service: BuildSystemService["Service"]) => Effect.Effect<A, E>,
) => Effect.flatMap(Effect.service(BuildSystemService), run).pipe(Effect.provide(harness.layer));

const dispatchedTypes = (state: Harness) => state.dispatched.map((command) => command.type);

function step(
  runId: string,
  sequence: number,
  kind: BuildSystemRunStep["kind"],
  threadId: ThreadId | null,
  roleId: BuildSystemRole["id"] | null,
): BuildSystemRunStep {
  return {
    id: `step-${runId}-${String(sequence)}` as BuildSystemRunStep["id"],
    runId: BuildSystemRunId.make(runId),
    sequence,
    kind,
    roleId,
    roleName: null,
    threadId,
    detail: null,
    at: "2026-08-18T00:00:00.000Z",
  };
}

function fence(body: string): string {
  return ["```t3-directive", body, "```"].join("\n");
}

describe("BuildSystemService", () => {
  it.effect("rejects a roster with two roles of the same name", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const error = yield* withService(harness, (service) =>
        service.create({
          projectId: PROJECT_ID,
          name: "Dupes",
          orchestrator: { modelSelection: CLAUDE },
          teammates: [
            { name: "reviewer", modelSelection: CODEX },
            { name: "Reviewer", modelSelection: CLAUDE },
          ],
        }),
      ).pipe(Effect.flip);

      expect(error.reason).toBe("invalid");
      expect(error.detail).toContain("name");
    }),
  );

  it.effect("creates the orchestrator thread before starting its first turn", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.state.systems.set("bs-1", system());

      const started = yield* withService(harness, (service) =>
        service.startRun({ buildSystemId: BuildSystemId.make("bs-1"), task: "Add the parser." }),
      );

      expect(dispatchedTypes(harness.state)).toEqual([
        "thread.create",
        "thread.meta.update",
        "thread.turn.start",
      ]);
      expect(started.status).toBe("orchestrating");
      expect(started.orchestratorThreadId).not.toBeNull();
      const created = harness.state.dispatched.find((command) => command.type === "thread.create");
      const turn = harness.state.dispatched.find((command) => command.type === "thread.turn.start");
      expect((turn as { threadId: string }).threadId).toBe(
        (created as { threadId: string }).threadId,
      );
      expect((turn as { message: { text: string } }).message.text).toContain("Add the parser.");
    }),
  );

  it.effect("skips the worktree when the project is not a git repo", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ isRepo: false });
      harness.state.systems.set("bs-1", system());

      yield* withService(harness, (service) =>
        service.startRun({ buildSystemId: BuildSystemId.make("bs-1"), task: "task" }),
      );

      expect(dispatchedTypes(harness.state)).toEqual(["thread.create", "thread.turn.start"]);
    }),
  );

  it.effect("deletes the thread and fails the run when the first turn cannot start", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ failTurnStart: true });
      harness.state.systems.set("bs-1", system());

      const started = yield* withService(harness, (service) =>
        service.startRun({ buildSystemId: BuildSystemId.make("bs-1"), task: "task" }),
      );

      expect(started.status).toBe("failed");
      expect(started.orchestratorThreadId).toBeNull();
      expect(dispatchedTypes(harness.state)).toContain("thread.delete");
    }),
  );

  it.effect("delegates to a teammate in the orchestrator's worktree", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run();
      harness.state.runs.set(active.id, active);
      harness.state.assistantText = fence(
        '{"action":"delegate","role":"implementer","task":"Write parse.ts"}',
      );

      yield* withService(harness, (service) =>
        service.handleTurnSettled({
          threadId: ThreadId.make("thread-orch"),
          turnId: null,
          files: [],
          assistantMessageId: "msg-1",
        }),
      );

      const next = harness.state.runs.get(active.id);
      expect(next?.status).toBe("delegating");
      expect(next?.delegationCount).toBe(1);
      expect(next?.roleThreads).toHaveLength(1);
      expect(dispatchedTypes(harness.state)).toEqual(["thread.create", "thread.turn.start"]);
      const created = harness.state.dispatched.find((command) => command.type === "thread.create");
      expect(created).toMatchObject({
        worktreePath: "/tmp/project-worktree",
        branch: "t3/deadbeef",
      });
      const turn = harness.state.dispatched.find((command) => command.type === "thread.turn.start");
      expect((turn as { message: { text: string } }).message.text).toContain("Write parse.ts");
    }),
  );

  it.effect("holds a gated role until the user approves", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run();
      harness.state.runs.set(active.id, active);
      harness.state.assistantText = fence(
        '{"action":"delegate","role":"reviewer","task":"Look at parse.ts"}',
      );

      yield* withService(harness, (service) =>
        service.handleTurnSettled({
          threadId: ThreadId.make("thread-orch"),
          turnId: null,
          files: [],
          assistantMessageId: null,
        }),
      );

      const waiting = harness.state.runs.get(active.id);
      expect(waiting?.status).toBe("waiting-gate");
      expect(waiting?.pending).toMatchObject({ _tag: "gate", roleName: "reviewer" });
      expect(harness.state.dispatched).toEqual([]);

      yield* withService(harness, (service) =>
        service.resolveGate({ runId: active.id, approved: true, note: null }),
      );

      expect(harness.state.runs.get(active.id)?.status).toBe("delegating");
      expect(dispatchedTypes(harness.state)).toEqual(["thread.create", "thread.turn.start"]);
    }),
  );

  it.effect("returns a gate denial to the orchestrator", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run({
        status: "waiting-gate",
        pending: {
          _tag: "gate",
          roleId: reviewer.id,
          roleName: "reviewer",
          task: "Look",
          context: null,
        },
      });
      harness.state.runs.set(active.id, active);

      yield* withService(harness, (service) =>
        service.resolveGate({ runId: active.id, approved: false, note: "too soon" }),
      );

      expect(harness.state.runs.get(active.id)?.status).toBe("orchestrating");
      const turn = harness.state.dispatched.find((command) => command.type === "thread.turn.start");
      expect((turn as { message: { text: string } }).message.text).toContain("too soon");
    }),
  );

  it.effect("asks the user and sends the reply back", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run();
      harness.state.runs.set(active.id, active);
      harness.state.assistantText = fence('{"action":"ask_user","question":"Which db?"}');

      yield* withService(harness, (service) =>
        service.handleTurnSettled({
          threadId: ThreadId.make("thread-orch"),
          turnId: null,
          files: [],
          assistantMessageId: null,
        }),
      );

      expect(harness.state.runs.get(active.id)?.status).toBe("waiting-user");

      yield* withService(harness, (service) =>
        service.replyUser({ runId: active.id, reply: "sqlite" }),
      );

      expect(harness.state.runs.get(active.id)?.status).toBe("orchestrating");
      const turn = harness.state.dispatched.find((command) => command.type === "thread.turn.start");
      expect((turn as { message: { text: string } }).message.text).toContain("sqlite");
    }),
  );

  it.effect("completes when the orchestrator says done", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run();
      harness.state.runs.set(active.id, active);
      harness.state.assistantText = fence('{"action":"done","summary":"Shipped."}');

      yield* withService(harness, (service) =>
        service.handleTurnSettled({
          threadId: ThreadId.make("thread-orch"),
          turnId: null,
          files: [],
          assistantMessageId: null,
        }),
      );

      const next = harness.state.runs.get(active.id);
      expect(next?.status).toBe("completed");
      expect(next?.summary).toBe("Shipped.");
      expect(next?.settledAt).not.toBeNull();
    }),
  );

  it.effect("nudges a missing directive and fails after too many", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run();
      harness.state.runs.set(active.id, active);
      harness.state.assistantText = "I think we should start with the parser.";

      yield* withService(harness, (service) =>
        service.handleTurnSettled({
          threadId: ThreadId.make("thread-orch"),
          turnId: null,
          files: [],
          assistantMessageId: null,
        }),
      );
      expect(harness.state.runs.get(active.id)?.status).toBe("orchestrating");
      expect(harness.state.steps.filter((step) => step.kind === "nudge")).toHaveLength(1);

      yield* withService(harness, (service) =>
        service.handleTurnSettled({
          threadId: ThreadId.make("thread-orch"),
          turnId: null,
          files: [],
          assistantMessageId: null,
        }),
      );
      expect(harness.state.steps.filter((step) => step.kind === "nudge")).toHaveLength(2);

      yield* withService(harness, (service) =>
        service.handleTurnSettled({
          threadId: ThreadId.make("thread-orch"),
          turnId: null,
          files: [],
          assistantMessageId: null,
        }),
      );
      expect(harness.state.runs.get(active.id)?.status).toBe("failed");
    }),
  );

  it.effect("reports a teammate finish back to the orchestrator", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const teammateThread = ThreadId.make("thread-impl");
      const active = run({
        status: "delegating",
        delegationCount: 1,
        roleThreads: [{ roleId: implementer.id, threadId: teammateThread }],
      });
      harness.state.runs.set(active.id, active);
      harness.state.assistantText = "Added parse.ts.";

      yield* withService(harness, (service) =>
        service.handleTurnSettled({
          threadId: teammateThread,
          turnId: null,
          files: [{ path: "src/parse.ts", kind: "modified", additions: 10, deletions: 0 }],
          assistantMessageId: null,
        }),
      );

      expect(harness.state.runs.get(active.id)?.status).toBe("orchestrating");
      const turn = harness.state.dispatched.find((command) => command.type === "thread.turn.start");
      expect((turn as { message: { text: string } }).message.text).toContain("Added parse.ts.");
      expect((turn as { message: { text: string } }).message.text).toContain("src/parse.ts");
    }),
  );

  it.effect("advances a re-delegated teammate rather than the newest role thread", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const implThread = ThreadId.make("thread-impl");
      const reviewThread = ThreadId.make("thread-review");
      // The implementer was delegated to first, the reviewer second, and now the
      // implementer again — so the awaited thread is *not* the last role thread.
      const active = run({
        status: "delegating",
        delegationCount: 3,
        roleThreads: [
          { roleId: implementer.id, threadId: implThread },
          { roleId: reviewer.id, threadId: reviewThread },
        ],
      });
      harness.state.runs.set(active.id, active);
      harness.state.steps.push(step(active.id, 0, "delegation", implThread, implementer.id));
      harness.state.steps.push(step(active.id, 1, "delegation", reviewThread, reviewer.id));
      harness.state.steps.push(step(active.id, 2, "delegation", implThread, implementer.id));
      harness.state.assistantText = "Fixed the parser.";

      yield* withService(harness, (service) =>
        service.handleTurnSettled({
          threadId: implThread,
          turnId: null,
          files: [],
          assistantMessageId: null,
        }),
      );

      expect(harness.state.runs.get(active.id)?.status).toBe("orchestrating");
      const turn = harness.state.dispatched.find((command) => command.type === "thread.turn.start");
      expect((turn as { message: { text: string } }).message.text).toContain("Fixed the parser.");
    }),
  );

  it.effect("interrupts the re-delegated teammate's thread on cancel", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const implThread = ThreadId.make("thread-impl");
      const reviewThread = ThreadId.make("thread-review");
      const active = run({
        status: "delegating",
        delegationCount: 3,
        roleThreads: [
          { roleId: implementer.id, threadId: implThread },
          { roleId: reviewer.id, threadId: reviewThread },
        ],
      });
      harness.state.runs.set(active.id, active);
      harness.state.steps.push(step(active.id, 0, "delegation", reviewThread, reviewer.id));
      harness.state.steps.push(step(active.id, 1, "delegation", implThread, implementer.id));

      yield* withService(harness, (service) => service.cancelRun(active.id));

      const interrupt = harness.state.dispatched.find(
        (command) => command.type === "thread.turn.interrupt",
      );
      expect((interrupt as { threadId: string }).threadId).toBe(implThread);
    }),
  );

  it.effect("leaves a stopped session alone while the run is live", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run();
      harness.state.runs.set(active.id, active);

      // A provider closing its session after a healthy turn reports the same
      // status, and the checkpoint carrying the reply can still be on its way.
      yield* withService(harness, (service) =>
        service.handleSessionSet({
          threadId: ThreadId.make("thread-orch"),
          status: "stopped",
          lastError: null,
        }),
      );

      expect(harness.state.steps).toEqual([]);
      expect(harness.state.dispatched).toEqual([]);
    }),
  );

  it.effect("picks up a run whose session exited while the process was down", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run();
      harness.state.runs.set(active.id, active);
      harness.state.sessionStatus = "stopped";

      yield* withService(harness, (service) => service.recover);

      expect(harness.state.runs.get(active.id)?.status).toBe("orchestrating");
      expect(harness.state.steps.filter((entry) => entry.kind === "nudge")).toHaveLength(1);
      const turn = harness.state.dispatched.find((command) => command.type === "thread.turn.start");
      expect((turn as { message: { text: string } }).message.text).toContain(
        "Interrupted by restart",
      );
    }),
  );

  it.effect("fails the run when a teammate fails twice with no report between", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const teammateThread = ThreadId.make("thread-impl");
      const active = run({
        status: "delegating",
        delegationCount: 2,
        roleThreads: [{ roleId: implementer.id, threadId: teammateThread }],
      });
      harness.state.runs.set(active.id, active);
      // The first failure was reported, and the orchestrator answered it by
      // delegating again — so the failure report is not the newest step.
      harness.state.steps.push({
        ...step(active.id, 0, "report", teammateThread, implementer.id),
        detail: "Turn failed: provider died",
      });
      harness.state.steps.push(step(active.id, 1, "delegation", teammateThread, implementer.id));

      yield* withService(harness, (service) =>
        service.handleSessionSet({
          threadId: teammateThread,
          status: "error",
          lastError: "provider died again",
        }),
      );

      const next = harness.state.runs.get(active.id);
      expect(next?.status).toBe("failed");
      expect(next?.failureDetail).toBe("provider died again");
      expect(dispatchedTypes(harness.state)).toEqual([]);
    }),
  );

  it.effect("ignores a turn a person started in a run thread", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run({
        status: "waiting-user",
        pending: { _tag: "question", question: "Which db?" },
      });
      harness.state.runs.set(active.id, active);

      yield* withService(harness, (service) =>
        Effect.gen(function* () {
          // Our reply opens the turn the run is waiting on.
          yield* service.replyUser({ runId: active.id, reply: "sqlite" });
          const ours = harness.state.dispatched.find(
            (command) => command.type === "thread.turn.start",
          ) as { message: { messageId: string } };
          harness.state.messages = [
            { id: ours.message.messageId, role: "user", text: "sqlite", turnId: "turn-ours" },
            {
              id: "msg-theirs",
              role: "assistant",
              text: fence('{"action":"done","summary":"Shipped."}'),
              turnId: "turn-theirs",
            },
          ];

          // A person typed into the same thread; the reply to *that* is not the
          // team's directive.
          yield* service.handleTurnSettled({
            threadId: ThreadId.make("thread-orch"),
            turnId: TurnId.make("turn-theirs"),
            files: [],
            assistantMessageId: "msg-theirs",
          });
          expect(harness.state.runs.get(active.id)?.status).toBe("orchestrating");

          // The same directive on our own turn is acted on.
          yield* service.handleTurnSettled({
            threadId: ThreadId.make("thread-orch"),
            turnId: TurnId.make("turn-ours"),
            files: [],
            assistantMessageId: "msg-theirs",
          });
        }),
      );

      const next = harness.state.runs.get(active.id);
      expect(next?.status).toBe("completed");
      expect(next?.summary).toBe("Shipped.");
    }),
  );

  it.effect("cancels by interrupting the live turn", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      const active = run();
      harness.state.runs.set(active.id, active);

      const cancelled = yield* withService(harness, (service) => service.cancelRun(active.id));

      expect(cancelled.status).toBe("cancelled");
      expect(dispatchedTypes(harness.state)).toEqual(["thread.turn.interrupt"]);
    }),
  );

  it.effect("refuses to delete a system that still has a live run", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.state.systems.set("bs-1", system());
      harness.state.runs.set("run-1", run());

      const error = yield* withService(harness, (service) =>
        service.remove(BuildSystemId.make("bs-1")),
      ).pipe(Effect.flip);

      expect(error.reason).toBe("runInProgress");
      expect(harness.state.systems.has("bs-1")).toBe(true);
    }),
  );

  it.effect("fails a still-running turn on recover", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.state.sessionStatus = "running";
      harness.state.runs.set("run-1", run());

      yield* withService(harness, (service) => service.recover);

      expect(harness.state.runs.get("run-1")?.status).toBe("failed");
      expect(harness.state.runs.get("run-1")?.failureDetail).toContain("restart");
    }),
  );

  it.effect("continues a settled turn on recover", () =>
    Effect.gen(function* () {
      const harness = makeHarness();
      harness.state.sessionStatus = "idle";
      harness.state.runs.set("run-1", run());
      harness.state.assistantText = fence('{"action":"done","summary":"Recovered."}');

      yield* withService(harness, (service) => service.recover);

      expect(harness.state.runs.get("run-1")?.status).toBe("completed");
      expect(harness.state.runs.get("run-1")?.summary).toBe("Recovered.");
    }),
  );
});

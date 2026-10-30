import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TestClock } from "effect/testing";
import * as ServerSettings from "../serverSettings.ts";
import { restartContinuationRun, continueRestartedRun } from "./RestartContinuation.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import type {
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts/orchestration-v2";

const threadId = ThreadId.make("thread:restart");
const runId = RunId.make("run:restart");
const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const providerThreadId = ProviderThreadId.make("provider-thread:restart");
const sessionId = ProviderSessionId.make("session:restart");
const attemptId = RunAttemptId.make("attempt:restart");
const now = DateTime.makeUnsafe("2026-10-03T12:00:00.000Z");
// "No project" threads belong to the environment's Scratch project.
const scratchProjectId = ProjectId.make("project:scratch");

function cutMidTurn(overrides: Partial<OrchestrationV2Run> = {}) {
  const projection = makeProjection();
  return {
    ...projection,
    runs: [
      { ...projection.runs[0]!, status: "cancelled" as const, completedAt: now, ...overrides },
    ],
  };
}

const continuationCommands = (projection: OrchestrationV2ThreadProjection, enabled = true) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(now));
    const commands: Parameters<
      ThreadManagementService.ThreadManagementService["Service"]["dispatch"]
    >[0][] = [];
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadRecords: () => Effect.succeed(projection),
            recoverDelegatedTask: () => Effect.void,
            dispatch: (command) => {
              commands.push(command);
              return Effect.succeed({} as never);
            },
          }),
          ServerSettings.layerTest(enabled ? { continueThreadsAfterServerUpdate: true } : {}),
        ),
      ),
    );
    return commands;
  });

function makeProjection() {
  return {
    thread: {
      id: threadId,
      projectId: ProjectId.make("restart-project"),
      providerInstanceId: instanceId,
      archivedAt: null,
      deletedAt: null,
    },
    runs: [
      {
        id: runId,
        ordinal: 1,
        providerInstanceId: instanceId,
        modelSelection: { instanceId, model: "gpt-6" },
        providerThreadId,
        activeAttemptId: attemptId,
        status: "running",
      },
    ],
    providerThreads: [
      {
        id: providerThreadId,
        appThreadId: threadId,
        ownerNodeId: null,
        driver,
        providerInstanceId: instanceId,
        providerSessionId: sessionId,
        nativeThreadRef: { driver, nativeId: "native-thread", strength: "strong" },
        status: "active",
      },
    ],
    providerSessions: [
      { id: sessionId, driver, providerInstanceId: instanceId, status: "running" },
    ],
    providerTurns: [
      {
        id: ProviderTurnId.make("turn:restart"),
        providerThreadId,
        runAttemptId: attemptId,
        status: "running",
      },
    ],
    runtimeRequests: [],
    attempts: [],
    nodes: [],
    subagents: [],
    messages: [],
    turnItems: [],
  } as unknown as OrchestrationV2ThreadProjection;
}

it("requires matching saved native state for an unfinished root run", () => {
  const projection = makeProjection();
  assert.equal(restartContinuationRun(projection, now)?.id, runId);
  for (const invalid of [
    { ...projection, thread: { ...projection.thread, archivedAt: {} } },
    { ...projection, thread: { ...projection.thread, deletedAt: {} } },
    {
      ...projection,
      thread: { ...projection.thread, providerInstanceId: ProviderInstanceId.make("other") },
    },
    {
      ...projection,
      providerThreads: [{ ...projection.providerThreads[0]!, nativeThreadRef: null }],
    },
    {
      ...projection,
      providerSessions: [
        {
          ...projection.providerSessions[0]!,
          providerInstanceId: ProviderInstanceId.make("other"),
        },
      ],
    },
    { ...projection, providerTurns: [] },
    ...[
      "queued",
      "preparing",
      "starting",
      "waiting",
      "completed",
      "cancelled",
      "failed",
      "interrupted",
    ].map((status) => ({ ...projection, runs: [{ ...projection.runs[0]!, status }] })),
  ])
    assert.isUndefined(restartContinuationRun(invalid as OrchestrationV2ThreadProjection, now));
});

it("continues a live turn whose session the adapter never marked running", () => {
  const projection = makeProjection();
  // Codex, Claude, Cursor and ACP sessions stay "ready" for their whole life.
  const withSessionStatus = (status: string) =>
    ({
      ...projection,
      providerSessions: [{ ...projection.providerSessions[0]!, status }],
    }) as OrchestrationV2ThreadProjection;
  for (const status of ["starting", "ready", "running", "waiting"])
    assert.equal(restartContinuationRun(withSessionStatus(status), now)?.id, runId, status);
  for (const status of ["stopped", "error"])
    assert.isUndefined(restartContinuationRun(withSessionStatus(status), now), status);
});

it("recovers an admitted continuation after another crash before provider start", () => {
  const projection = makeProjection();
  const starting = {
    ...projection,
    runs: [
      {
        ...projection.runs[0]!,
        status: "starting" as const,
        restartContinuationOfRunId: RunId.make("run:previous-crash"),
      },
    ],
    providerThreads: [{ ...projection.providerThreads[0]!, status: "idle" as const }],
    providerSessions: [{ ...projection.providerSessions[0]!, status: "stopped" as const }],
    providerTurns: [],
  };
  assert.equal(restartContinuationRun(starting, now)?.id, runId);
});

it("does not continue settled root runs with restart-cancelled background work", () => {
  const projection = makeProjection();
  const settled = {
    ...projection,
    runs: [
      {
        ...projection.runs[0]!,
        status: "completed" as const,
        restartCancelledBackgroundWork: [{ kind: "shell" as const, label: "sleep 25" }],
      },
    ],
    providerThreads: [{ ...projection.providerThreads[0]!, status: "idle" as const }],
    providerSessions: [{ ...projection.providerSessions[0]!, status: "stopped" as const }],
    providerTurns: [],
  };
  for (const projectId of [scratchProjectId, projection.thread.projectId])
    for (const status of ["completed", "waiting"] as const)
      assert.isUndefined(
        restartContinuationRun(
          {
            ...settled,
            thread: { ...settled.thread, projectId },
            runs: [{ ...settled.runs[0]!, status }],
          },
          now,
        ),
      );
});

it.effect.each(["completed", "waiting", "cancelled"] as const)(
  "ignores a pending restart continuation for a %s run whose provider turn settled",
  (status) =>
    Effect.gen(function* () {
      const base = makeProjection();
      const work = [{ kind: "shell" as const, label: "sleep 25 && echo DONE" }];
      const projection = {
        ...base,
        runs: [{ ...base.runs[0]!, status, restartCancelledBackgroundWork: work }],
        providerTurns: [{ ...base.providerTurns[0]!, status: "completed" }],
      } as unknown as OrchestrationV2ThreadProjection;
      const commands: Parameters<
        ThreadManagementService.ThreadManagementService["Service"]["dispatch"]
      >[0][] = [];
      yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(
        Effect.provide(
          Layer.merge(
            Layer.mock(ThreadManagementService.ThreadManagementService)({
              getThreadRecords: () => Effect.succeed(projection),
              recoverDelegatedTask: () => Effect.void,
              dispatch: (command) => {
                commands.push(command);
                return Effect.succeed({} as never);
              },
            }),
            ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
          ),
        ),
      );
      assert.lengthOf(commands, 0);
    }),
);

it.effect("does not continue a failed run that lost background work", () =>
  Effect.gen(function* () {
    const base = makeProjection();
    const projection = {
      ...base,
      runs: [
        {
          ...base.runs[0]!,
          status: "failed",
          restartCancelledBackgroundWork: [{ kind: "shell" as const, label: "sleep 25" }],
        },
      ],
      providerTurns: [{ ...base.providerTurns[0]!, status: "failed" }],
    } as unknown as OrchestrationV2ThreadProjection;
    const commands: Parameters<
      ThreadManagementService.ThreadManagementService["Service"]["dispatch"]
    >[0][] = [];
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadRecords: () => Effect.succeed(projection),
            recoverDelegatedTask: () => Effect.void,
            dispatch: (command) => {
              commands.push(command);
              return Effect.succeed({} as never);
            },
          }),
          ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
        ),
      ),
    );
    assert.lengthOf(commands, 0);
  }),
);

it.effect("dispatches a restart notice with the prompt preserved as its detail", () =>
  Effect.gen(function* () {
    const base = makeProjection();
    const projection = { ...base, runs: [{ ...base.runs[0]!, status: "cancelled" as const }] };
    const commands: Parameters<
      ThreadManagementService.ThreadManagementService["Service"]["dispatch"]
    >[0][] = [];
    yield* continueRestartedRun({ threadId, sourceRunId: runId }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.mock(ThreadManagementService.ThreadManagementService)({
            getThreadRecords: () => Effect.succeed(projection),
            recoverDelegatedTask: () => Effect.void,
            dispatch: (command) => {
              commands.push(command);
              return Effect.succeed({} as never);
            },
          }),
          ServerSettings.layerTest({ continueThreadsAfterServerUpdate: true }),
        ),
      ),
    );
    assert.lengthOf(commands, 1);
    const command = commands[0]!;
    assert.equal(command.type, "message.dispatch");
    if (command.type === "message.dispatch") {
      assert.deepEqual(command.notification, {
        source: { kind: "system" },
        outcome: "updated",
        summary: "Ronin restarted and resumed this turn",
        detail: command.text,
      });
      assert.equal(command.text, "Continue where you left off.");
    }
  }),
);
it.effect("leaves restart continuation off until the environment opts in", () =>
  Effect.gen(function* () {
    assert.deepEqual(yield* continuationCommands(cutMidTurn(), false), []);
  }),
);

it.effect("stops continuing after three automatic restart continuations in a row", () =>
  Effect.gen(function* () {
    const first = RunId.make("run:first-continuation");
    const second = RunId.make("run:second-continuation");
    const cut = cutMidTurn({ restartContinuationOfRunId: second });
    const withTwoLinks = {
      ...cut,
      runs: [
        ...cut.runs,
        { ...cut.runs[0]!, id: second, ordinal: 0, restartContinuationOfRunId: first },
        { ...cut.runs[0]!, id: first, ordinal: 0, restartContinuationOfRunId: undefined },
      ],
    } as unknown as OrchestrationV2ThreadProjection;
    assert.lengthOf(yield* continuationCommands(withTwoLinks), 1);

    const withThreeLinks = {
      ...withTwoLinks,
      runs: withTwoLinks.runs.map((run) =>
        run.id === first ? { ...run, restartContinuationOfRunId: RunId.make("run:root") } : run,
      ),
    } as unknown as OrchestrationV2ThreadProjection;
    assert.lengthOf(yield* continuationCommands(withThreeLinks), 0);
  }),
);

it.effect.each([
  ["user_input", "pending", "live", false],
  ["user_input", "expired", "not_resumable", false],
  ["user_input", "cancelled", "not_resumable", false],
  ["command", "pending", "live", false],
  ["command", "expired", "not_resumable", false],
  ["user_input", "resolved", "live", true],
  ["command", "cancelled", "live", true],
  ["user_input", "pending", "message", true],
  ["dynamic_tool_call", "pending", "live", true],
  ["auth_refresh", "pending", "live", true],
] as const)(
  "a %s request that is %s with %s capability allows continuation: %s",
  ([kind, status, capability, shouldContinue]) =>
    Effect.gen(function* () {
      const base = makeProjection();
      const runtimeRequests = [
        {
          id: "request:restart",
          nodeId: "node:restart-question",
          providerTurnId: base.providerTurns[0]!.id,
          kind,
          status,
          responseCapability:
            capability === "live"
              ? { type: capability, providerSessionId: sessionId }
              : capability === "not_resumable"
                ? { type: capability, reason: "The server restarted." }
                : { type: capability },
        },
      ];
      const live = { ...base, runtimeRequests } as unknown as OrchestrationV2ThreadProjection;
      assert.equal(restartContinuationRun(live, now) !== undefined, shouldContinue);
      const cut = {
        ...cutMidTurn(),
        runtimeRequests,
      } as unknown as OrchestrationV2ThreadProjection;
      assert.lengthOf(yield* continuationCommands(cut), shouldContinue ? 1 : 0);
    }),
);

it.effect("does not wake a snoozed or settled thread, but continues once a snooze elapsed", () =>
  Effect.gen(function* () {
    const live = makeProjection();
    for (const held of [
      { snoozedUntil: DateTime.add(now, { days: 1 }) },
      { settledOverride: "settled" as const },
    ]) {
      const thread = { ...live.thread, ...held };
      assert.isUndefined(restartContinuationRun({ ...live, thread }, now));
      assert.deepEqual(yield* continuationCommands({ ...cutMidTurn(), thread }), []);
    }
    const thread = { ...live.thread, snoozedUntil: DateTime.subtract(now, { minutes: 1 }) };
    assert.equal(restartContinuationRun({ ...live, thread }, now)?.id, runId);
  }),
);

it.effect("does not continue a run waiting on a secret the restart closed", () =>
  Effect.gen(function* () {
    const completedAt = DateTime.makeUnsafe("2026-10-03T10:05:00.000Z");
    const secret = (secretStatus: string, at: DateTime.Utc | null) =>
      ({ type: "secret_request", runId, secretStatus, completedAt: at }) as never;
    assert.isUndefined(
      restartContinuationRun({ ...makeProjection(), turnItems: [secret("pending", null)] }, now),
    );
    const cut = cutMidTurn({ completedAt });
    assert.deepEqual(
      yield* continuationCommands({ ...cut, turnItems: [secret("cancelled", completedAt)] }),
      [],
    );
    // A secret the user dismissed earlier in the run does not hold it.
    assert.lengthOf(
      yield* continuationCommands({
        ...cut,
        turnItems: [secret("cancelled", DateTime.subtract(completedAt, { seconds: 1 }))],
      }),
      1,
    );
  }),
);

it.effect.each(["completed", "failed", "interrupted"] as const)(
  "does not continue when the provider turn %s before the app run settled",
  (status) =>
    Effect.gen(function* () {
      const cut = cutMidTurn();
      assert.deepEqual(
        yield* continuationCommands({
          ...cut,
          providerTurns: [{ ...cut.providerTurns[0]!, status }],
        }),
        [],
      );
    }),
);

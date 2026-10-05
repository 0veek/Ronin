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
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerSettings from "../serverSettings.ts";
import { restartContinuationRun, continueRestartedRun } from "./RestartContinuation.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts/orchestration-v2";

const threadId = ThreadId.make("thread:restart");
const runId = RunId.make("run:restart");
const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const providerThreadId = ProviderThreadId.make("provider-thread:restart");
const sessionId = ProviderSessionId.make("session:restart");
const attemptId = RunAttemptId.make("attempt:restart");
// "No project" threads belong to the environment's Scratch project.
const scratchProjectId = ProjectId.make("project:scratch");

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
  assert.equal(restartContinuationRun(projection)?.id, runId);
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
    assert.isUndefined(restartContinuationRun(invalid as OrchestrationV2ThreadProjection));
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
    assert.equal(restartContinuationRun(withSessionStatus(status))?.id, runId, status);
  for (const status of ["stopped", "error"])
    assert.isUndefined(restartContinuationRun(withSessionStatus(status)), status);
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
  assert.equal(restartContinuationRun(starting)?.id, runId);
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
        restartContinuationRun({
          ...settled,
          thread: { ...settled.thread, projectId },
          runs: [{ ...settled.runs[0]!, status }],
        }),
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

import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointScopeId,
  ProviderThreadId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  CheckpointServiceV2,
  CheckpointRestoreError,
  CheckpointDeleteStaleRefsError,
} from "./CheckpointService.ts";
import { CheckpointRollbackServiceV2, layer } from "./CheckpointRollbackService.ts";
import { EventSinkV2, EventSinkWriteError } from "./EventSink.ts";
import * as IdAllocator from "./IdAllocator.ts";
import { ProjectionStoreV2 } from "./ProjectionStore.ts";
import { ProjectStoreV2 } from "./ProjectStore.ts";
import { ProviderSessionManagerV2 } from "./ProviderSessionManager.ts";
import { RuntimePolicyV2 } from "./RuntimePolicy.ts";

const input = {
  threadId: ThreadId.make("rollback-test"),
  providerThreadId: ProviderThreadId.make("provider-thread"),
  checkpointId: CheckpointId.make("checkpoint-2"),
  scopeId: CheckpointScopeId.make("scope"),
};

for (const failure of ["prepare-write", "restore", "delete-refs", "result-write"] as const) {
  it.effect(
    `keeps the native rollback boundary across a ${failure} failure and service restart`,
    () =>
      Effect.gen(function* () {
        const thread = {
          id: input.threadId,
          activeProviderThreadId: input.providerThreadId,
          modelSelection: { instanceId: "codex", model: "test" },
          worktreePath: "/isolated",
        };
        const providerThread = {
          id: input.providerThreadId,
          providerSessionId: "session",
          providerInstanceId: "codex",
          driver: "codex",
          nativeThreadRef: null,
          nativeMetadata: null,
        };
        const checkpoints: Array<{
          id: string;
          scopeId: string;
          status: string;
          appRunOrdinal: number;
          runId: null;
          nodeId: string;
          rollbackBoundary?:
            | {
                providerThreadId: ProviderThreadId;
                retainedTurnCount: number;
              }
            | undefined;
        }> = [
          {
            id: input.checkpointId,
            scopeId: input.scopeId,
            status: "ready",
            appRunOrdinal: 2,
            runId: null,
            nodeId: "node-2",
          },
          {
            id: "checkpoint-3",
            scopeId: input.scopeId,
            status: "ready",
            appRunOrdinal: 3,
            runId: null,
            nodeId: "node-3",
          },
        ];
        const projection = {
          thread,
          providerThreads: [providerThread],
          providerSessions: [],
          checkpoints,
          checkpointScopes: [{ id: input.scopeId, cwd: "/isolated" }],
          runs: [1, 2, 3].map((n) => ({
            id: `run-${n}`,
            ordinal: n,
            status: "completed",
            activeAttemptId: `attempt-${n}`,
            rootNodeId: `node-${n}`,
          })),
          attempts: [1, 2, 3].map((n) => ({
            id: `attempt-${n}`,
            runId: `run-${n}`,
            providerTurnId: `turn-${n}`,
          })),
          nodes: [],
          providerTurns: [1, 2, 3].map((n) => ({
            id: `turn-${n}`,
            providerThreadId: input.providerThreadId,
            runAttemptId: `attempt-${n}`,
            ordinal: n,
          })),
        };
        let nativeTurns = [1, 2, 3].map((n) => TurnId.make(`native-${n}`));
        let failed = false;
        let preparations = 0;
        const deps = Layer.mergeAll(
          Layer.mock(CheckpointServiceV2)({
            restore: () =>
              Effect.suspend(() => {
                if (failure !== "restore" || failed) return Effect.void;
                failed = true;
                return Effect.fail(
                  new CheckpointRestoreError({
                    scopeId: input.scopeId,
                    checkpointId: input.checkpointId,
                    cause: "file restore failed",
                  }),
                );
              }),
            deleteStaleRefs: () =>
              Effect.suspend(() => {
                if (failure !== "delete-refs" || failed) return Effect.void;
                failed = true;
                return Effect.fail(
                  new CheckpointDeleteStaleRefsError({
                    scopeId: input.scopeId,
                    checkpointIds: [CheckpointId.make("checkpoint-3")],
                    cause: "ref deletion failed",
                  }),
                );
              }),
          }),
          Layer.mock(EventSinkV2)({
            write: ({ events }) =>
              Effect.suspend(() => {
                const preparing =
                  events[0]?.type === "checkpoint.captured" &&
                  events[0].payload.id === input.checkpointId;
                if (
                  !failed &&
                  ((failure === "prepare-write" && preparing) ||
                    (failure === "result-write" && !preparing))
                ) {
                  failed = true;
                  return Effect.fail(
                    new EventSinkWriteError({
                      eventCount: events.length,
                      cause: "event write failed",
                    }),
                  );
                }
                for (const event of events) {
                  if (event.type === "checkpoint.captured") {
                    const index = checkpoints.findIndex(
                      (checkpoint) => checkpoint.id === event.payload.id,
                    );
                    if (index >= 0)
                      checkpoints[index] = {
                        ...checkpoints[index]!,
                        ...event.payload,
                        runId: null,
                        appRunOrdinal: event.payload.appRunOrdinal ?? 0,
                      };
                  }
                  if (event.type === "run.updated") {
                    const run = projection.runs.find((run) => run.id === event.payload.id);
                    if (run) run.status = event.payload.status;
                  }
                }
                return Effect.succeed([]);
              }),
          }),
          IdAllocator.layer,
          Layer.mock(ProjectionStoreV2)({
            getThreadRecords: () => Effect.succeed(projection as never),
            getShellSnapshot: () =>
              Effect.succeed({ threads: [thread], archivedThreads: [] } as never),
          }),
          Layer.mock(ProviderSessionManagerV2)({
            open: () =>
              Effect.succeed({
                prepareRollback: () =>
                  Effect.sync(() => {
                    preparations++;
                    return Math.max(0, nativeTurns.length - 1);
                  }),
                rollbackThread: ({ retainedTurnCount }: { retainedTurnCount?: number }) =>
                  Effect.sync(() => {
                    assert.equal(
                      checkpoints[0]?.rollbackBoundary?.retainedTurnCount,
                      retainedTurnCount,
                      "The native boundary must be durable before the provider is changed",
                    );
                    nativeTurns = nativeTurns.slice(0, retainedTurnCount);
                    return { providerThread };
                  }),
              } as never),
          }),
          Layer.mock(RuntimePolicyV2)({
            resolve: () =>
              Effect.succeed({
                runtimeMode: "full-access",
                interactionMode: "default",
                cwd: "/isolated",
              }),
          }),
          FileSystem.layerNoop({ realPath: (path) => Effect.succeed(path) }),
          Path.layer,
          Layer.mock(ProjectStoreV2)({}),
        );
        const execute = Effect.flatMap(CheckpointRollbackServiceV2, (service) =>
          service.execute(input),
        ).pipe(Effect.provide(layer.pipe(Layer.provide(deps))));
        const first = yield* Effect.exit(execute);
        assert.isTrue(Exit.isFailure(first));
        assert.deepStrictEqual(
          nativeTurns,
          failure === "prepare-write"
            ? [1, 2, 3].map((n) => TurnId.make(`native-${n}`))
            : [TurnId.make("native-1"), TurnId.make("native-2")],
        );
        // Building the layer again represents a restart; only the persisted checkpoint survives.
        yield* execute;
        assert.deepStrictEqual(nativeTurns, [TurnId.make("native-1"), TurnId.make("native-2")]);
        assert.equal(preparations, failure === "prepare-write" ? 2 : 1);
        assert.equal(projection.runs[2]?.status, "rolled_back");
      }),
  );
}

import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import type {
  OrchestrationV2AppThread,
  OrchestrationV2DomainEvent,
  OrchestrationV2Run,
} from "@t3tools/contracts/orchestration-v2";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

it.layer(ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)))(
  "shell item counts",
  (it) => {
    it.effect("counts fork prefixes and local items while excluding rolled-back runs", () =>
      Effect.gen(function* () {
        const store = yield* ProjectionStore.ProjectionStoreV2;
        const now = yield* DateTime.now;
        const instanceId = ProviderInstanceId.make("codex");
        const modelSelection = { instanceId, model: "test" };
        let ordinal = 0;
        const apply = (event: OrchestrationV2DomainEvent) => store.apply(event);
        const createThread = Effect.fn(function* (
          id: string,
          forkedFrom: OrchestrationV2AppThread["forkedFrom"] = null,
        ) {
          const threadId = ThreadId.make(id);
          const thread: OrchestrationV2AppThread = {
            id: threadId,
            projectId: ProjectId.make("project"),
            title: id,
            createdBy: "user",
            creationSource: "web",
            providerInstanceId: instanceId,
            modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          };
          yield* apply({
            id: EventId.make(`create:${id}`),
            type: "thread.created",
            threadId,
            occurredAt: now,
            payload: thread,
          });
          return threadId;
        });
        const createRun = Effect.fn(function* (
          threadId: ThreadId,
          order: number,
          status: OrchestrationV2Run["status"] = "completed",
        ) {
          const run: OrchestrationV2Run = {
            id: RunId.make(`${threadId}:${order}`),
            threadId,
            ordinal: order,
            providerInstanceId: instanceId,
            modelSelection,
            providerThreadId: null,
            userMessageId: MessageId.make(`${threadId}:message:${order}`),
            rootNodeId: null,
            activeAttemptId: null,
            status,
            requestedAt: now,
            startedAt: now,
            completedAt: now,
            checkpointId: null,
            contextHandoffId: null,
          };
          yield* apply({
            id: EventId.make(`run:${run.id}`),
            type: "run.updated",
            threadId,
            occurredAt: now,
            payload: run,
          });
          return run.id;
        });
        const addItems = Effect.fn(function* (
          threadId: ThreadId,
          runId: RunId | null,
          count: number,
        ) {
          for (let index = 0; index < count; index++) {
            const id = TurnItemId.make(`item:${++ordinal}`);
            yield* apply({
              id: EventId.make(id),
              type: "turn-item.updated",
              threadId,
              occurredAt: now,
              payload: {
                id,
                threadId,
                runId,
                nodeId: null,
                providerThreadId: null,
                providerTurnId: null,
                nativeItemRef: null,
                parentItemId: null,
                ordinal,
                status: "completed",
                title: null,
                startedAt: now,
                completedAt: now,
                updatedAt: now,
                type: "system_notice",
                message: "History item",
              },
            });
          }
        });
        const source = yield* createThread("source");
        const prefix = yield* createRun(source, 1);
        yield* addItems(source, prefix, 3);
        yield* addItems(source, yield* createRun(source, 2, "rolled_back"), 4);
        yield* addItems(source, null, 1);
        const fork = yield* createThread("fork", { type: "run", threadId: source, runId: prefix });
        yield* addItems(fork, yield* createRun(fork, 1), 2);
        const snapshot = yield* store.getShellSnapshot();
        assert.equal(snapshot.threads.find((thread) => thread.id === source)?.itemCount, 4);
        assert.equal(snapshot.threads.find((thread) => thread.id === fork)?.itemCount, 2);
        assert.equal(snapshot.threads.find((thread) => thread.id === fork)?.visibleItemCount, 6);
        assert.equal((yield* store.getThreadShell(fork))?.visibleItemCount, 6);
        assert.equal((yield* store.getThreadShell(source))?.itemCount, 4);
      }),
    );
  },
);

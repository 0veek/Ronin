import { assert, it } from "@effect/vitest";
import {
  EventId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const orphaned = Effect.gen(function* () {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const threadId = ThreadId.make("orphaned-thread");
  const instanceId = ProviderInstanceId.make("claudeAgent");
  const nodeId = NodeId.make("orphaned-node");
  yield* store.apply({
    id: EventId.make("orphaned-thread-created"),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload: {
      createdBy: "user",
      creationSource: "web",
      id: threadId,
      projectId: ProjectId.make("orphaned-project"),
      title: "Orphaned subagent",
      providerInstanceId: instanceId,
      modelSelection: { instanceId, model: "test" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
  });
  yield* store.apply({
    id: EventId.make("orphaned-node-created"),
    type: "node.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: nodeId,
      threadId,
      runId: null,
      parentNodeId: null,
      rootNodeId: nodeId,
      kind: "subagent",
      status: "running",
      countsForRun: false,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      runtimeRequestId: null,
      checkpointScopeId: null,
      startedAt: now,
      completedAt: null,
    },
  });
  yield* store.apply({
    id: EventId.make("orphaned-subagent-created"),
    type: "subagent.updated",
    threadId,
    occurredAt: now,
    payload: {
      id: nodeId,
      threadId,
      runId: null,
      parentNodeId: nodeId,
      origin: "provider_native",
      createdBy: "agent",
      driver: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: instanceId,
      providerThreadId: null,
      childThreadId: null,
      nativeTaskRef: null,
      prompt: "Check this",
      title: null,
      model: null,
      result: null,
      status: "running",
      startedAt: now,
      completedAt: null,
      updatedAt: now,
    },
  });
  // No running run, session, or turn item can otherwise select this thread.
  assert.deepEqual(yield* store.getRecoveryThreadIds("runtime"), [threadId]);
  const projection = yield* store.getRuntimeRecoveryProjection(threadId);
  assert.deepEqual(
    projection.subagents.map((agent) => agent.id),
    [nodeId],
  );
  assert.deepEqual(
    projection.nodes.map((node) => node.id),
    [nodeId],
  );
});
it.effect("memory recovery finds a native subagent without any unfinished run or item", () =>
  orphaned.pipe(Effect.provide(ProjectionStore.layerMemory)),
);
it.effect("SQL recovery loads the orphaned native subagent and its node", () =>
  orphaned.pipe(Effect.provide(ProjectionStore.layer.pipe(Layer.provide(SqlitePersistenceMemory)))),
);

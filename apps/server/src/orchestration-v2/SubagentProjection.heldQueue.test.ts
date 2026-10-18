import { assert, it } from "@effect/vitest";
import {
  MessageId,
  NodeId,
  ProviderInstanceId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type { OrchestrationV2Run } from "@t3tools/contracts/orchestration-v2";
import * as DateTime from "effect/DateTime";
import { delegatedTaskProgress } from "./SubagentProjection.ts";

it("publishes a child's result while held queued wakes wait for the user", () => {
  const now = DateTime.makeUnsafe("2026-10-07T00:00:00Z");
  const instanceId = ProviderInstanceId.make("codex");
  const finished: OrchestrationV2Run = {
    id: RunId.make("finished"),
    threadId: ThreadId.make("child"),
    ordinal: 1,
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "test" },
    providerThreadId: null,
    userMessageId: MessageId.make("prompt"),
    rootNodeId: NodeId.make("root"),
    activeAttemptId: RunAttemptId.make("attempt"),
    status: "cancelled",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    checkpointId: null,
    contextHandoffId: null,
  };
  const waiting: OrchestrationV2Run = {
    ...finished,
    id: RunId.make("wake"),
    ordinal: 2,
    status: "queued",
    startedAt: null,
    completedAt: null,
    queueHeld: true,
  };
  const projection = {
    runs: [finished, waiting],
    messages: [],
    subagents: [],
    providerThreads: [],
  };
  assert.equal(delegatedTaskProgress(projection).state, "result_available");
  assert.equal(delegatedTaskProgress(projection).resultRun?.id, finished.id);
  assert.equal(
    delegatedTaskProgress({ ...projection, runs: [finished, { ...waiting, queueHeld: false }] })
      .state,
    "working",
  );
});

import { assert, it } from "@effect/vitest";
import { MessageId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import {
  OrchestrationV2RuntimeRequest,
  OrchestrationV2StoredEvent,
  OrchestrationV2TurnItem,
  type OrchestrationV2Run,
} from "@t3tools/contracts/orchestration-v2";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { messageWaitResult, waitForMessageChange } from "./ThreadMessageWait.ts";

const threadId = ThreadId.make("cli-thread");
const messageId = MessageId.make("cli-message");
const runId = RunId.make("cli-run");
const now = DateTime.makeUnsafe("2026-10-29T00:00:00Z");
const instanceId = ProviderInstanceId.make("codex");
const decodeStoredEvent = Schema.decodeUnknownSync(OrchestrationV2StoredEvent);
const run = (overrides: Partial<OrchestrationV2Run> = {}): OrchestrationV2Run => ({
  id: runId,
  threadId,
  ordinal: 1,
  providerInstanceId: instanceId,
  modelSelection: { instanceId, model: "gpt-6" },
  providerThreadId: null,
  userMessageId: messageId,
  rootNodeId: null,
  activeAttemptId: null,
  status: "running",
  requestedAt: now,
  startedAt: now,
  completedAt: null,
  checkpointId: null,
  contextHandoffId: null,
  ...overrides,
});
const approval = Schema.decodeUnknownSync(OrchestrationV2RuntimeRequest)({
  id: "approval",
  nodeId: "node",
  providerTurnId: null,
  nativeRequestRef: null,
  kind: "command",
  status: "pending",
  responseCapability: { type: "message" },
  createdAt: now,
  resolvedAt: null,
});
const answer = Schema.decodeUnknownSync(OrchestrationV2TurnItem)({
  id: "answer",
  threadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed",
  title: null,
  startedAt: now,
  completedAt: now,
  updatedAt: now,
  type: "assistant_message",
  messageId: "answer-message",
  text: "Final reply",
  streaming: false,
});

it("follows restart continuations and ignores later unrelated user runs", () => {
  const continuation = RunId.make("continued-run");
  const records = {
    runs: [
      run({ status: "cancelled" }),
      run({ id: continuation, restartContinuationOfRunId: runId, status: "failed" }),
      run({
        id: RunId.make("later"),
        userMessageId: MessageId.make("later-message"),
        status: "running",
      }),
    ],
    runtimeRequests: [],
    turnItems: [],
  };
  assert.deepStrictEqual(messageWaitResult(threadId, messageId, records), {
    threadId,
    messageId,
    runId: continuation,
    status: "failed",
    text: "",
  });
});

it("returns completed before inspecting a later run's pending approval", () => {
  const records = {
    runs: [run({ status: "completed" })],
    runtimeRequests: [approval],
    turnItems: [answer],
  };
  assert.strictEqual(messageWaitResult(threadId, messageId, records).status, "completed");
  assert.strictEqual(messageWaitResult(threadId, messageId, records).text, "Final reply");
});

it("reports an approval blocking a queued message without answering it", () => {
  assert.strictEqual(
    messageWaitResult(threadId, messageId, {
      runs: [run({ status: "queued" })],
      runtimeRequests: [approval],
      turnItems: [],
    }).status,
    "needs_input",
  );
});

it.effect(
  "captures a replay cursor before reading so a completion during the read is not lost",
  () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      let reads = 0;
      const pending = { threadId, messageId, runId, status: "pending" as const, text: "" };
      const completed = { ...pending, status: "completed" as const, text: "Final reply" };
      const result = yield* waitForMessageChange(
        {
          latestSequence: () =>
            Effect.sync(() => {
              calls.push("cursor");
              return 10;
            }),
          stream: (input) => {
            assert.strictEqual(input?.afterSequence, 10);
            calls.push("subscribe");
            return Stream.make(
              decodeStoredEvent({
                sequence: 11,
                commandId: null,
                event: {
                  id: "completed-event",
                  type: "run.updated",
                  threadId,
                  occurredAt: now,
                  payload: run({ status: "completed" }),
                },
              }),
            );
          },
        },
        threadId,
        Effect.sync(() => {
          calls.push("read");
          reads++;
          return reads === 1 ? pending : completed;
        }),
      );
      assert.deepStrictEqual(calls, ["cursor", "read", "subscribe", "read"]);
      assert.strictEqual(reads, 2);
      assert.strictEqual(result?.status, "completed");
    }),
);

it("reports a held queue as needing user input", () => {
  assert.strictEqual(
    messageWaitResult(threadId, messageId, {
      runs: [run({ status: "queued", queueHeld: true })],
      runtimeRequests: [],
      turnItems: [],
    }).status,
    "needs_input",
  );
});

it("keeps waiting for a submission that has not reached the runtime yet", () => {
  assert.strictEqual(
    messageWaitResult(threadId, messageId, { runs: [], runtimeRequests: [], turnItems: [] }).status,
    "pending",
  );
});

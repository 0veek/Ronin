import type { MessageId, ThreadId, ThreadMessageWaitResult } from "@t3tools/contracts";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts/orchestration-v2";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

type WaitRecords = Pick<OrchestrationV2ThreadProjection, "runs" | "runtimeRequests" | "turnItems">;

function submittedRun(messageId: MessageId, runs: WaitRecords["runs"]) {
  let run = runs.find((candidate) => candidate.userMessageId === messageId);
  const visited = new Set<string>();
  while (run !== undefined && !visited.has(run.id)) {
    visited.add(run.id);
    const next = runs.find((candidate) => candidate.restartContinuationOfRunId === run?.id);
    if (next === undefined || visited.has(next.id)) break;
    run = next;
  }
  return run;
}

/** Resolve only this submission and its restart continuations, never a later user turn. */
export function messageWaitResult(
  threadId: ThreadId,
  messageId: MessageId,
  records: WaitRecords,
): ThreadMessageWaitResult {
  const run = submittedRun(messageId, records.runs);
  const items = records.turnItems.filter((item) => item.runId === run?.id);
  const text = items
    .filter((item) => item.type === "assistant_message")
    .map((item) => item.text)
    .join("\n\n");
  const failure = items.findLast((item) => item.type === "error");
  const base = { threadId, messageId, runId: run?.id ?? null, text };
  // A later run's question must not hide this run's completed result.
  if (
    run !== undefined &&
    (run.status === "completed" ||
      run.status === "failed" ||
      run.status === "interrupted" ||
      run.status === "cancelled" ||
      run.status === "rolled_back")
  ) {
    return {
      ...base,
      status: run.status,
      ...(failure?.type === "error" ? { error: failure.failure.message } : {}),
    };
  }
  const needsInput =
    run?.queueHeld === true ||
    records.runtimeRequests.some(
      (request) =>
        request.status === "pending" &&
        request.kind !== "dynamic_tool_call" &&
        request.kind !== "auth_refresh",
    ) ||
    records.turnItems.some(
      (item) => item.type === "secret_request" && item.secretStatus === "pending",
    );
  return { ...base, status: needsInput ? "needs_input" : "pending" };
}

/** Capture the event cursor before reading so a change during the read cannot be missed. */
export const waitForThreadMessage = Effect.fn("waitForThreadMessage")(function* (
  threadId: ThreadId,
  messageId: MessageId,
) {
  const sink = yield* EventSinkV2;
  const projections = yield* ProjectionStoreV2;
  const legacy = yield* ProjectionSnapshotQuery;
  const read = Effect.gen(function* () {
    const records = yield* projections
      .getThreadRecords(threadId, ["runs", "runtimeRequests", "turnItems"], {
        turnItemTypes: ["secret_request"],
      })
      .pipe(Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }));
    const run = records === null ? undefined : submittedRun(messageId, records.runs);
    // Fetch reply text only for this run, and only when it can be returned.
    // Waiting on a busy thread never hydrates its assistant-message history.
    if (
      records !== null &&
      run !== undefined &&
      !["preparing", "queued", "starting", "running", "waiting"].includes(run.status)
    ) {
      const reply = yield* projections.getThreadRecords(threadId, ["turnItems"], {
        turnItemRunIds: [run.id],
        turnItemTypes: ["assistant_message", "error"],
      });
      return messageWaitResult(threadId, messageId, {
        ...records,
        turnItems: [...records.turnItems, ...reply.turnItems],
      });
    }
    const result = records === null ? null : messageWaitResult(threadId, messageId, records);
    if (result !== null && (result.runId !== null || result.status !== "pending")) return result;
    const shell = yield* legacy.getThreadShellById(threadId);
    if (Option.isNone(shell)) return null;
    const failed = shell.value.session?.status === "error";
    return {
      threadId,
      messageId,
      runId: null,
      status: failed ? "failed" : "pending",
      text: "",
      ...(shell.value.session?.lastError ? { error: shell.value.session.lastError } : {}),
    } satisfies ThreadMessageWaitResult;
  });
  return yield* waitForMessageChange(sink, threadId, read);
});

export const waitForMessageChange = Effect.fn("waitForMessageChange")(function* <E, R>(
  sink: Pick<EventSinkV2["Service"], "latestSequence" | "stream">,
  threadId: ThreadId,
  read: Effect.Effect<ThreadMessageWaitResult | null, E, R>,
) {
  const afterSequence = yield* sink.latestSequence({ threadId });
  const initial = yield* read;
  if (initial === null || initial.status !== "pending") return initial;
  const changed = yield* sink.stream({ threadId, afterSequence, bounded: true }).pipe(
    Stream.filter(
      (stored) =>
        stored.event.type !== "turn-item.updated" ||
        stored.event.payload.type === "secret_request" ||
        stored.event.payload.type === "error",
    ),
    Stream.mapEffect(() => read),
    Stream.filter((result) => result === null || result.status !== "pending"),
    Stream.runHead,
    Effect.timeoutOption("15 seconds"),
  );
  if (Option.isSome(changed) && Option.isSome(changed.value)) return changed.value.value;
  // Also catches bootstrap errors, which are recorded in the compatibility model.
  return yield* read;
});

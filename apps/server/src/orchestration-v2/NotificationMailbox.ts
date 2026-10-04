import type { MessageId } from "@t3tools/contracts";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts/orchestration-v2";

/**
 * A persisted steer without an acceptance receipt can be retried as a continuation.
 * Delivery is at least once: provider acceptance and our receipt cannot commit
 * atomically. Reusing the message ID keeps recovery from duplicating timeline items.
 */
export function isUndeliveredMailboxSteer(
  projection: Pick<OrchestrationV2ThreadProjection, "messages" | "runs" | "providerTurns">,
  messageId: MessageId,
): boolean {
  const message = projection.messages.find((candidate) => candidate.id === messageId);
  if (message?.delegatedCompletion === undefined) return false;
  const run = projection.runs.find((candidate) => candidate.id === message.runId);
  return (
    run !== undefined &&
    run.userMessageId !== message.id &&
    (["completed", "failed", "interrupted", "cancelled", "rolled_back"].includes(run.status) ||
      projection.providerTurns.some(
        (turn) => turn.runAttemptId === run.activeAttemptId && turn.status === "completed",
      ))
  );
}

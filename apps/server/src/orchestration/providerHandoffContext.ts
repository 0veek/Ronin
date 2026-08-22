/**
 * Turns a thread's read model into the shape `providerHandoffBrief` renders.
 *
 * The transcript is only part of what an incoming provider needs. What the
 * outgoing one *did* — the tools it ran, the files it touched, the command that
 * failed — is what stops the new provider from walking back down a path that
 * has already been tried, and none of it lives in message text. This module is
 * where read-model activities, attachments, checkpoints and plans are folded
 * into the per-message shape the renderer understands.
 *
 * Pure and deterministic, for the same reason the renderer is: an interrupted
 * or retried turn has to rebuild the same brief from the same durable history.
 *
 * @module providerHandoffContext
 */
import type {
  MessageId,
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";

import type {
  ProviderHandoffBriefFileChange,
  ProviderHandoffBriefMessage,
  ProviderHandoffBriefPlan,
  ProviderHandoffBriefWorkEntry,
} from "./providerHandoffBrief.ts";

/** Steps kept per turn. The renderer caps the rendering; this caps the work. */
const MAX_WORK_ENTRIES_PER_TURN = 16;
const MAX_NOTICES_PER_MESSAGE = 4;
const MAX_ATTACHMENT_NAMES = 6;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A tool call, reduced to "what was run and did it work".
 *
 * Only terminal activities become work entries: a `tool.started` row with no
 * completion is either still running or was abandoned, and either way it says
 * nothing reliable about what the workspace looks like now.
 */
function toWorkEntry(
  activity: OrchestrationThreadActivity,
): ProviderHandoffBriefWorkEntry | undefined {
  const payload = asRecord(activity.payload);
  switch (activity.kind) {
    case "tool.completed": {
      const status = asText(payload?.status);
      return {
        label: activity.summary,
        ...(asText(payload?.detail) !== undefined ? { detail: asText(payload?.detail) } : {}),
        ...(status === "failed" || status === "declined" ? { failed: true } : {}),
      };
    }
    case "tool.denied": {
      return {
        label: activity.summary,
        ...(asText(payload?.detail) !== undefined ? { detail: asText(payload?.detail) } : {}),
        failed: true,
      };
    }
    case "runtime.error": {
      return {
        label: "Runtime error",
        ...(asText(payload?.message) !== undefined ? { detail: asText(payload?.message) } : {}),
        failed: true,
      };
    }
    default:
      return undefined;
  }
}

/**
 * Thread-level events worth a line of their own.
 *
 * These are the things that explain why the transcript reads the way it does —
 * a compaction means detail was already lost once, a denied approval means the
 * work stopped for a reason that is not in any message.
 */
function toNotice(activity: OrchestrationThreadActivity): string | undefined {
  const payload = asRecord(activity.payload);
  switch (activity.kind) {
    case "context-compaction":
      return "The provider's context was compacted at this point, so detail from before it had already been lost once.";
    case "checkpoint.revert.failed":
      return "A checkpoint revert failed here; the workspace may not match what the transcript describes.";
    case "checkpoint.capture.failed":
      return "A checkpoint could not be captured here, so this turn has no restore point.";
    case "approval.resolved": {
      return asText(payload?.decision) === "denied"
        ? `The user denied an approval here (${asText(payload?.requestKind) ?? "request"}).`
        : undefined;
    }
    default:
      return undefined;
  }
}

function attachmentNames(message: OrchestrationMessage): ReadonlyArray<string> {
  return (message.attachments ?? []).slice(0, MAX_ATTACHMENT_NAMES).map((a) => a.name);
}

/**
 * The transcript, with each turn's work and the events around it folded in.
 *
 * Work is keyed by turn, so it lands on the assistant message that turn
 * produced. Notices are keyed by time and land on the first message at or after
 * them; anything after the last message is dropped, because in practice that is
 * the switch being handed over right now, which the brief's header already
 * explains.
 */
export function buildProviderHandoffMessages(input: {
  readonly thread: OrchestrationThread;
  /** The message being sent this turn; it is the request, not history. */
  readonly excludeMessageId?: MessageId | undefined;
}): ReadonlyArray<ProviderHandoffBriefMessage> {
  // A partially streamed message stays: an interrupted turn is exactly the
  // history an incoming provider most needs, and dropping it would also drop
  // the attribution that decides how much of the thread it has to be told.
  const messages = input.thread.messages.filter((message) => message.id !== input.excludeMessageId);
  if (messages.length === 0) {
    return [];
  }

  const workByTurn = new Map<TurnId, Array<ProviderHandoffBriefWorkEntry>>();
  const pendingNotices: Array<{ readonly createdAt: string; readonly text: string }> = [];
  for (const activity of input.thread.activities) {
    const turnId = activity.turnId;
    const work = turnId !== null ? toWorkEntry(activity) : undefined;
    if (work) {
      const entries = workByTurn.get(turnId as TurnId) ?? [];
      if (entries.length < MAX_WORK_ENTRIES_PER_TURN) {
        entries.push(work);
      }
      workByTurn.set(turnId as TurnId, entries);
      continue;
    }
    const notice = toNotice(activity);
    if (notice) {
      pendingNotices.push({ createdAt: activity.createdAt, text: notice });
    }
  }

  // Both lists are in time order, so one walk places every notice. Threads can
  // hold thousands of messages and as many activities; scanning the transcript
  // per notice would make a handoff quadratic in thread length.
  const noticesByMessageId = new Map<MessageId, Array<string>>();
  pendingNotices.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  let cursor = 0;
  for (const notice of pendingNotices) {
    while (cursor < messages.length && messages[cursor]!.createdAt < notice.createdAt) {
      cursor += 1;
    }
    const target = messages[cursor];
    if (target === undefined) {
      break;
    }
    const list = noticesByMessageId.get(target.id) ?? [];
    if (list.length < MAX_NOTICES_PER_MESSAGE) {
      list.push(notice.text);
      noticesByMessageId.set(target.id, list);
    }
  }

  return messages.map((message) => {
    const attachments = attachmentNames(message);
    const work =
      message.role === "assistant" && message.turnId !== null
        ? workByTurn.get(message.turnId)
        : undefined;
    const notices = noticesByMessageId.get(message.id);
    return {
      id: message.id,
      role: message.role,
      text: message.text,
      ...(message.providerInstanceId !== undefined
        ? { providerInstanceId: message.providerInstanceId }
        : {}),
      ...(message.providerName !== undefined ? { providerName: message.providerName } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(work && work.length > 0 ? { work } : {}),
      ...(notices && notices.length > 0 ? { notices } : {}),
    };
  });
}

/**
 * Where the work has been concentrated, as churn per file.
 *
 * Each checkpoint records one turn's own delta, so these add up rather than
 * netting out; the renderer labels them as churn for that reason. Turns that a
 * revert threw away are already gone from the read model, so nothing here
 * describes changes that are no longer on disk. Checkpoints whose diff did not
 * come back cleanly are skipped rather than trusted.
 */
export function buildProviderHandoffChangedFiles(
  thread: OrchestrationThread,
): ReadonlyArray<ProviderHandoffBriefFileChange> {
  const byPath = new Map<
    string,
    { path: string; additions: number; deletions: number; turns: number }
  >();
  for (const checkpoint of thread.checkpoints) {
    if (checkpoint.status !== "ready") {
      continue;
    }
    for (const file of checkpoint.files) {
      const existing = byPath.get(file.path);
      byPath.set(file.path, {
        path: file.path,
        additions: (existing?.additions ?? 0) + file.additions,
        deletions: (existing?.deletions ?? 0) + file.deletions,
        turns: (existing?.turns ?? 0) + 1,
      });
    }
  }
  return [...byPath.values()];
}

/**
 * The plan the thread is working to, when one was proposed.
 *
 * The most recent one wins: a revised plan supersedes the one it revised, and
 * plans thrown away by a revert are already gone from the read model.
 */
export function buildProviderHandoffPlan(
  thread: OrchestrationThread,
): ProviderHandoffBriefPlan | null {
  const latest = thread.proposedPlans.at(-1);
  return latest === undefined
    ? null
    : { markdown: latest.planMarkdown, implemented: latest.implementedAt !== null };
}

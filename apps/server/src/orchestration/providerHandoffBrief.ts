/**
 * Renders the brief handed to a provider that is picking up a conversation it
 * did not start.
 *
 * A provider session on a thread with existing history must never start cold.
 * When the incoming provider has native resume state of its own it resumes and
 * only needs the delta it missed; when it has none it needs the whole story.
 * Both cases produce a brief here — the difference is only which messages go
 * into it, which `selectHandoffMessages` decides. Recent turns stay in full;
 * older ones collapse to one-line bullets. The caller wraps the result with
 * `wrapProviderHandoffInput` so the incoming model can tell the brief from the
 * user's latest message.
 *
 * Everything in this module is pure and deterministic. The caller supplies the
 * read-model data it already has in hand, so building a brief costs no queries
 * and no model call, and the result is identical on every retry of the same
 * turn.
 *
 * @module providerHandoffBrief
 */
import type { ProviderInstanceId } from "@t3tools/contracts";

/** A transcript entry, reduced to what the brief actually renders. */
export interface ProviderHandoffBriefMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  /** Absent for user/system messages and for anything recorded pre-attribution. */
  readonly providerInstanceId?: ProviderInstanceId | undefined;
  readonly providerName?: string | undefined;
}

export interface ProviderHandoffBriefWorkspace {
  readonly threadTitle: string | null;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly cwd: string | null;
}

export interface ProviderHandoffBriefFileChange {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface ProviderHandoffBriefInput {
  readonly workspace: ProviderHandoffBriefWorkspace;
  readonly messages: ReadonlyArray<ProviderHandoffBriefMessage>;
  readonly changedFiles: ReadonlyArray<ProviderHandoffBriefFileChange>;
  /** Name of the provider handing the thread over, when one is known. */
  readonly fromProviderName: string | null;
  /**
   * `resumed` when the incoming provider reattached to its own native session
   * and the brief only covers what happened while it was away; `briefed` when
   * it is starting cold and the brief is the whole conversation it has.
   */
  readonly mode: ProviderHandoffMode;
  /** Hard ceiling for the rendered brief, in characters. */
  readonly maxChars: number;
}

export type ProviderHandoffMode = "resumed" | "briefed";

export interface ProviderHandoffBrief {
  readonly text: string;
  readonly chars: number;
  /** True when any message body or the message list itself had to be cut. */
  readonly compressed: boolean;
  readonly messageCount: number;
}

/** Below this a per-message budget stops being worth spending characters on. */
const MIN_MESSAGE_BUDGET_CHARS = 240;
const MAX_CHANGED_FILES = 40;
/** Recent turns stay in full; everything older collapses to one-line bullets. */
const RECENT_MESSAGE_COUNT = 6;
const RECENT_MESSAGE_CHAR_LIMIT = 2_400;
const EARLIER_MESSAGE_CHAR_LIMIT = 320;

const HANDOFF_CONTEXT_TAG = "handoff_context";
const LATEST_USER_MESSAGE_TAG = "latest_user_message";

/**
 * Wrap a reconstructed brief and the user's actual request so the incoming
 * provider can tell background from the thing it has to answer.
 *
 * Synara's handoff does this with the same two tags. A markdown "continue the
 * conversation" header mixed the two together and the model sometimes treated
 * the transcript as the current ask.
 */
export function wrapProviderHandoffInput(input: {
  readonly contextText: string;
  readonly messageText: string;
}): string {
  return (
    `<${HANDOFF_CONTEXT_TAG}>\n${input.contextText}\n</${HANDOFF_CONTEXT_TAG}>\n\n` +
    `<${LATEST_USER_MESSAGE_TAG}>\n${input.messageText}\n</${LATEST_USER_MESSAGE_TAG}>`
  );
}

/** Characters the envelope itself consumes for a given user message. */
export function handoffWrapOverhead(messageText: string): number {
  return wrapProviderHandoffInput({ contextText: "", messageText }).length;
}

function truncateBody(text: string, budget: number): { text: string; truncated: boolean } {
  if (text.length <= budget) {
    return { text, truncated: false };
  }
  const elided = text.length - budget;
  return {
    text: `${text.slice(0, budget)}\n… [${elided} characters elided]`,
    truncated: true,
  };
}

function speakerLabel(message: ProviderHandoffBriefMessage): string {
  if (message.role === "user") {
    return "User";
  }
  if (message.role === "system") {
    return "System";
  }
  return message.providerName ? `Assistant (${message.providerName})` : "Assistant";
}

/**
 * The slice of the transcript the incoming provider has not already seen.
 *
 * A provider that resumes its own native session still holds everything it
 * said and everything said to it up to the moment it was switched away from,
 * so replaying that would duplicate its context. The boundary is the last
 * message authored by *any* instance in its continuation group — instances that
 * share a group can resume each other's sessions, so they share a history too.
 *
 * A provider with no resumable state gets the whole list: it has seen nothing.
 */
export function selectHandoffMessages(input: {
  readonly messages: ReadonlyArray<ProviderHandoffBriefMessage>;
  /** Continuation key for each instance that authored a message in the thread. */
  readonly continuationKeyByInstanceId: ReadonlyMap<ProviderInstanceId, string>;
  /** The incoming provider's continuation key, when it has resumable state. */
  readonly resumedContinuationKey?: string | undefined;
}): ReadonlyArray<ProviderHandoffBriefMessage> {
  if (input.resumedContinuationKey === undefined) {
    return input.messages;
  }
  let lastOwnIndex = -1;
  for (let index = 0; index < input.messages.length; index += 1) {
    const instanceId = input.messages[index]?.providerInstanceId;
    if (instanceId === undefined) {
      continue;
    }
    if (input.continuationKeyByInstanceId.get(instanceId) === input.resumedContinuationKey) {
      lastOwnIndex = index;
    }
  }
  // No message of its own in the thread: the cursor may be stale or the
  // history predates attribution. Replaying is the safe direction — a provider
  // that sees a turn twice is recoverable, one that never sees it is not.
  if (lastOwnIndex < 0) {
    return input.messages;
  }
  return input.messages.slice(lastOwnIndex + 1);
}

function renderWorkspaceSection(workspace: ProviderHandoffBriefWorkspace): string {
  const lines: Array<string> = [];
  if (workspace.threadTitle) {
    lines.push(`- Thread: ${workspace.threadTitle}`);
  }
  if (workspace.cwd) {
    lines.push(`- Working directory: ${workspace.cwd}`);
  }
  if (workspace.worktreePath && workspace.worktreePath !== workspace.cwd) {
    lines.push(`- Worktree: ${workspace.worktreePath}`);
  }
  if (workspace.branch) {
    lines.push(`- Branch: ${workspace.branch}`);
  }
  return lines.length > 0 ? `## Workspace\n${lines.join("\n")}` : "";
}

function renderChangedFilesSection(files: ReadonlyArray<ProviderHandoffBriefFileChange>): string {
  if (files.length === 0) {
    return "";
  }
  const shown = files.slice(0, MAX_CHANGED_FILES);
  const lines = shown.map((file) => `- ${file.path} (+${file.additions}/-${file.deletions})`);
  if (files.length > shown.length) {
    lines.push(`- … and ${files.length - shown.length} more files`);
  }
  return `## Files already changed in this conversation\n${lines.join("\n")}`;
}

function renderHeader(input: ProviderHandoffBriefInput): string {
  const handedOverBy = input.fromProviderName ? ` from ${input.fromProviderName}` : "";
  if (input.mode === "resumed") {
    return [
      "# Handoff: catching up",
      "",
      `You are resuming your own session on this thread, but work continued${handedOverBy} while you were away.` +
        " Everything below happened since your last message. Read it, then continue from there.",
    ].join("\n");
  }
  return [
    "# Handoff: taking over",
    "",
    `You are taking over an in-progress conversation${handedOverBy}.` +
      " You have none of this history in your own context, so the transcript below is all you have." +
      " Read it, then continue from there.",
  ].join("\n");
}

function renderMessages(
  messages: ReadonlyArray<ProviderHandoffBriefMessage>,
  budgetPerMessage: number,
): { readonly text: string; readonly truncated: boolean } {
  let truncated = false;
  const blocks = messages.map((message) => {
    const body = truncateBody(message.text.trim(), budgetPerMessage);
    truncated = truncated || body.truncated;
    return `### ${speakerLabel(message)}\n${body.text}`;
  });
  return { text: blocks.join("\n\n"), truncated };
}

function sliceForSummary(text: string, budget: number): string {
  const normalized = text
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length <= budget) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, budget - 3)).trimEnd()}...`;
}

function earlierSummaryLine(message: ProviderHandoffBriefMessage): string {
  return `- ${speakerLabel(message)}: ${sliceForSummary(message.text, EARLIER_MESSAGE_CHAR_LIMIT)}`;
}

function renderEarlierSummary(
  messages: ReadonlyArray<ProviderHandoffBriefMessage>,
  omittedCount: number,
): string {
  if (messages.length === 0 && omittedCount === 0) {
    return "";
  }
  const omitted =
    omittedCount > 0
      ? ` (${omittedCount} older message${omittedCount === 1 ? "" : "s"} omitted to fit the context budget)`
      : "";
  const lines = messages.map(earlierSummaryLine);
  return [`## Earlier conversation summary${omitted}`, ...lines].join("\n");
}

function assemble(input: {
  readonly header: string;
  readonly workspace: string;
  readonly changedFiles: string;
  readonly earlier: string;
  readonly transcript: string;
}): string {
  return [
    input.header,
    input.workspace,
    input.changedFiles,
    input.earlier,
    input.transcript ? `## Transcript\n\n${input.transcript}` : "",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function splitRecent(messages: ReadonlyArray<ProviderHandoffBriefMessage>): {
  readonly earlier: ReadonlyArray<ProviderHandoffBriefMessage>;
  readonly recent: ReadonlyArray<ProviderHandoffBriefMessage>;
} {
  if (messages.length <= RECENT_MESSAGE_COUNT) {
    return { earlier: [], recent: messages };
  }
  return {
    earlier: messages.slice(0, messages.length - RECENT_MESSAGE_COUNT),
    recent: messages.slice(-RECENT_MESSAGE_COUNT),
  };
}

function packEarlier(
  earlier: ReadonlyArray<ProviderHandoffBriefMessage>,
  budget: number,
): {
  readonly kept: ReadonlyArray<ProviderHandoffBriefMessage>;
  readonly omittedCount: number;
} {
  if (earlier.length === 0) {
    return { kept: [], omittedCount: 0 };
  }
  const kept: Array<ProviderHandoffBriefMessage> = [];
  let remaining = budget;
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const message = earlier[index];
    if (message === undefined) {
      continue;
    }
    const line = earlierSummaryLine(message);
    if (remaining < line.length + 1) {
      break;
    }
    remaining -= line.length + 1;
    kept.unshift(message);
  }
  return { kept, omittedCount: earlier.length - kept.length };
}

/**
 * Render the brief, fitting it into `maxChars`.
 *
 * The last few turns stay in full so the incoming provider can act on them.
 * Everything older collapses to one-line bullets rather than disappearing —
 * a sketch of the earlier conversation is more useful than a hole. Under
 * harder budget pressure the renderer shortens recent bodies, then drops the
 * oldest bullets, then (only if even the recent turns will not fit) drops the
 * oldest recent messages.
 */
export function renderProviderHandoffBrief(input: ProviderHandoffBriefInput): ProviderHandoffBrief {
  const header = renderHeader(input);
  const workspace = renderWorkspaceSection(input.workspace);
  const changedFiles = renderChangedFilesSection(input.changedFiles);
  const messages = input.messages.filter((message) => message.text.trim().length > 0);
  const { earlier, recent } = splitRecent(messages);

  const fullRecent = renderMessages(recent, Number.POSITIVE_INFINITY);
  const fullText = assemble({
    header,
    workspace,
    changedFiles,
    earlier: renderEarlierSummary(earlier, 0),
    transcript: fullRecent.text,
  });
  if (fullText.length <= input.maxChars) {
    return {
      text: fullText,
      chars: fullText.length,
      compressed: false,
      messageCount: messages.length,
    };
  }

  const fitRecent = (
    recentKept: ReadonlyArray<ProviderHandoffBriefMessage>,
    perMessage: number,
    earlierKept: ReadonlyArray<ProviderHandoffBriefMessage>,
    omittedCount: number,
  ): ProviderHandoffBrief => {
    const rendered = renderMessages(recentKept, Math.max(0, perMessage));
    const text = assemble({
      header,
      workspace,
      changedFiles,
      earlier: renderEarlierSummary(earlierKept, omittedCount),
      transcript: rendered.text,
    });
    return {
      text: text.slice(0, input.maxChars),
      chars: Math.min(text.length, input.maxChars),
      compressed: true,
      messageCount: recentKept.length + earlierKept.length,
    };
  };

  // Keep the recent turns at a useful size, then spend whatever is left on
  // earlier bullets (newest of those first). That is the shape Synara uses
  // and the one that preserves the most history under a tight cap.
  let recentKept = recent;
  let recentOmitted = 0;
  for (;;) {
    const perMessage =
      recentKept.length === 0
        ? 0
        : Math.min(
            RECENT_MESSAGE_CHAR_LIMIT,
            Math.floor(
              Math.max(
                0,
                input.maxChars -
                  assemble({
                    header,
                    workspace,
                    changedFiles,
                    earlier: "",
                    transcript: "x",
                  }).length,
              ) / recentKept.length,
            ) - 64,
          );
    if (recentKept.length === 0 || perMessage >= MIN_MESSAGE_BUDGET_CHARS) {
      const recentRendered = renderMessages(recentKept, Math.max(0, perMessage));
      const earlierBudget = Math.max(
        0,
        input.maxChars -
          assemble({
            header,
            workspace,
            changedFiles,
            earlier: renderEarlierSummary([], earlier.length + recentOmitted),
            transcript: recentRendered.text,
          }).length,
      );
      const packed = packEarlier(earlier, earlierBudget);
      return fitRecent(recentKept, perMessage, packed.kept, packed.omittedCount + recentOmitted);
    }
    recentKept = recentKept.slice(1);
    recentOmitted += 1;
  }
}

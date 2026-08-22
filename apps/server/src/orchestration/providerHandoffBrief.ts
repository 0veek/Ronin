/**
 * Renders the brief handed to a provider that is picking up a conversation it
 * did not start.
 *
 * A provider session on a thread with existing history must never start cold.
 * When the incoming provider has native resume state of its own it resumes and
 * only needs the delta it missed; when it has none it needs the whole story.
 * Both cases produce a brief here — the difference is only which messages go
 * into it, which `selectHandoffMessages` decides.
 *
 * The brief keeps as many recent turns as the budget allows in full, collapses
 * older ones to one-line bullets, and — when it is reconstructing a whole
 * conversation — pins the original request so the thing the work is *for*
 * survives even when the middle of the thread does not. Transcript text alone
 * is not the whole story, so each turn also carries the work its provider did
 * (tools run, files touched, what failed) and the thread-level events that
 * landed around it (a compaction, a denied tool, a handover).
 *
 * Everything in this module is pure and deterministic. The caller supplies the
 * read-model data it already has in hand, so building a brief costs no queries
 * and no model call, and the result is identical on every retry of the same
 * turn.
 *
 * @module providerHandoffBrief
 */
import type { MessageId, ProviderInstanceId } from "@t3tools/contracts";

/** One step a provider took while producing a message. */
export interface ProviderHandoffBriefWorkEntry {
  /** How the adapter titled the call — "Edit", "Bash", "Read src/foo.ts". */
  readonly label: string;
  /** The command, path, or argument the step acted on, when there is one. */
  readonly detail?: string | undefined;
  /** Steps that failed are the ones the incoming provider must not repeat. */
  readonly failed?: boolean | undefined;
}

/** A transcript entry, reduced to what the brief actually renders. */
export interface ProviderHandoffBriefMessage {
  readonly id?: MessageId | undefined;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  /** Absent for user/system messages and for anything recorded pre-attribution. */
  readonly providerInstanceId?: ProviderInstanceId | undefined;
  readonly providerName?: string | undefined;
  /**
   * File names attached to the message. A turn whose whole content was a
   * screenshot has no text, and dropping it hands the conversation over with a
   * hole exactly where the user thought they had made their point.
   */
  readonly attachments?: ReadonlyArray<string> | undefined;
  /** What the provider did while producing this message, oldest first. */
  readonly work?: ReadonlyArray<ProviderHandoffBriefWorkEntry> | undefined;
  /** Thread-level events that landed immediately before this message. */
  readonly notices?: ReadonlyArray<string> | undefined;
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
  /** How many turns touched the file. Absent for a single-turn count. */
  readonly turns?: number | undefined;
}

/** The plan the conversation is working to, when one was proposed. */
export interface ProviderHandoffBriefPlan {
  readonly markdown: string;
  readonly implemented: boolean;
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
  /** The standing plan for this thread, pinned when reconstructing cold. */
  readonly plan?: ProviderHandoffBriefPlan | null | undefined;
  /** Hard ceiling for the rendered brief, in characters. */
  readonly maxChars: number;
}

export type ProviderHandoffMode = "resumed" | "briefed";

export interface ProviderHandoffBrief {
  readonly text: string;
  readonly chars: number;
  /**
   * Rough token cost of the brief. Whitespace runs approximate word tokens and
   * long runs split further, which is where a flat chars/4 estimate is worst
   * (code, paths, identifiers). Reported for logging and for the transcript
   * boundary, never used for fitting — the wire contract is in characters.
   */
  readonly estimatedTokens: number;
  /** True when a full-fidelity body was cut or a message was dropped outright. */
  readonly compressed: boolean;
  /** Messages represented in the brief, in full or as a bullet. */
  readonly messageCount: number;
  /** Of those, the ones rendered in full. */
  readonly fullMessageCount: number;
  /** Of those, the ones collapsed to a one-line bullet. */
  readonly summarizedMessageCount: number;
  /** Messages that did not fit at all and are named only as a count. */
  readonly omittedMessageCount: number;
}

/** Below this a per-message budget stops being worth spending characters on. */
const MIN_MESSAGE_BUDGET_CHARS = 240;
const MAX_CHANGED_FILES = 40;
/**
 * The full-fidelity window grows to fit the budget rather than sitting at a
 * fixed size: a short thread that fits entirely should be handed over
 * entirely. The floor is what a provider needs to act on the request at all;
 * the ceiling is where extra fidelity stops paying for itself and a bullet
 * carries the same shape at a tenth of the cost.
 */
const RECENT_MESSAGE_MIN_COUNT = 6;
const RECENT_MESSAGE_MAX_COUNT = 24;
const RECENT_MESSAGE_CHAR_LIMIT = 2_400;
const EARLIER_MESSAGE_CHAR_LIMIT = 320;
const PINNED_MESSAGE_CHAR_LIMIT = 1_200;
const PLAN_CHAR_LIMIT = 2_000;
const MAX_WORK_ENTRIES_PER_MESSAGE = 12;
const WORK_ENTRY_CHAR_LIMIT = 160;
const MAX_NOTICES_PER_MESSAGE = 4;
const NOTICE_CHAR_LIMIT = 160;
/**
 * Share of a truncated body kept from the front. The rest comes from the end:
 * an assistant turn puts its conclusion last, and a brief that keeps only the
 * preamble hands over the reasoning without the answer.
 */
const BODY_HEAD_SHARE = 0.6;
/** Under this there is no room for a head, a tail, and a marker between them. */
const MIN_ELIDABLE_BODY_CHARS = 400;
/** Room for the fence a truncated body may have to close. */
const FENCE_REPAIR_RESERVE_CHARS = 8;

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

/** Rough token cost of a rendered brief. See `ProviderHandoffBrief`. */
export function estimateHandoffTokens(text: string): number {
  let tokens = 0;
  for (const run of text.split(/\s+/)) {
    if (run.length === 0) {
      continue;
    }
    tokens += 1 + Math.floor(run.length / 6);
  }
  return tokens;
}

/**
 * Close a code fence a cut left open.
 *
 * An unbalanced fence makes everything after it read as code, which in a brief
 * means the incoming model can misread the rest of the conversation as one
 * long program.
 */
function balanceFences(text: string): string {
  const fences = text.match(/^ {0,3}```/gm)?.length ?? 0;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

/** Cut from the front, backing up to a line or word boundary when one is near. */
function cutHead(text: string, budget: number): string {
  if (budget <= 0) {
    return "";
  }
  if (text.length <= budget) {
    return text;
  }
  const raw = text.slice(0, budget);
  const floor = Math.floor(budget * 0.7);
  const newline = raw.lastIndexOf("\n");
  if (newline >= floor) {
    return raw.slice(0, newline);
  }
  const space = raw.lastIndexOf(" ");
  return space >= floor ? raw.slice(0, space) : raw;
}

/** Cut from the back, advancing to a line or word boundary when one is near. */
function cutTail(text: string, budget: number): string {
  if (budget <= 0) {
    return "";
  }
  if (text.length <= budget) {
    return text;
  }
  const raw = text.slice(text.length - budget);
  const ceiling = Math.ceil(budget * 0.3);
  const newline = raw.indexOf("\n");
  if (newline >= 0 && newline <= ceiling) {
    return raw.slice(newline + 1);
  }
  const space = raw.indexOf(" ");
  return space >= 0 && space <= ceiling ? raw.slice(space + 1) : raw;
}

function elisionMarker(elided: number): string {
  return `\n… [${elided} characters elided]`;
}

/**
 * Fit a message body into `budget`, keeping the opening and the conclusion.
 *
 * Cuts land on line or word boundaries so the brief never hands over half an
 * identifier, and an opened code fence is closed on the way out.
 */
function truncateBody(text: string, budget: number): { text: string; truncated: boolean } {
  if (text.length <= budget) {
    return { text, truncated: false };
  }
  if (budget <= 0) {
    return { text: "", truncated: true };
  }
  // The marker and any fence repair come out of the same budget, so what this
  // returns is never longer than what the caller allotted.
  const overhead = elisionMarker(text.length).length + FENCE_REPAIR_RESERVE_CHARS;
  const usable = Math.max(0, budget - overhead);
  if (usable === 0) {
    return { text: elisionMarker(text.length).trim(), truncated: true };
  }
  if (usable < MIN_ELIDABLE_BODY_CHARS) {
    const head = cutHead(text, usable);
    return {
      text: balanceFences(head) + elisionMarker(text.length - head.length),
      truncated: true,
    };
  }
  const headBudget = Math.floor(usable * BODY_HEAD_SHARE);
  const head = cutHead(text, headBudget);
  const tail = cutTail(text, usable - head.length);
  const elided = text.length - head.length - tail.length;
  if (elided <= 0) {
    return { text, truncated: false };
  }
  return { text: balanceFences(`${head}${elisionMarker(elided)}\n${tail}`), truncated: true };
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

/** True when a message carries anything the brief can render. */
export function handoffMessageHasContent(message: ProviderHandoffBriefMessage): boolean {
  return (
    message.text.trim().length > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    (message.work?.length ?? 0) > 0
  );
}

/**
 * The slice of the transcript the incoming provider has not already seen.
 *
 * A provider that resumes its own native session still holds everything it
 * said and everything said to it up to the moment it was switched away from,
 * so replaying that would duplicate its context. The boundary is the later of
 * two marks: the last message authored by *any* instance in its continuation
 * group (instances that share a group can resume each other's sessions, so
 * they share a history too), and the last message the group is recorded as
 * having actually processed. The second mark is what covers a turn the group
 * received but never got to answer — an interrupt leaves the message in the
 * provider's native transcript with nothing of its own after it.
 *
 * A provider with no resumable state gets the whole list: it has seen nothing.
 */
export function selectHandoffMessages(input: {
  readonly messages: ReadonlyArray<ProviderHandoffBriefMessage>;
  /** Continuation key for each instance that authored a message in the thread. */
  readonly continuationKeyByInstanceId: ReadonlyMap<ProviderInstanceId, string>;
  /** The incoming provider's continuation key, when it has resumable state. */
  readonly resumedContinuationKey?: string | undefined;
  /**
   * Last message the resuming group is recorded as having processed. Written
   * only once a turn reached a terminal state that implies the provider
   * ingested its input, so trusting it cannot skip a message the provider
   * never saw.
   */
  readonly deliveredThroughMessageId?: MessageId | undefined;
}): ReadonlyArray<ProviderHandoffBriefMessage> {
  if (input.resumedContinuationKey === undefined) {
    return input.messages;
  }
  let lastSeenIndex = -1;
  for (let index = 0; index < input.messages.length; index += 1) {
    const message = input.messages[index];
    const instanceId = message?.providerInstanceId;
    if (
      instanceId !== undefined &&
      input.continuationKeyByInstanceId.get(instanceId) === input.resumedContinuationKey
    ) {
      lastSeenIndex = index;
      continue;
    }
    if (
      input.deliveredThroughMessageId !== undefined &&
      message?.id === input.deliveredThroughMessageId
    ) {
      lastSeenIndex = Math.max(lastSeenIndex, index);
    }
  }
  // No message of its own in the thread: the cursor may be stale or the
  // history predates attribution. Replaying is the safe direction — a provider
  // that sees a turn twice is recoverable, one that never sees it is not.
  if (lastSeenIndex < 0) {
    return input.messages;
  }
  return input.messages.slice(lastSeenIndex + 1);
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

/**
 * Files the conversation has touched, busiest first.
 *
 * The counts are churn across the thread's turns, not a net diff — each turn's
 * checkpoint records its own delta, so a file rewritten every turn accumulates.
 * Labelled as churn rather than presented as a net so the numbers say what they
 * are, and ordered by churn so the cap drops the incidental files rather than
 * whichever happened to be touched last.
 */
function renderChangedFilesSection(files: ReadonlyArray<ProviderHandoffBriefFileChange>): string {
  const ranked = files
    .filter((file) => file.additions > 0 || file.deletions > 0)
    .toSorted(
      (left, right) =>
        right.additions + right.deletions - (left.additions + left.deletions) ||
        left.path.localeCompare(right.path),
    );
  if (ranked.length === 0) {
    return "";
  }
  const shown = ranked.slice(0, MAX_CHANGED_FILES);
  const lines = shown.map((file) => {
    const turns = file.turns !== undefined && file.turns > 1 ? ` across ${file.turns} turns` : "";
    return `- ${file.path} (+${file.additions}/-${file.deletions}${turns})`;
  });
  if (ranked.length > shown.length) {
    lines.push(`- … and ${ranked.length - shown.length} more files`);
  }
  return `## Files this conversation has changed\n${lines.join("\n")}`;
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

function renderAttachmentsLine(attachments: ReadonlyArray<string>): string {
  return `Attached: ${attachments.join(", ")}`;
}

function renderWorkSection(work: ReadonlyArray<ProviderHandoffBriefWorkEntry>): string {
  const shown = work.slice(0, MAX_WORK_ENTRIES_PER_MESSAGE);
  const lines = shown.map((entry) => {
    const detail = entry.detail?.trim();
    const body = detail ? `${entry.label}: ${collapseWhitespace(detail)}` : entry.label;
    const clipped =
      body.length > WORK_ENTRY_CHAR_LIMIT
        ? `${body.slice(0, WORK_ENTRY_CHAR_LIMIT - 1).trimEnd()}…`
        : body;
    return `- ${clipped}${entry.failed === true ? " — failed" : ""}`;
  });
  if (work.length > shown.length) {
    lines.push(`- … and ${work.length - shown.length} more steps`);
  }
  return `Work log:\n${lines.join("\n")}`;
}

function renderNoticesBlock(notices: ReadonlyArray<string>): string {
  const shown = notices.slice(0, MAX_NOTICES_PER_MESSAGE);
  return shown
    .map((notice) => {
      const text = collapseWhitespace(notice);
      return `> ${text.length > NOTICE_CHAR_LIMIT ? `${text.slice(0, NOTICE_CHAR_LIMIT - 1).trimEnd()}…` : text}`;
    })
    .join("\n");
}

function renderMessageBlock(
  message: ProviderHandoffBriefMessage,
  bodyBudget: number,
): { readonly text: string; readonly truncated: boolean } {
  const parts: Array<string> = [];
  if (message.notices && message.notices.length > 0) {
    parts.push(renderNoticesBlock(message.notices));
  }
  parts.push(`### ${speakerLabel(message)}`);
  const trimmed = message.text.trim();
  const body =
    trimmed.length > 0 ? truncateBody(trimmed, bodyBudget) : { text: "", truncated: false };
  if (body.text.length > 0) {
    parts.push(body.text);
  }
  if (message.attachments && message.attachments.length > 0) {
    parts.push(renderAttachmentsLine(message.attachments));
  }
  if (message.work && message.work.length > 0) {
    parts.push(renderWorkSection(message.work));
  }
  return { text: parts.join("\n"), truncated: body.truncated };
}

function renderMessages(
  messages: ReadonlyArray<ProviderHandoffBriefMessage>,
  budgetPerMessage: number,
): { readonly text: string; readonly truncated: boolean } {
  let truncated = false;
  const blocks = messages.map((message) => {
    const block = renderMessageBlock(message, budgetPerMessage);
    truncated = truncated || block.truncated;
    return block.text;
  });
  return { text: blocks.join("\n\n"), truncated };
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** One line of prose for a message that did not earn a full block. */
function sliceForSummary(text: string, budget: number): string {
  const normalized = collapseWhitespace(text);
  if (normalized.length <= budget) {
    return normalized;
  }
  const raw = normalized.slice(0, Math.max(0, budget - 3));
  const space = raw.lastIndexOf(" ");
  return `${(space >= Math.floor(budget * 0.7) ? raw.slice(0, space) : raw).trimEnd()}...`;
}

function earlierSummaryLine(message: ProviderHandoffBriefMessage): string {
  const trimmed = message.text.trim();
  const body =
    trimmed.length > 0
      ? sliceForSummary(trimmed, EARLIER_MESSAGE_CHAR_LIMIT)
      : message.attachments && message.attachments.length > 0
        ? `(${renderAttachmentsLine(message.attachments)})`
        : "(no message text)";
  const steps =
    message.work && message.work.length > 0
      ? ` [${message.work.length} step${message.work.length === 1 ? "" : "s"}]`
      : "";
  return `- ${speakerLabel(message)}: ${body}${steps}`;
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

/**
 * The request the conversation exists to serve, kept verbatim.
 *
 * Compression works from the oldest message forward, so without pinning, the
 * first thing a long thread loses is the thing it was asked to do. Only
 * rendered when reconstructing a conversation cold: a provider resuming its own
 * session already holds the original ask.
 */
function renderPinnedRequest(
  message: ProviderHandoffBriefMessage | undefined,
  plan: ProviderHandoffBriefPlan | null | undefined,
  budget: number,
): string {
  const sections: Array<string> = [];
  if (message !== undefined && message.text.trim().length > 0) {
    const body = truncateBody(message.text.trim(), Math.min(budget, PINNED_MESSAGE_CHAR_LIMIT));
    sections.push(`## Original request\n${body.text}`);
  }
  if (plan && plan.markdown.trim().length > 0) {
    const remaining = budget - (sections[0]?.length ?? 0);
    if (remaining >= MIN_MESSAGE_BUDGET_CHARS) {
      const body = truncateBody(plan.markdown.trim(), Math.min(remaining, PLAN_CHAR_LIMIT));
      const heading = plan.implemented ? "## Plan (already implemented)" : "## Plan of record";
      sections.push(`${heading}\n${body.text}`);
    }
  }
  return sections.join("\n\n");
}

interface BriefSections {
  readonly header: string;
  readonly workspace: string;
  readonly changedFiles: string;
  readonly pinned: string;
  readonly earlier: string;
  readonly transcript: string;
}

function assemble(sections: BriefSections): string {
  return [
    sections.header,
    sections.workspace,
    sections.changedFiles,
    sections.pinned,
    sections.earlier,
    sections.transcript ? `## Transcript\n\n${sections.transcript}` : "",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

/** Cut a last-resort overflow at a line boundary rather than mid-token. */
function clampToBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const raw = text.slice(0, maxChars);
  const newline = raw.lastIndexOf("\n");
  return balanceFences(newline >= Math.floor(maxChars * 0.8) ? raw.slice(0, newline) : raw);
}

function toBrief(input: {
  readonly text: string;
  readonly maxChars: number;
  readonly compressed: boolean;
  readonly fullMessageCount: number;
  readonly summarizedMessageCount: number;
  readonly omittedMessageCount: number;
}): ProviderHandoffBrief {
  const text = clampToBudget(input.text, input.maxChars);
  return {
    text,
    chars: text.length,
    estimatedTokens: estimateHandoffTokens(text),
    compressed: input.compressed || text.length < input.text.length,
    messageCount: input.fullMessageCount + input.summarizedMessageCount,
    fullMessageCount: input.fullMessageCount,
    summarizedMessageCount: input.summarizedMessageCount,
    omittedMessageCount: input.omittedMessageCount,
  };
}

/**
 * Render the brief, fitting it into `maxChars`.
 *
 * The full-fidelity window grows to whatever the budget affords, down to a
 * floor of the last few turns; everything older collapses to one-line bullets
 * rather than disappearing, because a sketch of the earlier conversation is
 * more useful than a hole. Under harder pressure the renderer shortens recent
 * bodies (keeping their opening and their conclusion), then drops the oldest
 * bullets, then — only if even the recent turns will not fit — drops the oldest
 * of those. The original request is pinned out of that sequence entirely.
 */
export function renderProviderHandoffBrief(input: ProviderHandoffBriefInput): ProviderHandoffBrief {
  const header = renderHeader(input);
  const workspace = renderWorkspaceSection(input.workspace);
  const changedFiles = renderChangedFilesSection(input.changedFiles);
  const messages = input.messages.filter(handoffMessageHasContent);
  const anchor = input.mode === "briefed" ? messages.find((m) => m.role === "user") : undefined;
  // Background never crowds out the turns the provider has to act on.
  const pinnedBudget = Math.floor(input.maxChars / 4);

  const build = (options: {
    readonly fullCount: number;
    readonly earlierKept: ReadonlyArray<ProviderHandoffBriefMessage>;
    readonly omittedCount: number;
    readonly bodyBudget: number;
  }) => {
    const recent =
      options.fullCount === 0 ? [] : messages.slice(messages.length - options.fullCount);
    const pinning = anchor !== undefined && !recent.includes(anchor);
    const rendered = renderMessages(recent, options.bodyBudget);
    const sections: BriefSections = {
      header,
      workspace,
      changedFiles,
      pinned: pinning ? renderPinnedRequest(anchor, input.plan, pinnedBudget) : "",
      earlier: renderEarlierSummary(options.earlierKept, options.omittedCount),
      transcript: rendered.text,
    };
    return { text: assemble(sections), truncated: rendered.truncated, pinning };
  };

  /** Earlier messages that still need a bullet, given whether the anchor is pinned. */
  const bulletsFor = (fullCount: number, pinning: boolean) => {
    const earlier = messages.slice(0, messages.length - fullCount);
    return pinning ? earlier.filter((message) => message !== anchor) : earlier;
  };

  // Widest full-fidelity window that fits with nothing cut. Bounded above by
  // RECENT_MESSAGE_MAX_COUNT, so this is a couple of dozen probes at most.
  const maxWindow = Math.min(messages.length, RECENT_MESSAGE_MAX_COUNT);
  const minWindow = Math.min(messages.length, RECENT_MESSAGE_MIN_COUNT);
  for (let fullCount = maxWindow; fullCount >= minWindow; fullCount -= 1) {
    const recent = fullCount === 0 ? [] : messages.slice(messages.length - fullCount);
    const pinning = anchor !== undefined && !recent.includes(anchor);
    const bullets = bulletsFor(fullCount, pinning);
    const built = build({
      fullCount,
      earlierKept: bullets,
      omittedCount: 0,
      bodyBudget: Number.POSITIVE_INFINITY,
    });
    if (built.text.length <= input.maxChars) {
      return toBrief({
        text: built.text,
        maxChars: input.maxChars,
        compressed: false,
        fullMessageCount: fullCount + (built.pinning ? 1 : 0),
        summarizedMessageCount: bullets.length,
        omittedMessageCount: 0,
      });
    }
  }

  // Nothing fits untruncated. Hold the floor of recent turns at a useful size,
  // then spend whatever is left on earlier bullets, newest of those first.
  let recentCount = minWindow;
  let recentOmitted = 0;
  for (;;) {
    const recent = recentCount === 0 ? [] : messages.slice(messages.length - recentCount);
    const pinning = anchor !== undefined && !recent.includes(anchor);
    const bullets = bulletsFor(recentCount + recentOmitted, pinning);
    const omittedIfNothingFits = bullets.length + recentOmitted;
    // Everything but the message bodies, including the line that reports how
    // much was left out — that line is part of the cost of leaving it out.
    const scaffold = build({
      fullCount: recentCount,
      earlierKept: [],
      omittedCount: omittedIfNothingFits,
      bodyBudget: 0,
    }).text.length;
    const bodyBudget =
      recentCount === 0
        ? 0
        : Math.min(
            RECENT_MESSAGE_CHAR_LIMIT,
            Math.floor(Math.max(0, input.maxChars - scaffold) / recentCount),
          );
    if (recentCount > 0 && bodyBudget < MIN_MESSAGE_BUDGET_CHARS) {
      recentCount -= 1;
      recentOmitted += 1;
      continue;
    }

    // What the bullets may use is whatever the recent turns did not.
    const withoutBullets = build({
      fullCount: recentCount,
      earlierKept: [],
      omittedCount: omittedIfNothingFits,
      bodyBudget,
    });
    const packed = packEarlier(bullets, Math.max(0, input.maxChars - withoutBullets.text.length));
    const omitted = packed.omittedCount + recentOmitted;
    const built = build({
      fullCount: recentCount,
      earlierKept: packed.kept,
      omittedCount: omitted,
      bodyBudget,
    });
    return toBrief({
      text: built.text,
      maxChars: input.maxChars,
      compressed: true,
      fullMessageCount: recentCount + (built.pinning ? 1 : 0),
      summarizedMessageCount: packed.kept.length,
      omittedMessageCount: omitted,
    });
  }
}

/** Newest-first packing of the bullet list into whatever budget is left. */
function packEarlier(
  earlier: ReadonlyArray<ProviderHandoffBriefMessage>,
  budget: number,
): {
  readonly kept: ReadonlyArray<ProviderHandoffBriefMessage>;
  readonly omittedCount: number;
} {
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

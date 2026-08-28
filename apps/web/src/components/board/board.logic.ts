// The board's lane math. No React, no stores — the classifier and the drop
// matrix are the two things that must never disagree with the sidebar, so they
// live here where they can be tested against it directly.

import {
  effectiveSettled,
  effectiveSnoozed,
  type ChangeRequestSettleSource,
} from "@t3tools/client-runtime/state/thread-settled";
import { sortPinnedThreadsByOrderKey } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { SidebarAutoSettleMode } from "@t3tools/contracts/settings";

import {
  parseTimestampMs,
  resolveSidebarThreadStatus,
  sortSettledThreadsForSidebar,
  sortThreadsByBlockedDuration,
  sortThreadsForSidebar,
  threadNeedsYou,
} from "../Sidebar.logic";
import type { SidebarThreadSummary } from "../../types";

export type BoardLaneKey = "draft" | "upNext" | "working" | "needsYou" | "snoozed" | "done";

export const BOARD_LANE_KEYS = [
  "draft",
  "upNext",
  "working",
  "needsYou",
  "snoozed",
  "done",
] as const satisfies readonly BoardLaneKey[];

export interface BoardLaneDescriptor {
  readonly key: BoardLaneKey;
  readonly label: string;
  /**
   * Status token driving the lane's accent rule. Null lanes take the neutral
   * border — reserving colour for "act now" and "in motion" is the same rule
   * the sidebar's status markers follow.
   */
  readonly accentVar: string | null;
  /** One line naming what belongs here, shown when the lane is empty. */
  readonly emptyHint: string;
}

export const BOARD_LANES: readonly BoardLaneDescriptor[] = [
  {
    key: "draft",
    label: "Draft",
    accentVar: null,
    emptyHint: "Threads you started but never ran land here.",
  },
  {
    key: "upNext",
    label: "Up Next",
    accentVar: null,
    emptyHint: "Open work you haven't settled yet.",
  },
  {
    key: "working",
    label: "Working",
    accentVar: "--status-live",
    emptyHint: "Nothing is running right now.",
  },
  {
    key: "needsYou",
    label: "Needs You",
    accentVar: "--status-attention",
    emptyHint: "No thread is waiting on you.",
  },
  {
    key: "snoozed",
    label: "Snoozed",
    accentVar: "--status-snoozed",
    emptyHint: "Snoozed threads wait here until they wake.",
  },
  {
    key: "done",
    label: "Done",
    accentVar: "--status-done",
    emptyHint: "Settled threads collect here.",
  },
];

/**
 * Per-environment capabilities, mirroring the gate the sidebar partition
 * applies: a thread on a server that cannot settle or snooze must never be
 * classified into a lane whose only exit is a command that server rejects.
 */
export interface BoardEnvironmentCapabilities {
  readonly settlement: boolean;
  readonly snooze: boolean;
}

export const NO_BOARD_CAPABILITIES: BoardEnvironmentCapabilities = {
  settlement: false,
  snooze: false,
};

export interface BoardClassifyContext {
  /** Coarse "now" for the settle window; the caller quantizes it to the minute. */
  readonly now: string;
  /** Second-precise "now" for snooze wake times, which are not minute-aligned. */
  readonly preciseNow: string;
  readonly autoSettleAfterDays: number | null;
  readonly autoSettleMode: SidebarAutoSettleMode;
  readonly capabilitiesByEnvironmentId: ReadonlyMap<string, BoardEnvironmentCapabilities>;
  readonly changeRequestByThreadKey: ReadonlyMap<string, ChangeRequestSettleSource | null>;
}

export function boardCapabilitiesFor(
  context: Pick<BoardClassifyContext, "capabilitiesByEnvironmentId">,
  environmentId: EnvironmentId,
): BoardEnvironmentCapabilities {
  return context.capabilitiesByEnvironmentId.get(environmentId) ?? NO_BOARD_CAPABILITIES;
}

/**
 * Lane assignment, in the sidebar partition's precedence order (the `visible`
 * loop in Sidebar.tsx). Written as one ordered walk rather than re-derived per
 * lane, so a board lane can never claim a thread the sidebar files elsewhere.
 */
export function deriveBoardLane(
  thread: SidebarThreadSummary,
  context: BoardClassifyContext,
  threadKey: string,
): BoardLaneKey {
  const capabilities = boardCapabilitiesFor(context, thread.environmentId);

  // Snooze outranks everything, including a pin: "hide until Tuesday"
  // temporarily suspends "keep on top".
  if (capabilities.snooze && effectiveSnoozed(thread, { now: context.preciseNow })) {
    return "snoozed";
  }
  // Blocked on the user outranks the rest of the lifecycle — the same three
  // statuses the sidebar's needs-you queue collects (approval, input, failed).
  if (threadNeedsYou(thread)) {
    return "needsYou";
  }
  // resolveSidebarThreadStatus already folds a starting/running session and
  // post-turn background liveness into these two.
  const status = resolveSidebarThreadStatus(thread);
  if (status === "working" || status === "monitoring") {
    return "working";
  }
  // Settlement outranks the pin, same as the sidebar partition, which
  // classifies into the settled shelf before the pinned block. A pinned
  // thread that finished belongs in Done in both views, or the same thread
  // reads as two different states depending on which one you are looking at.
  if (
    capabilities.settlement &&
    effectiveSettled(thread, {
      now: context.now,
      autoSettleAfterDays: context.autoSettleAfterDays,
      autoSettleMode: context.autoSettleMode,
      changeRequest: context.changeRequestByThreadKey.get(threadKey) ?? null,
    })
  ) {
    return "done";
  }
  // Never ran a turn and never held a session: the thread exists, but no work
  // has been asked of it yet.
  if (thread.latestTurn === null && thread.session === null) {
    return "draft";
  }
  return "upNext";
}

export interface BoardCard {
  /** Drag identity and React key: the scoped thread key. */
  readonly cardId: string;
  readonly threadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly lane: BoardLaneKey;
  readonly thread: SidebarThreadSummary;
  /** A pin is a priority statement, orthogonal to lane — so it rides as a badge. */
  readonly isPinned: boolean;
}

export interface Board {
  readonly lanes: Readonly<Record<BoardLaneKey, readonly BoardCard[]>>;
  readonly counts: Readonly<Record<BoardLaneKey, number>>;
  readonly totalCount: number;
}

export interface BuildBoardInput {
  readonly threads: readonly SidebarThreadSummary[];
  readonly context: BoardClassifyContext;
  /** Scoped thread key for a thread; injected so the board shares the app's keying. */
  readonly threadKeyOf: (thread: SidebarThreadSummary) => string;
  /** Threads outside the current project scope are filtered before classification. */
  readonly includeThread?: (thread: SidebarThreadSummary) => boolean;
  /** Manual Draft-lane order — the one lane with no server-side ordering. */
  readonly draftOrder?: readonly string[] | undefined;
}

function emptyLanes(): Record<BoardLaneKey, BoardCard[]> {
  return { draft: [], upNext: [], working: [], needsYou: [], snoozed: [], done: [] };
}

/**
 * Reorders cards by running one of the sidebar's own thread sorts and mapping
 * the result back. Keyed on thread object identity — the sorts only reorder
 * references, never clone — so this reuses the sidebar's ordering rules
 * verbatim instead of restating them as card comparators that could drift.
 */
function applyThreadOrder(
  cards: readonly BoardCard[],
  sort: (threads: readonly SidebarThreadSummary[]) => SidebarThreadSummary[],
): BoardCard[] {
  const cardByThread = new Map<SidebarThreadSummary, BoardCard>(
    cards.map((card) => [card.thread, card]),
  );
  const ordered: BoardCard[] = [];
  for (const thread of sort(cards.map((card) => card.thread))) {
    const card = cardByThread.get(thread);
    if (card !== undefined) ordered.push(card);
  }
  return ordered;
}

/**
 * Pins float to the top of whichever lane they land in, ordered by the same
 * shared key math the sidebar's pinned block uses — so a pinned thread holds
 * the same relative position in both surfaces.
 */
function pinnedFirst(cards: readonly BoardCard[]): BoardCard[] {
  const pinned = cards.filter((card) => card.isPinned);
  if (pinned.length === 0) return [...cards];
  const rest = cards.filter((card) => !card.isPinned);
  return [...applyThreadOrder(pinned, sortPinnedThreadsByOrderKey), ...rest];
}

/** Snoozed rows order by when they come BACK — the return ticket is the story. */
function orderBySnoozeWake(cards: readonly BoardCard[]): BoardCard[] {
  return [...cards].toSorted(
    (left, right) =>
      parseTimestampMs(left.thread.snoozedUntil ?? "") -
        parseTimestampMs(right.thread.snoozedUntil ?? "") ||
      left.cardId.localeCompare(right.cardId),
  );
}

/**
 * Applies the persisted manual order to creation-sorted draft cards. Cards
 * named in the manual order keep that relative order and lead the lane; cards
 * created since the last drag keep their creation order behind them.
 */
export function orderDraftCards(
  cards: readonly BoardCard[],
  manualOrder: readonly string[] | undefined,
): BoardCard[] {
  const ordered = pinnedFirst(applyThreadOrder(cards, sortThreadsForSidebar));
  if (!manualOrder || manualOrder.length === 0) return ordered;
  const rankByCardId = new Map<string, number>();
  for (const [index, cardId] of manualOrder.entries()) {
    if (!rankByCardId.has(cardId)) rankByCardId.set(cardId, index);
  }
  return ordered.toSorted((left, right) => {
    const leftRank = rankByCardId.get(left.cardId);
    const rightRank = rankByCardId.get(right.cardId);
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return 0;
  });
}

export function buildBoard(input: BuildBoardInput): Board {
  const lanes = emptyLanes();

  for (const thread of input.threads) {
    // Archived threads are out of the lifecycle entirely — the sidebar files
    // them behind Settings → Archived, and so does the board.
    if (thread.archivedAt !== null) continue;
    if (input.includeThread && !input.includeThread(thread)) continue;

    const threadKey = input.threadKeyOf(thread);
    const lane = deriveBoardLane(thread, input.context, threadKey);
    lanes[lane].push({
      cardId: threadKey,
      threadId: thread.id,
      environmentId: thread.environmentId,
      lane,
      thread,
      isPinned: thread.pinnedAt != null,
    });
  }

  const ordered: Record<BoardLaneKey, readonly BoardCard[]> = {
    draft: orderDraftCards(lanes.draft, input.draftOrder),
    upNext: pinnedFirst(applyThreadOrder(lanes.upNext, sortThreadsForSidebar)),
    working: pinnedFirst(applyThreadOrder(lanes.working, sortThreadsForSidebar)),
    // The blocked queue is the one list that leads with the OLDEST: its
    // question is "what has been stuck longest", not "what broke last".
    needsYou: pinnedFirst(applyThreadOrder(lanes.needsYou, sortThreadsByBlockedDuration)),
    snoozed: orderBySnoozeWake(lanes.snoozed),
    done: pinnedFirst(applyThreadOrder(lanes.done, sortSettledThreadsForSidebar)),
  };

  const counts = Object.fromEntries(
    BOARD_LANE_KEYS.map((key) => [key, ordered[key].length]),
  ) as Record<BoardLaneKey, number>;

  return {
    lanes: ordered,
    counts,
    totalCount: BOARD_LANE_KEYS.reduce((total, key) => total + counts[key], 0),
  };
}

/** Reorders a lane's visible ids after a drag; null when nothing moved. */
export function reorderCardIds(
  visibleCardIds: readonly string[],
  activeCardId: string,
  overCardId: string,
): string[] | null {
  const fromIndex = visibleCardIds.indexOf(activeCardId);
  const toIndex = visibleCardIds.indexOf(overCardId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return null;
  const next = [...visibleCardIds];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return null;
  next.splice(toIndex, 0, moved);
  return next;
}

// ── The drop matrix ─────────────────────────────────────────────────
// What a drag MEANS. Every entry is either a command the server already
// accepts or an honest refusal: the board never offers an affordance it
// cannot honor, because a lane that silently swallows a drag is worse than
// one that visibly declines it.

export type BoardDropAction =
  /** Reorder within the Draft lane, the one lane with no server ordering. */
  | { readonly kind: "reorder" }
  | { readonly kind: "settle" }
  | { readonly kind: "unsettle" }
  /** Opens the preset menu at the drop point; the user picks the wake time. */
  | { readonly kind: "snooze" }
  | { readonly kind: "unsnooze" }
  /** Wake first, then the follow-up — a snoozed thread cannot settle asleep. */
  | { readonly kind: "unsnooze-then"; readonly next: "settle" | "open-thread" }
  /** Un-settle first, then open — dropping settled work back into play. */
  | { readonly kind: "unsettle-then-open" }
  /** The board is a control surface; sending a prompt belongs to the composer. */
  | { readonly kind: "open-thread" }
  | { readonly kind: "noop"; readonly reason: BoardDropRefusal };

export type BoardDropRefusal =
  /** Same lane, nothing to do. */
  | "same-lane"
  /** Nothing a user does can make an agent work, or make it blocked. */
  | "derived-lane"
  /** The thread's server has no settle/snooze capability. */
  | "unsupported"
  /**
   * The command's own guard rejects this thread right now — a pending
   * approval cannot be snoozed away, live work cannot be settled. Refusing
   * up front beats opening a wake-time menu that fails on submit.
   */
  | "blocked";

/**
 * The per-thread half of a drop decision: `canSettle` / `canSnooze` from
 * client-runtime, evaluated by the caller against the live shell. Capability
 * says the SERVER supports the verb; these say THIS THREAD accepts it now.
 */
export interface BoardDropPermits {
  readonly canSettle: boolean;
  readonly canSnooze: boolean;
}

export const ALL_BOARD_DROPS_PERMITTED: BoardDropPermits = { canSettle: true, canSnooze: true };

export function resolveBoardDrop(input: {
  readonly from: BoardLaneKey;
  readonly to: BoardLaneKey;
  readonly capabilities: BoardEnvironmentCapabilities;
  /** Defaults to permitted so lane-only callers (tests, hover hints) stay terse. */
  readonly permits?: BoardDropPermits;
}): BoardDropAction {
  const { from, to, capabilities } = input;
  const permits = input.permits ?? ALL_BOARD_DROPS_PERMITTED;

  if (from === to) {
    return from === "draft" ? { kind: "reorder" } : { kind: "noop", reason: "same-lane" };
  }

  // Needs You is purely derived: a thread is blocked because an agent asked a
  // question, not because a card was dragged.
  if (to === "needsYou") {
    return { kind: "noop", reason: "derived-lane" };
  }

  if (to === "snoozed") {
    if (!capabilities.snooze) return { kind: "noop", reason: "unsupported" };
    return permits.canSnooze ? { kind: "snooze" } : { kind: "noop", reason: "blocked" };
  }

  if (to === "done") {
    if (!capabilities.settlement) return { kind: "noop", reason: "unsupported" };
    // A snoozed thread wakes first, and waking can itself unblock settlement,
    // so the guard is checked on the wake path rather than here.
    if (!permits.canSettle && from !== "snoozed") return { kind: "noop", reason: "blocked" };
    if (from === "snoozed") {
      return capabilities.snooze
        ? { kind: "unsnooze-then", next: "settle" }
        : { kind: "noop", reason: "unsupported" };
    }
    return { kind: "settle" };
  }

  // Working is derived too, but dropping there has one obvious intent — "run
  // this" — so it routes to the composer rather than refusing outright.
  if (to === "working") {
    if (from === "snoozed") {
      return capabilities.snooze
        ? { kind: "unsnooze-then", next: "open-thread" }
        : { kind: "noop", reason: "unsupported" };
    }
    if (from === "done") {
      return capabilities.settlement
        ? { kind: "unsettle-then-open" }
        : { kind: "noop", reason: "unsupported" };
    }
    return { kind: "open-thread" };
  }

  // to === "draft" | "upNext": the resting lanes. Reaching them means undoing
  // whatever put the card where it was.
  if (from === "snoozed") {
    return capabilities.snooze ? { kind: "unsnooze" } : { kind: "noop", reason: "unsupported" };
  }
  if (from === "done") {
    return capabilities.settlement ? { kind: "unsettle" } : { kind: "noop", reason: "unsupported" };
  }
  // Draft/Up Next/Working/Needs You into a resting lane: that membership is
  // derived from work, so no command would move it.
  return { kind: "noop", reason: "derived-lane" };
}

/** The verb shown on a lane while a drag hovers it. */
export function boardDropLabel(action: BoardDropAction): string | null {
  switch (action.kind) {
    case "reorder":
      return "Reorder";
    case "settle":
      return "Settle";
    case "unsettle":
      return "Un-settle";
    case "snooze":
      return "Snooze until…";
    case "unsnooze":
      return "Wake";
    case "unsnooze-then":
      return action.next === "settle" ? "Wake and settle" : "Wake and open";
    case "unsettle-then-open":
      return "Un-settle and open";
    case "open-thread":
      return "Open the chat";
    case "noop":
      return null;
  }
}

/** Why a lane is refusing the current drag, for the muted hover hint. */
export function boardDropRefusalHint(reason: BoardDropRefusal): string | null {
  switch (reason) {
    case "same-lane":
      return null;
    case "derived-lane":
      return "Follows the agent";
    case "unsupported":
      return "Not supported here";
    case "blocked":
      return "Waiting on you first";
  }
}

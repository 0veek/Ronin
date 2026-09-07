import * as React from "react";
import { defaultAnimateLayoutChanges, type AnimateLayoutChanges } from "@dnd-kit/sortable";
import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ContextMenuItem } from "@t3tools/contracts";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import type { AsyncResult } from "effect/unstable/reactivity";
import { planPinnedReorder } from "@t3tools/client-runtime/state/thread-sort";
import {
  getThreadSortTimestamp,
  resolveSettledThreadTimestamp,
  sortThreads,
  toSortableTimestamp,
  type SettledThreadTimestampInput,
  type ThreadSortInput,
} from "../lib/threadSort";
import type { SidebarThreadSummary, Thread } from "../types";
import type { ThreadRouteTarget } from "../threadRoutes";
import { cn } from "../lib/utils";
import { isLatestTurnSettled } from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 200;
// Visible sidebar rows are prewarmed into the thread-detail cache so opening a
// nearby thread usually reuses an already-hot subscription. Each prewarmed
// thread holds a live, fully hydrated detail subscription (all messages and
// activities, growing as agents work) for as long as the row stays visible,
// so this limit is a direct renderer-heap and server-load multiplier — keep
// it small; cold opens still render instantly from the cached snapshot.
export const SIDEBAR_THREAD_PREWARM_LIMIT = 3;
// A small buffer keeps the next few rows warm without leasing every row that
// content-visibility leaves mounted below the scroll viewport.
export const SIDEBAR_ROW_SUBSCRIPTION_OVERSCAN_PX = 160;

export function useSidebarRowSubscriptionLease(isActive: boolean): {
  readonly leaseLiveStatus: boolean;
  readonly rowRef: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
} {
  const [row, setRow] = React.useState<HTMLElement | null>(null);
  const [isNearViewport, setIsNearViewport] = React.useState(isActive);

  React.useEffect(() => {
    if (isActive) {
      setIsNearViewport(true);
      return;
    }
    if (row === null) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const scrollRoot = row.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const observer = new IntersectionObserver(
      ([entry]) => setIsNearViewport(entry?.isIntersecting === true),
      {
        root: scrollRoot,
        rootMargin: `${SIDEBAR_ROW_SUBSCRIPTION_OVERSCAN_PX}px 0px`,
      },
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, [isActive, row]);

  return {
    leaseLiveStatus: isActive || isNearViewport,
    rowRef: setRow,
  };
}

// A row keeps the last live value it rendered so a released lease never
// blanks its badge. The value is bound to `key`, so a different worktree or
// linked pull request cannot reuse the previous one.
export function useRetainedValue<T>(key: string | null, value: T | null): T | null {
  const retained = React.useRef<{ readonly key: string; readonly value: T } | null>(null);
  if (key !== null && value !== null) {
    retained.current = { key, value };
  }
  if (value !== null) return value;
  return key !== null && retained.current?.key === key ? retained.current.value : null;
}

// Sidebar.motion handles ordinary section changes. Sortable transforms own
// dragging; replaying their committed DOM order would animate the drop twice.
export const animateSidebarLayoutChanges: AnimateLayoutChanges = (args) =>
  args.isSorting ? defaultAnimateLayoutChanges(args) : false;

// Rows and section markers share one sortable list. The separators resolve
// the lifecycle action; Sidebar.drag previews the resulting layout. Pinned
// and active threads keep the dragged position; settled threads use time
// order. Snoozed and Needs you rows can leave their shelves, but dropping
// into either is not supported: snoozing requires a wake time, and Needs you
// is an urgency queue, not a destination.

export type SidebarSection = "needs-you" | "pinned" | "active" | "snoozed" | "settled";

/** Sortable ids: thread rows use their scoped key; structural items use a
    colon-free prefix: scoped thread keys always contain a colon. */
const SIDEBAR_MARKER_PREFIX = "sidebar-marker-";

export type SidebarListMarker =
  /** Ronin-only urgency shelf. Not a drop destination. */
  | "needs-you-header"
  /** The top boundary is also a landing target when there are no pins. */
  | "pinned-header"
  /** Stand-in rows so an empty section has somewhere for the gap to open. */
  | "active-placeholder"
  | "settled-placeholder"
  /** The boundary between pinned and active rows. */
  | "pinned-divider"
  | "snoozed-header"
  | "settled-header";

export function sidebarMarkerId(marker: SidebarListMarker): string {
  return `${SIDEBAR_MARKER_PREFIX}${marker}`;
}

export type SidebarListItem =
  | { readonly kind: "thread"; readonly key: string; readonly section: SidebarSection }
  | { readonly kind: "marker"; readonly marker: SidebarListMarker };

export function sidebarListItemId(item: SidebarListItem): string {
  return item.kind === "thread" ? item.key : sidebarMarkerId(item.marker);
}

/** The section a slot belongs to, read off the markers around it. Needs you
    leads when present; then pinned until the pinned divider, inbox until
    snoozed, shelf until settled, then settled. */
function sectionAtSidebarSlot(items: readonly SidebarListItem[], index: number): SidebarSection {
  let section: SidebarSection = "pinned";
  for (let i = 0; i < index && i < items.length; i += 1) {
    const item = items[i]!;
    if (item.kind !== "marker") continue;
    if (item.marker === "needs-you-header") section = "needs-you";
    else if (item.marker === "pinned-header") section = "pinned";
    else if (item.marker === "pinned-divider") section = "active";
    else if (item.marker === "snoozed-header") section = "snoozed";
    else if (item.marker === "settled-header") section = "settled";
  }
  return section;
}

/** Resolve the destination section and manual order from an arrayMove across
 * the separators. The snoozed shelf and Needs you are never destinations. */
export type SidebarDropTarget = {
  readonly section: "pinned" | "active" | "settled";
  readonly pinnedOrder: readonly string[];
  readonly activeOrder: readonly string[];
};

export function resolveSidebarDropTarget(
  items: readonly SidebarListItem[],
  activeKey: string,
  overId: string,
): SidebarDropTarget | null {
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === activeKey);
  const overIndex = items.findIndex((item) => sidebarListItemId(item) === overId);
  if (activeIndex === -1 || overIndex === -1 || items[activeIndex]?.kind !== "thread") return null;
  const moved = items.filter((_, index) => index !== activeIndex);
  moved.splice(overIndex, 0, items[activeIndex]!);
  const section = sectionAtSidebarSlot(moved, overIndex);
  if (section === "snoozed" || section === "needs-you") return null;
  const pinnedOrder: string[] = [];
  const activeOrder: string[] = [];
  let currentSection: SidebarSection = "pinned";
  for (const item of moved) {
    if (item.kind === "marker") {
      if (item.marker === "pinned-header") currentSection = "pinned";
      else if (item.marker === "pinned-divider") currentSection = "active";
      else if (item.marker === "snoozed-header" || item.marker === "settled-header") break;
      continue;
    }
    if (item.section === "needs-you" && item.key !== activeKey) continue;
    if (currentSection === "pinned") pinnedOrder.push(item.key);
    else activeOrder.push(item.key);
  }
  return { section, pinnedOrder, activeOrder };
}

export type SidebarThreadDropPlan =
  | { readonly kind: "none" }
  /** Within the pinned block: the existing key writes. */
  | {
      readonly kind: "reorder-pinned";
      readonly order: readonly string[];
      readonly assignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>;
    }
  /** From another section into the pinned block. Fresh pins take `orderKey`
      on the pin command. `extraAssignments` land afterward, including the
      moved row when it was already pinned beneath a snooze. */
  | {
      readonly kind: "pin";
      readonly order: readonly string[];
      readonly orderKey: string | undefined;
      readonly extraAssignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>;
    }
  | {
      readonly kind: "move-active";
      readonly order: readonly string[];
      readonly assignments: ReadonlyArray<{ readonly id: string; readonly orderKey: string }>;
      readonly unpin: boolean;
      readonly unsettle: boolean;
      readonly unsnooze: boolean;
    }
  | { readonly kind: "settle" };

/** What dropping in `to` does to a thread lifted from `from`, for the badge
    on the lifted row. Null while reordering inside one section and for the
    snoozed / Needs you shelves, which cannot be drop targets. */
export type SidebarDropVerb = "pin" | "unpin" | "settle" | "unsettle" | "wake";

export function resolveSidebarDropVerb(
  from: SidebarSection,
  to: SidebarSection | null,
): SidebarDropVerb | null {
  if (to === null || to === from || to === "snoozed" || to === "needs-you") return null;
  if (from === "needs-you" && to === "active") return null;
  if (to === "pinned") return "pin";
  if (to === "settled") return "settle";
  if (from === "pinned") return "unpin";
  if (from === "settled") return "unsettle";
  return "wake";
}

export function planSidebarThreadDrop(input: {
  readonly activeKey: string;
  readonly activeSection: SidebarSection;
  /** Snoozed threads can retain pinning and settlement beneath the shelf. */
  readonly activePinned?: boolean;
  readonly activeSettled?: boolean;
  readonly supportsSettlement?: boolean;
  readonly target: SidebarDropTarget;
  /** All pinned keys in displayed order before the drop. */
  readonly pinnedOrder: readonly string[];
  readonly pinnedKeysById: ReadonlyMap<string, string | null | undefined>;
  readonly reorderableKeys?: ReadonlySet<string>;
  readonly activeOrder: readonly string[];
  readonly activeKeysById: ReadonlyMap<string, string | null | undefined>;
  readonly activeReorderableKeys?: ReadonlySet<string>;
}): SidebarThreadDropPlan {
  const {
    activeKey,
    activeSection,
    activePinned = activeSection === "pinned",
    activeSettled = activeSection === "settled",
    target,
    pinnedOrder,
    pinnedKeysById,
    reorderableKeys,
    activeOrder,
    activeKeysById,
    activeReorderableKeys,
  } = input;
  if (input.supportsSettlement === false && (target.section === "settled" || activeSettled)) {
    return { kind: "none" };
  }
  switch (target.section) {
    case "active": {
      const order = target.activeOrder;
      if (
        (activeSection === "active" || activeSection === "needs-you") &&
        order.length === activeOrder.length &&
        order.every((key, index) => key === activeOrder[index])
      ) {
        return { kind: "none" };
      }
      const assignments = planPinnedReorder({
        orderedIds: order,
        keysById: activeKeysById,
        movedId: activeKey,
      });
      if (activeReorderableKeys && assignments.some(({ id }) => !activeReorderableKeys.has(id))) {
        return { kind: "none" };
      }
      return {
        kind: "move-active",
        order,
        assignments,
        unpin: activePinned,
        unsettle: activeSettled,
        unsnooze: activeSection === "snoozed",
      };
    }
    case "settled":
      return activeSection === "settled" ? { kind: "none" } : { kind: "settle" };
    case "pinned": {
      const order = target.pinnedOrder;
      // Dropped back where it started: nothing to write.
      if (
        activeSection === "pinned" &&
        order.length === pinnedOrder.length &&
        order.every((key, index) => key === pinnedOrder[index])
      ) {
        return { kind: "none" };
      }
      const assignments = planPinnedReorder({
        orderedIds: order,
        keysById: pinnedKeysById,
        movedId: activeKey,
      });
      if (reorderableKeys && assignments.some(({ id }) => !reorderableKeys.has(id))) {
        return { kind: "none" };
      }
      if (activeSection === "pinned") {
        return assignments.length === 0
          ? { kind: "none" }
          : { kind: "reorder-pinned", order, assignments };
      }
      return {
        kind: "pin",
        order,
        orderKey: assignments.find((assignment) => assignment.id === activeKey)?.orderKey,
        extraAssignments: activePinned
          ? assignments
          : assignments.filter((assignment) => assignment.id !== activeKey),
      };
    }
  }
}

/** Project a drop's lifecycle fields before sorting its destination. Reusing
    the server's re-entry rules keeps the preview in place when events arrive. */
export function applySidebarThreadDrop<
  T extends Pick<
    SidebarThreadSummary,
    | "pinnedAt"
    | "pinOrderKey"
    | "activeOrderKey"
    | "snoozedAt"
    | "snoozedUntil"
    | "settledAt"
    | "settledOverride"
    | "unsettledAt"
  >,
>(thread: T, section: "pinned" | "active" | "settled", now: string, orderKey?: string): T {
  const wasSettled = thread.settledOverride === "settled";
  const awake = { ...thread, snoozedAt: null, snoozedUntil: null };
  if (section === "settled") {
    return {
      ...awake,
      pinnedAt: null,
      pinOrderKey: null,
      activeOrderKey: null,
      settledOverride: "settled",
      settledAt: wasSettled ? (thread.settledAt ?? now) : now,
      unsettledAt: null,
    };
  }
  const resumed = wasSettled
    ? { ...awake, settledOverride: "active" as const, settledAt: null, unsettledAt: now }
    : awake;
  return {
    ...resumed,
    pinnedAt: section === "pinned" ? (thread.pinnedAt ?? now) : null,
    pinOrderKey: section === "pinned" ? (orderKey ?? thread.pinOrderKey) : null,
    ...(section === "active" && orderKey !== undefined ? { activeOrderKey: orderKey } : {}),
  };
}

type SidebarProject = {
  id: string;
  title: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

type ScopedSidebarProject = SidebarProject & {
  environmentId: string;
};

type ScopedSidebarThread = ThreadSortInput & {
  environmentId: string;
  projectId: string;
  archivedAt: string | null;
};

type LogicalSidebarProject = SidebarProject & {
  projectKey: string;
  memberProjectRefs: readonly {
    environmentId: string;
    projectId: string;
  }[];
};

export type ThreadTraversalDirection = "previous" | "next";

/**
 * Shared-worktree checks must exclude only successful deletions, never the
 * whole batch. A null result skips an entry that the caller can no longer find.
 */
export async function deleteSelectedThreadEntries<
  TEntry extends { readonly threadKey: string },
>(input: {
  entries: readonly TEntry[];
  delete: (
    entry: TEntry,
    deletedThreadKeys: ReadonlySet<string>,
  ) => Promise<AtomCommandResult<unknown, unknown> | null>;
}) {
  const deletedThreadKeys = new Set<string>();
  let firstFailure: AsyncResult.Failure<unknown, unknown> | null = null;

  for (const entry of input.entries) {
    const result = await input.delete(entry, deletedThreadKeys);
    if (result === null) continue;
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) break;
      firstFailure ??= result;
      continue;
    }
    deletedThreadKeys.add(entry.threadKey);
  }

  return { deletedThreadKeys, firstFailure };
}

export async function archiveSelectedThreadEntries<
  TEntry extends { readonly threadKey: string },
  TResult extends { readonly _tag: "Success" | "Failure" },
>(input: {
  entries: readonly TEntry[];
  archive: (entry: TEntry, onArchived: () => void) => Promise<TResult>;
}): Promise<{
  archivedThreadKeys: readonly string[];
  mutationFailure: Extract<TResult, { readonly _tag: "Failure" }> | null;
  followupFailures: readonly Extract<TResult, { readonly _tag: "Failure" }>[];
}> {
  const archivedThreadKeys: string[] = [];
  const followupFailures: Extract<TResult, { readonly _tag: "Failure" }>[] = [];

  for (const entry of input.entries) {
    let didArchive = false;
    const result = await input.archive(entry, () => {
      didArchive = true;
    });
    if (didArchive || result._tag === "Success") {
      archivedThreadKeys.push(entry.threadKey);
    }
    if (result._tag === "Success") continue;
    const failure = result as Extract<TResult, { readonly _tag: "Failure" }>;
    if (didArchive) {
      followupFailures.push(failure);
      continue;
    }
    return { archivedThreadKeys, mutationFailure: failure, followupFailures };
  }

  return { archivedThreadKeys, mutationFailure: null, followupFailures };
}

export function buildMultiSelectThreadContextMenuItems(input: {
  count: number;
  hasRunningThread: boolean;
}): readonly ContextMenuItem<"mark-unread" | "archive" | "delete">[] {
  return [
    { id: "mark-unread", label: `Mark unread (${input.count})` },
    {
      id: "archive",
      label: `Archive (${input.count})`,
      disabled: input.hasRunningThread,
    },
    { id: "delete", label: `Delete (${input.count})`, destructive: true },
  ];
}

export function buildBulkTitleRegenerationContextMenuItem(input: {
  supportedCount: number;
  actionableCount: number;
}): ContextMenuItem<"regenerate-title"> | null {
  if (input.supportedCount === 0) return null;
  if (input.actionableCount === 0) {
    return {
      id: "regenerate-title",
      label: `Regenerating… (${input.supportedCount})`,
      disabled: true,
    };
  }
  return {
    id: "regenerate-title",
    label: `Regenerate titles (${input.actionableCount})`,
  };
}

/**
 * Bulk unpin follows the same "count only what the action will touch" rule
 * as title regeneration: on a mixed selection the label counts the pinned
 * rows alone, and the item disappears when nothing selected is pinned.
 */
export function buildBulkUnpinContextMenuItem(input: {
  pinnedCount: number;
}): ContextMenuItem<"unpin"> | null {
  if (input.pinnedCount === 0) return null;
  return { id: "unpin", label: `Unpin (${input.pinnedCount})` };
}

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Monitoring"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

// Rollup order mirrors the per-thread resolver exactly: attention states,
// then active work, then the actionable plan prompt, then passive
// monitoring. A Monitoring sibling must never hide a Plan Ready thread.
const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 6,
  "Awaiting Input": 5,
  Working: 4,
  Connecting: 4,
  "Plan Ready": 3,
  Monitoring: 2,
  Completed: 1,
};

type ThreadStatusInput = Pick<
  SidebarThreadSummary,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "interactionMode"
  | "latestTurn"
  | "session"
  | "backgroundLiveness"
> & {
  lastVisitedAt?: string | undefined;
};

export interface ThreadJumpHintVisibilityController {
  sync: (shouldShow: boolean) => void;
  dispose: () => void;
}

export function createThreadJumpHintVisibilityController(input: {
  delayMs: number;
  onVisibilityChange: (visible: boolean) => void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}): ThreadJumpHintVisibilityController {
  const setTimeoutFn = input.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? globalThis.clearTimeout;
  let isVisible = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const clearPendingShow = () => {
    if (timeoutId === null) {
      return;
    }
    clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        clearPendingShow();
        if (isVisible) {
          isVisible = false;
          input.onVisibilityChange(false);
        }
        return;
      }

      if (isVisible || timeoutId !== null) {
        return;
      }

      timeoutId = setTimeoutFn(() => {
        timeoutId = null;
        isVisible = true;
        input.onVisibilityChange(true);
      }, input.delayMs);
    },
    dispose: () => {
      clearPendingShow();
    },
  };
}

export function useThreadJumpHintVisibility(): {
  showThreadJumpHints: boolean;
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void;
} {
  const [showThreadJumpHints, setShowThreadJumpHints] = React.useState(false);
  const controllerRef = React.useRef<ThreadJumpHintVisibilityController | null>(null);

  React.useEffect(() => {
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        setShowThreadJumpHints(visible);
      },
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateThreadJumpHintsVisibility = React.useCallback((shouldShow: boolean) => {
    controllerRef.current?.sync(shouldShow);
  }, []);

  return {
    showThreadJumpHints,
    updateThreadJumpHintsVisibility,
  };
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return false;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

// A double-click dispatches two `click` events before `dblclick`: the first has
// `detail === 1`, the second `detail === 2`. The second click must not run the
// row's single-click navigation, otherwise double-click-to-rename would also
// navigate. `MouseEvent.detail` is 0 for synthetic/keyboard activations, which
// still count as a normal single activation.
export function isTrailingDoubleClick(detail: number): boolean {
  return detail > 1;
}

function nodeClosest(node: object | null, selector: string): unknown {
  if (node === null || !("closest" in node) || typeof node.closest !== "function") return null;
  return node.closest(selector);
}

/** Clicks on a nested link keep the link's meaning. The row must not treat them as multi-select. */
export function isSidebarNestedLinkClick(target: EventTarget | null): boolean {
  if (target == null || typeof target !== "object") return false;
  if (nodeClosest(target, "a[href]") !== null) return true;
  const parent =
    "parentElement" in target &&
    target.parentElement !== null &&
    typeof target.parentElement === "object"
      ? target.parentElement
      : null;
  return nodeClosest(parent, "a[href]") !== null;
}

// Shift+click on the new thread button creates directly in the current
// project, skipping the command palette's project picker. With a single
// project there is nothing to pick, so a plain click already creates
// immediately and the modifier changes nothing.
export function shouldCreateNewThreadInCurrentProject(
  shiftKey: boolean,
  projectGroupCount: number,
): boolean {
  return shiftKey || projectGroupCount <= 1;
}

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
  getPreferenceIds?: (item: TItem) => readonly TId[];
}): TItem[] {
  const { getId, getPreferenceIds, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const indexesByPreferenceId = new Map<TId, number[]>();
  for (const [index, item] of items.entries()) {
    const preferenceIds = getPreferenceIds?.(item) ?? [getId(item)];
    for (const preferenceId of new Set(preferenceIds)) {
      const indexes = indexesByPreferenceId.get(preferenceId);
      if (indexes) {
        indexes.push(index);
      } else {
        indexesByPreferenceId.set(preferenceId, [index]);
      }
    }
  }

  const emittedIndexes = new Set<number>();
  const ordered = preferredIds.flatMap((id) => {
    const index = indexesByPreferenceId
      .get(id)
      ?.find((candidate) => !emittedIndexes.has(candidate));
    if (index === undefined) {
      return [];
    }
    emittedIndexes.add(index);
    return [items[index]!];
  });
  const remaining = items.filter((_, index) => !emittedIndexes.has(index));
  return [...ordered, ...remaining];
}

export function getVisibleSidebarThreadIds<TThreadId>(
  renderedProjects: readonly {
    shouldShowThreadPanel?: boolean;
    renderedThreadIds: readonly TThreadId[];
  }[],
): TThreadId[] {
  return renderedProjects.flatMap((renderedProject) =>
    renderedProject.shouldShowThreadPanel === false ? [] : renderedProject.renderedThreadIds,
  );
}

export function getSidebarThreadIdsToPrewarm<TThreadId>(
  visibleThreadIds: readonly TThreadId[],
  limit = SIDEBAR_THREAD_PREWARM_LIMIT,
): TThreadId[] {
  return visibleThreadIds.slice(0, Math.max(0, limit));
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function shouldNavigateAfterProjectRemoval(input: {
  routeTarget: ThreadRouteTarget | null;
  projectThreads: readonly {
    environmentId: string;
    id: string;
  }[];
  projectDraftId: string | null;
}): boolean {
  const { projectDraftId, projectThreads, routeTarget } = input;
  if (routeTarget?.kind === "draft") {
    return projectDraftId === routeTarget.draftId;
  }
  if (routeTarget?.kind !== "server") {
    return false;
  }
  return projectThreads.some(
    (thread) =>
      thread.environmentId === routeTarget.threadRef.environmentId &&
      thread.id === routeTarget.threadRef.threadId,
  );
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-8 w-full translate-x-0 cursor-pointer justify-start rounded-md px-2 text-left text-sm select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-sidebar-row-active text-sidebar-foreground font-medium hover:bg-sidebar-row-active hover:text-sidebar-foreground",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-sidebar-row-selected text-sidebar-foreground hover:bg-sidebar-row-active hover:text-sidebar-foreground",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-sidebar-row-active text-sidebar-foreground font-medium hover:bg-sidebar-row-active hover:text-sidebar-foreground",
    );
  }

  return cn(
    baseClassName,
    "text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
  );
}

// ── Sidebar thread status model ─────────────────────────────────────
// Five visual states, three colors: color is reserved for "act now"
// (approval), "in motion" (working), and "broken" (failed). Ready is the
// unlabeled resting state — the agent stopped and is waiting on the user,
// whether it finished, asked a question, or proposed a plan.
// Unread completion is tracked separately: it describes whether a ready
// thread needs attention, not what the thread is currently doing.
export type SidebarThreadStatus =
  | "approval"
  | "input"
  | "working"
  | "monitoring"
  | "failed"
  | "ready";

export type SidebarThreadStatusInput = Pick<
  SidebarThreadSummary,
  "hasPendingApprovals" | "hasPendingUserInput" | "session" | "backgroundLiveness"
>;

export function resolveSidebarThreadStatus(thread: SidebarThreadStatusInput): SidebarThreadStatus {
  if (thread.hasPendingApprovals) {
    return "approval";
  }
  if (thread.hasPendingUserInput) {
    return "input";
  }
  if (thread.session?.status === "running" || thread.session?.status === "starting") {
    return "working";
  }
  // A failed session outranks lingering background liveness: the user must
  // see the failure, not a stale Working (review finding).
  if (thread.session?.status === "error") {
    return "failed";
  }
  // Background work outlives the turn: fleets read as working; monitoring
  // only when watch loops are the sole live work.
  if (thread.backgroundLiveness === "working") {
    return "working";
  }
  if (thread.backgroundLiveness === "monitoring") {
    return "monitoring";
  }
  return "ready";
}

// ── The needs-you queue ─────────────────────────────────────────────
// Threads the agent has stopped on and cannot continue without the user.
//
// Deliberately the same three statuses the row's own marker already shows,
// rather than a second opinion computed from the shell's raw flags: a queue
// that disagreed with the markers beside it would be worse than no queue. Add
// a status here only by adding it to resolveSidebarThreadStatus first.
//
// "monitoring" and "working" are the agent's problem, not the user's, and
// "ready" is the resting state — a finished turn is news (the notifier says
// so) but it is not *blocking* anyone.
const NEEDS_YOU_STATUSES: ReadonlySet<SidebarThreadStatus> = new Set([
  "approval",
  "input",
  "failed",
]);

export function threadNeedsYou(thread: SidebarThreadStatusInput): boolean {
  return NEEDS_YOU_STATUSES.has(resolveSidebarThreadStatus(thread));
}

/**
 * Longest-blocked first.
 *
 * The queue's question is "what has been stuck the longest", not "what broke
 * most recently", so this is the one list in the sidebar that sorts oldest
 * first — everything else leads with the newest.
 *
 * `updatedAt` stands in for the blocked-at instant the shell does not carry.
 * That substitution is sound precisely because these threads are blocked: a
 * thread waiting on a human is not changing, so its last update *is* the
 * moment it started waiting.
 */
export function sortThreadsByBlockedDuration<T extends { updatedAt: string }>(
  threads: readonly T[],
): T[] {
  return threads.toSorted(
    (left, right) => parseTimestampMs(left.updatedAt) - parseTimestampMs(right.updatedAt),
  );
}

/** NaN-safe Date.parse for sort comparators: a malformed timestamp must not
    poison the whole ordering, so it sinks to the epoch instead. */
export function parseTimestampMs(isoDate: string): number {
  const parsed = Date.parse(isoDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** First VALID timestamp wins: `a ?? b` falls through on null, but a present-
    yet-malformed string must also fall through to the next candidate rather
    than sink the row to the epoch. */
export function firstValidTimestampMs(
  ...candidates: ReadonlyArray<string | null | undefined>
): number {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/** String twin of firstValidTimestampMs for callers that need the ISO string
    (display labels, tick anchors) rather than epoch ms. */
export function firstValidTimestamp(
  ...candidates: ReadonlyArray<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    if (!Number.isNaN(Date.parse(candidate))) return candidate;
  }
  return null;
}

export { sortActiveThreadsByOrderKey as sortThreadsForSidebar } from "@t3tools/client-runtime/state/thread-sort";

/**
 * Move each side chat directly under the thread it was opened from.
 *
 * A side chat sorted by its own timestamp lands wherever it happens to fall,
 * which reads as an unrelated thread with a confusing title. Filing it under
 * its parent is the whole reason the link is persisted.
 *
 * A side chat whose parent is not in this list keeps its own position and its
 * own indent level: the parent may be settled, snoozed, archived, or in
 * another project, and hiding the child because its parent moved on would
 * lose it entirely.
 *
 * Only one level deep. A side chat of a side chat files under the one it came
 * from, not under the root — nesting further buys nothing and costs the row
 * its readable width.
 */
/**
 * Pull teammate threads immediately under their orchestrator.
 *
 * A run's threads are ordinary threads; this is only a reading order so a
 * team does not scatter across the project's inbox.
 */
export function groupBuildSystemThreadsUnderOrchestrator<T extends { readonly id: string }>(
  threads: readonly T[],
  runs: ReadonlyArray<{
    readonly orchestratorThreadId: string | null;
    readonly roleThreads: ReadonlyArray<{ readonly threadId: string }>;
    readonly status: string;
  }>,
): T[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const childIds = new Set<string>();
  const childrenByParent = new Map<string, T[]>();
  for (const run of runs) {
    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled" ||
      run.orchestratorThreadId === null
    ) {
      continue;
    }
    if (!byId.has(run.orchestratorThreadId)) continue;
    const children: T[] = [];
    for (const entry of run.roleThreads) {
      const child = byId.get(entry.threadId);
      if (child === undefined || entry.threadId === run.orchestratorThreadId) continue;
      children.push(child);
      childIds.add(entry.threadId);
    }
    if (children.length > 0) childrenByParent.set(run.orchestratorThreadId, children);
  }
  const ordered: T[] = [];
  const emitted = new Set<string>();
  for (const thread of threads) {
    if (childIds.has(thread.id)) continue;
    if (emitted.has(thread.id)) continue;
    emitted.add(thread.id);
    ordered.push(thread);
    for (const child of childrenByParent.get(thread.id) ?? []) {
      if (emitted.has(child.id)) continue;
      emitted.add(child.id);
      ordered.push(child);
    }
  }
  for (const thread of threads) {
    if (emitted.has(thread.id)) continue;
    ordered.push(thread);
  }
  return ordered;
}

export function groupSideChatsUnderParents<
  T extends {
    readonly id: string;
    readonly sideChat?: { readonly parentThreadId: string } | null | undefined;
  },
>(threads: readonly T[]): Array<{ readonly thread: T; readonly depth: 0 | 1 }> {
  const childrenByParentId = new Map<string, T[]>();
  const presentIds = new Set(threads.map((thread) => thread.id));
  const rooted: T[] = [];

  for (const thread of threads) {
    const parentId = thread.sideChat?.parentThreadId;
    if (parentId !== undefined && parentId !== thread.id && presentIds.has(parentId)) {
      const siblings = childrenByParentId.get(parentId);
      if (siblings === undefined) childrenByParentId.set(parentId, [thread]);
      else siblings.push(thread);
    } else {
      rooted.push(thread);
    }
  }

  const rows: Array<{ readonly thread: T; readonly depth: 0 | 1 }> = [];
  // Depth-first with the indent clamped at one level. Walking rather than
  // reading one level of children is what keeps a side chat of a side chat on
  // screen: it hangs off a thread that is itself nested, so a single lookup
  // from the roots would never reach it and the row would vanish.
  const emitted = new Set<string>();
  const emit = (thread: T, depth: 0 | 1): void => {
    if (emitted.has(thread.id)) return;
    emitted.add(thread.id);
    rows.push({ thread, depth });
    for (const child of childrenByParentId.get(thread.id) ?? []) {
      emit(child, 1);
    }
  };
  for (const thread of rooted) emit(thread, 0);
  // A cycle (a and b naming each other) leaves both out of `rooted` and out of
  // every walk. Appending the leftovers keeps them reachable rather than
  // silently dropping threads because of corrupt provenance.
  for (const thread of threads) emit(thread, 0);
  return rows;
}

// Pinned-reorder key math and the keyed sort live in client-runtime
// (state/thread-sort) so web and mobile compute identical pinned orders.
export {
  generateSpreadPinOrderKeys,
  pinOrderKeyBetween,
  planPinnedReorder,
} from "@t3tools/client-runtime/state/thread-sort";
export { sortPinnedThreadsByOrderKey as sortPinnedThreadsForSidebar } from "@t3tools/client-runtime/state/thread-sort";

/**
 * Search the already-ordered sidebar thread collection by title only.
 * Keeping the input order means lifecycle ordering (active, snoozed, settled)
 * remains stable while the user narrows the list.
 */
export function searchSidebarThreadsByTitle<T extends { readonly title: string }>(
  threads: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return [];
  return threads.filter((thread) => thread.title.toLowerCase().includes(normalizedQuery));
}

export function filterSidebarProjectScopeItems<TItem extends { readonly value: string }>(input: {
  items: readonly TItem[];
  activeScopeKey: string | null;
  query: string;
  matches: (item: TItem, query: string) => boolean;
}): readonly TItem[] {
  const projectItems = input.items.filter((item) => item.value !== "all");
  const query = input.query.trim();
  if (query.length > 0) {
    return projectItems.filter((item) => input.matches(item, query));
  }
  return input.activeScopeKey === null ? projectItems : input.items;
}

export interface SidebarProjectScopeMenuState {
  readonly open: boolean;
  readonly query: string;
}

export type SidebarProjectScopeMenuAction =
  | { readonly type: "query-changed"; readonly query: string }
  | { readonly type: "open-changed"; readonly open: boolean }
  | { readonly type: "project-settings-opened" };

export function reduceSidebarProjectScopeMenuState(
  state: SidebarProjectScopeMenuState,
  action: SidebarProjectScopeMenuAction,
): SidebarProjectScopeMenuState {
  switch (action.type) {
    case "query-changed":
      return { ...state, query: action.query };
    case "open-changed":
      return { open: action.open, query: "" };
    case "project-settings-opened":
      return { open: false, query: "" };
  }
}

// Settled rows are history, so they order by when the work ENDED, not when
// the thread was created or last touched.
export function sortSettledThreadsForSidebar<
  T extends SettledThreadTimestampInput & { readonly id: string },
>(threads: readonly T[]): T[] {
  const timestampMs = (thread: T) => {
    const timestamp = resolveSettledThreadTimestamp(thread);
    return timestamp === null ? 0 : Date.parse(timestamp);
  };
  return [...threads].toSorted(
    (left, right) => timestampMs(right) - timestampMs(left) || left.id.localeCompare(right.id),
  );
}

/** The timestamp a working thread's elapsed label counts from: the running
    turn's start (request time until adoption), falling back to the session's
    last transition when the turn projection lags behind. Malformed
    timestamps fall through to the next candidate, not just missing ones. */
export function resolveWorkingStartedAt(
  thread: Pick<SidebarThreadSummary, "latestTurn" | "session">,
): string | null {
  const turn = thread.latestTurn;
  if (turn && turn.completedAt === null) {
    return firstValidTimestamp(turn.startedAt, turn.requestedAt, thread.session?.updatedAt);
  }
  return firstValidTimestamp(thread.session?.updatedAt);
}

export function formatWorkingDurationLabel(elapsedMs: number): string {
  const seconds = Number.isFinite(elapsedMs) ? Math.max(0, Math.floor(elapsedMs / 1000)) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
}): ThreadStatusPill | null {
  const { thread } = input;

  if (thread.hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-status-attention-foreground",
      dotClass: "bg-status-attention",
      pulse: false,
    };
  }

  if (thread.hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-status-input-foreground",
      dotClass: "bg-status-input",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-status-live-foreground",
      dotClass: "bg-status-live",
      pulse: true,
    };
  }

  if (thread.session?.status === "starting") {
    return {
      label: "Connecting",
      colorClass: "text-status-live-foreground",
      dotClass: "bg-status-live",
      pulse: true,
    };
  }

  // An actionable plan prompt outranks lingering background work: it needs
  // the user's decision, while liveness merely reports (review finding).
  const hasPlanReadyPrompt =
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-status-decision-foreground",
      dotClass: "bg-status-decision",
      pulse: false,
    };
  }

  // The turn can settle while native background work runs on. Subagent and
  // workflow fleets read as plain Working; Monitoring is reserved for watch
  // loops (a parent agent babysitting a PR, tailing checks) with no other
  // live work. Same recede treatment as Working per inbox-zero.
  if (thread.backgroundLiveness === "working") {
    return {
      label: "Working",
      colorClass: "text-status-live-foreground",
      dotClass: "bg-status-live",
      pulse: true,
    };
  }

  if (thread.backgroundLiveness === "monitoring") {
    return {
      label: "Monitoring",
      colorClass: "text-status-live-foreground",
      dotClass: "bg-status-live",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-status-done-foreground",
      dotClass: "bg-status-done",
      pulse: false,
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function getVisibleThreadsForProject<T extends Pick<Thread, "id">>(input: {
  threads: readonly T[];
  activeThreadId: T["id"] | undefined;
  isThreadListExpanded: boolean;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  visibleThreads: T[];
  hiddenThreads: T[];
} {
  const { activeThreadId, isThreadListExpanded, previewLimit, threads } = input;
  const hasHiddenThreads = threads.length > previewLimit;

  if (!hasHiddenThreads || isThreadListExpanded) {
    return {
      hasHiddenThreads,
      hiddenThreads: [],
      visibleThreads: [...threads],
    };
  }

  const previewThreads = threads.slice(0, previewLimit);
  if (!activeThreadId || previewThreads.some((thread) => thread.id === activeThreadId)) {
    return {
      hasHiddenThreads: true,
      hiddenThreads: threads.slice(previewLimit),
      visibleThreads: previewThreads,
    };
  }

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  if (!activeThread) {
    return {
      hasHiddenThreads: true,
      hiddenThreads: threads.slice(previewLimit),
      visibleThreads: previewThreads,
    };
  }

  const visibleThreadIds = new Set([...previewThreads, activeThread].map((thread) => thread.id));

  return {
    hasHiddenThreads: true,
    hiddenThreads: threads.filter((thread) => !visibleThreadIds.has(thread.id)),
    visibleThreads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
  };
}

export function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreads(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}
export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly ThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function sortProjectsByActivity<TProject extends SidebarProject>(
  projects: readonly TProject[],
  sortOrder: SidebarProjectSortOrder,
  getProjectThreads: (project: TProject) => readonly ThreadSortInput[],
  compareTies: (left: TProject, right: TProject) => number,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(right, getProjectThreads(right), sortOrder);
    const leftTimestamp = getProjectSortTimestamp(left, getProjectThreads(left), sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    return byTimestamp || compareTies(left, right);
  });
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TThread extends Pick<Thread, "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProjectId.get(project.id) ?? [],
    (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
  );
}

export function sortLogicalProjectsForSidebar<
  TProject extends LogicalSidebarProject,
  TThread extends ScopedSidebarThread,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const groupKeyByProjectRef = new Map(
    projects.flatMap((project) =>
      project.memberProjectRefs.map(
        (projectRef) =>
          [`${projectRef.environmentId}\0${projectRef.projectId}`, project.projectKey] as const,
      ),
    ),
  );
  const threadsByProjectKey = new Map<string, TThread[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const projectKey = groupKeyByProjectRef.get(`${thread.environmentId}\0${thread.projectId}`);
    if (!projectKey) continue;
    const existing = threadsByProjectKey.get(projectKey);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByProjectKey.set(projectKey, [thread]);
    }
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProjectKey.get(project.projectKey) ?? [],
    (left, right) =>
      left.title.localeCompare(right.title) || left.projectKey.localeCompare(right.projectKey),
  );
}

/**
 * Sorts the cross-environment project collection used by landing surfaces.
 * Project ids are only unique within an environment, and archived threads
 * must not make a project appear recently active.
 */
export function sortScopedProjectsForSidebar<
  TProject extends ScopedSidebarProject,
  TThread extends ScopedSidebarThread,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  const scopedKey = (environmentId: string, projectId: string) =>
    `${environmentId}\u0000${projectId}`;
  const threadsByProject = new Map<string, TThread[]>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) {
      continue;
    }
    const key = scopedKey(thread.environmentId, thread.projectId);
    const existing = threadsByProject.get(key) ?? [];
    existing.push(thread);
    threadsByProject.set(key, existing);
  }

  return sortProjectsByActivity(
    projects,
    sortOrder,
    (project) => threadsByProject.get(scopedKey(project.environmentId, project.id)) ?? [],
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.environmentId.localeCompare(right.environmentId) ||
      left.id.localeCompare(right.id),
  );
}

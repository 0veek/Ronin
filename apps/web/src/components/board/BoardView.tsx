import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { canSettle, canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBoardUiStore } from "../../boardUiStore";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProjectFavicon } from "../ProjectFavicon";
import { resolveSnoozePresets, snoozeWakeDescription, type SnoozePreset } from "../Sidebar.snooze";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { BoardCard } from "./BoardCard";
import { BoardLane } from "./BoardLane";
import {
  BOARD_LANES,
  boardCapabilitiesFor,
  resolveBoardDrop,
  reorderCardIds,
  type BoardCard as BoardCardModel,
  type BoardDropAction,
  type BoardDropPermits,
  type BoardLaneKey,
} from "./board.logic";
import { useBoard } from "./useBoard";

function failureToast(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}

async function reportFailure(
  title: string,
  run: () => Promise<AtomCommandResult<unknown, unknown>>,
): Promise<boolean> {
  const result = await run();
  if (result._tag === "Failure") {
    if (!isAtomCommandInterrupted(result)) failureToast(title, squashAtomCommandFailure(result));
    return false;
  }
  return true;
}

/** The lane a drop landed on: lane droppables and cards both carry it in data. */
function laneFromDropData(data: unknown): BoardLaneKey | null {
  if (typeof data !== "object" || data === null || !("lane" in data)) return null;
  const lane = (data as { lane?: unknown }).lane;
  return typeof lane === "string" ? (lane as BoardLaneKey) : null;
}

/** The thread's own command guards, which gate a drop alongside capability. */
function permitsFor(card: BoardCardModel): BoardDropPermits {
  const now = new Date().toISOString();
  return {
    canSettle: canSettle(card.thread, { now }),
    canSnooze: canSnooze(card.thread, { now }),
  };
}

export function BoardView() {
  const router = useRouter();
  const scopeKey = useBoardUiStore((state) => state.scopeKey);
  const setScopeKey = useBoardUiStore((state) => state.setScopeKey);
  const collapsedLanes = useBoardUiStore((state) => state.collapsedLanes);
  const toggleLaneCollapsed = useBoardUiStore((state) => state.toggleLaneCollapsed);
  const setDraftOrder = useBoardUiStore((state) => state.setDraftOrder);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  // A scope whose project disappeared falls back to All projects rather than
  // leaving the picker pointing at nothing.
  const resetScope = useCallback(() => setScopeKey(null), [setScopeKey]);
  const {
    board,
    context,
    projectGroups,
    scopedProjectGroup,
    projectCwdByKey,
    projectFaviconPathByKey,
    projectIconByKey,
    projectDisplayNameByKey,
    draftOrderScopeKey,
  } = useBoard(scopeKey, resetScope);
  const { settleThread, unsettleThread, snoozeThread, unsnoozeThread, pinThread, unpinThread } =
    useThreadActions();

  const [activeCard, setActiveCard] = useState<BoardCardModel | null>(null);

  // The pointer's last position, so a snooze drop can anchor its preset menu
  // where the card was actually dropped rather than at the screen origin.
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  useEffect(() => {
    if (activeCard === null) return;
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [activeCard]);

  // A small activation distance keeps a plain click opening the thread: the
  // drag only starts once the pointer has actually travelled.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const openThread = useCallback(
    (ref: ScopedThreadRef) => {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(ref),
      });
    },
    [router],
  );

  /** Snooze plus its undo toast. Shared by the drag drop and the card menu. */
  const applySnoozePreset = useCallback(
    async (ref: ScopedThreadRef, preset: SnoozePreset) => {
      const ok = await reportFailure("Failed to snooze thread", () =>
        snoozeThread(ref, preset.snoozedUntil),
      );
      if (!ok) return;
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `Snoozed until ${snoozeWakeDescription(preset.snoozedUntil, new Date(), timestampFormat)}`,
          timeout: 5_000,
          actionProps: {
            children: "Undo",
            onClick: () => {
              void reportFailure("Failed to wake thread", () => unsnoozeThread(ref));
            },
          },
        }),
      );
    },
    [snoozeThread, timestampFormat, unsnoozeThread],
  );

  /** Ask for a wake time at the drop point, then snooze to it. */
  const runSnooze = useCallback(
    async (ref: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const presets = resolveSnoozePresets(new Date(), timestampFormat);
      const items: ContextMenuItem[] = presets.map((preset) => ({
        id: `snooze:${preset.id}`,
        label: `${preset.label} (${preset.whenLabel})`,
      }));
      const clicked = await settlePromise(() => api.contextMenu.show(items, position));
      if (clicked._tag === "Failure" || clicked.value === null) return;
      const preset = presets.find((candidate) => `snooze:${candidate.id}` === clicked.value);
      if (!preset) return;
      await applySnoozePreset(ref, preset);
    },
    [applySnoozePreset, timestampFormat],
  );

  const onCardOpen = useCallback(
    (card: BoardCardModel) => {
      openThread(scopeThreadRef(card.environmentId, card.threadId));
    },
    [openThread],
  );

  const runSettle = useCallback(
    async (ref: ScopedThreadRef) => {
      const ok = await reportFailure("Failed to settle thread", () => settleThread(ref));
      if (!ok) return;
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: "Settled",
          timeout: 5_000,
          actionProps: {
            children: "Undo",
            onClick: () => {
              void reportFailure("Failed to un-settle thread", () => unsettleThread(ref));
            },
          },
        }),
      );
    },
    [settleThread, unsettleThread],
  );

  const runDropAction = useCallback(
    async (action: BoardDropAction, card: BoardCardModel) => {
      const ref = scopeThreadRef(card.environmentId, card.threadId);
      switch (action.kind) {
        case "settle":
          await runSettle(ref);
          return;
        case "unsettle":
          await reportFailure("Failed to un-settle thread", () => unsettleThread(ref));
          return;
        case "unsnooze":
          await reportFailure("Failed to wake thread", () => unsnoozeThread(ref));
          return;
        case "snooze":
          await runSnooze(ref, pointerRef.current);
          return;
        case "unsnooze-then": {
          const woke = await reportFailure("Failed to wake thread", () => unsnoozeThread(ref));
          if (!woke) return;
          if (action.next === "settle") {
            await reportFailure("Failed to settle thread", () => settleThread(ref));
            return;
          }
          openThread(ref);
          return;
        }
        case "unsettle-then-open": {
          const ok = await reportFailure("Failed to un-settle thread", () => unsettleThread(ref));
          if (!ok) return;
          openThread(ref);
          return;
        }
        case "open-thread":
          openThread(ref);
          return;
        case "reorder":
        case "noop":
          return;
      }
    },
    [openThread, runSettle, runSnooze, settleThread, unsettleThread, unsnoozeThread],
  );

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const lane = laneFromDropData(event.active.data.current);
      if (lane === null) return;
      const cardId = String(event.active.id);
      setActiveCard(board.lanes[lane].find((card) => card.cardId === cardId) ?? null);
    },
    [board],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const card = activeCard;
      setActiveCard(null);
      if (card === null || event.over === null) return;
      const to = laneFromDropData(event.over.data.current);
      if (to === null) return;

      const action = resolveBoardDrop({
        from: card.lane,
        to,
        capabilities: boardCapabilitiesFor(context, card.environmentId),
        permits: permitsFor(card),
      });

      if (action.kind === "reorder") {
        const visible = board.lanes.draft.map((entry) => entry.cardId);
        const overId = String(event.over.id);
        // Empty space below the cards resolves to the lane itself; treat that
        // as "move to the end" rather than dropping the drag on the floor.
        const next = overId.startsWith("lane:")
          ? [...visible.filter((cardId) => cardId !== card.cardId), card.cardId]
          : reorderCardIds(visible, card.cardId, overId);
        if (next) setDraftOrder(draftOrderScopeKey, next);
        return;
      }
      void runDropAction(action, card);
    },
    [activeCard, board, context, draftOrderScopeKey, runDropAction, setDraftOrder],
  );

  const openCardMenu = useCallback(
    async (card: BoardCardModel, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const ref = scopeThreadRef(card.environmentId, card.threadId);
      const capabilities = boardCapabilitiesFor(context, card.environmentId);
      const permits = permitsFor(card);
      const presets = resolveSnoozePresets(new Date(), timestampFormat);
      // Verbs the thread cannot accept right now are rendered disabled rather
      // than dropped, so the menu's shape stays stable as state changes.
      const items: ContextMenuItem[] = [
        { id: "open", label: "Open chat" },
        ...(capabilities.settlement
          ? [
              card.lane === "done"
                ? { id: "unsettle", label: "Un-settle" }
                : { id: "settle", label: "Settle", disabled: !permits.canSettle },
            ]
          : []),
        ...(capabilities.snooze
          ? card.lane === "snoozed"
            ? [{ id: "unsnooze", label: "Wake now" }]
            : [
                {
                  id: "snooze",
                  label: "Snooze",
                  disabled: !permits.canSnooze,
                  children: presets.map((preset) => ({
                    id: `snooze:${preset.id}`,
                    label: `${preset.label} (${preset.whenLabel})`,
                  })),
                },
              ]
          : []),
        card.isPinned ? { id: "unpin", label: "Unpin" } : { id: "pin", label: "Pin" },
      ];
      const clicked = await settlePromise(() => api.contextMenu.show(items, position));
      if (clicked._tag === "Failure" || clicked.value === null) return;
      const action = clicked.value;
      if (action.startsWith("snooze:")) {
        const preset = presets.find((candidate) => `snooze:${candidate.id}` === action);
        if (!preset) return;
        await applySnoozePreset(ref, preset);
        return;
      }
      switch (action) {
        case "open":
          openThread(ref);
          return;
        case "settle":
          await runSettle(ref);
          return;
        case "unsettle":
          await reportFailure("Failed to un-settle thread", () => unsettleThread(ref));
          return;
        case "unsnooze":
          await reportFailure("Failed to wake thread", () => unsnoozeThread(ref));
          return;
        case "pin":
          await reportFailure("Failed to pin thread", () => pinThread(ref));
          return;
        case "unpin":
          await reportFailure("Failed to unpin thread", () => unpinThread(ref));
          return;
      }
    },
    [
      applySnoozePreset,
      context,
      openThread,
      pinThread,
      runSettle,
      timestampFormat,
      unpinThread,
      unsettleThread,
      unsnoozeThread,
    ],
  );

  const onCardContextMenu = useCallback(
    (card: BoardCardModel, event: React.MouseEvent) => {
      event.preventDefault();
      void openCardMenu(card, { x: event.clientX, y: event.clientY });
    },
    [openCardMenu],
  );

  const dropActionForLane = useMemo(() => {
    if (activeCard === null) return () => null;
    const capabilities = boardCapabilitiesFor(context, activeCard.environmentId);
    const permits = permitsFor(activeCard);
    return (lane: BoardLaneKey): BoardDropAction =>
      resolveBoardDrop({ from: activeCard.lane, to: lane, capabilities, permits });
  }, [activeCard, context]);

  const showProject = scopedProjectGroup === null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                aria-label="Project scope"
                className="inline-flex h-8 min-w-0 max-w-64 cursor-pointer items-center gap-2 rounded-[var(--control-radius)] px-2 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              />
            }
          >
            {scopedProjectGroup ? (
              <ProjectFavicon
                environmentId={scopedProjectGroup.environmentId}
                cwd={scopedProjectGroup.workspaceRoot}
                projectName={scopedProjectGroup.displayName}
                faviconPath={scopedProjectGroup.faviconPath}
                projectIcon={scopedProjectGroup.projectIcon}
                className="size-4 shrink-0"
              />
            ) : (
              <FolderIcon className="size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {scopedProjectGroup?.displayName ?? "All projects"}
            </span>
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuRadioGroup
              value={scopeKey ?? "all"}
              onValueChange={(value) => setScopeKey(value === "all" ? null : (value as string))}
            >
              <MenuRadioItem value="all" closeOnClick className="h-8 min-h-8 px-1 py-0 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <FolderIcon className="size-4 shrink-0" />
                  <span className="min-w-0 truncate">All projects</span>
                </span>
              </MenuRadioItem>
              {projectGroups.map((group) => (
                <MenuRadioItem
                  key={group.projectKey}
                  value={group.projectKey}
                  closeOnClick
                  className="h-8 min-h-8 px-1 py-0 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ProjectFavicon
                      environmentId={group.environmentId}
                      cwd={group.workspaceRoot}
                      projectName={group.displayName}
                      faviconPath={group.faviconPath}
                      projectIcon={group.projectIcon}
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0 truncate">{group.displayName}</span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
        <span className="ml-auto text-xs tabular-nums text-secondary-label">
          {board.totalCount} {board.totalCount === 1 ? "thread" : "threads"}
        </span>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveCard(null)}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4">
          {BOARD_LANES.map((lane) => {
            const cards = board.lanes[lane.key];
            return (
              <BoardLane
                key={lane.key}
                lane={lane}
                cards={cards}
                collapsed={collapsedLanes[lane.key] === true}
                onToggleCollapsed={() => toggleLaneCollapsed(lane.key)}
                dropAction={dropActionForLane(lane.key)}
              >
                {cards.map((card) => {
                  const projectKey = `${card.environmentId}:${card.thread.projectId}`;
                  return (
                    <BoardCard
                      key={card.cardId}
                      card={card}
                      projectTitle={projectDisplayNameByKey.get(projectKey) ?? null}
                      projectCwd={projectCwdByKey.get(projectKey) ?? null}
                      projectFaviconPath={projectFaviconPathByKey.get(projectKey)}
                      projectIcon={projectIconByKey.get(projectKey) ?? null}
                      showProject={showProject}
                      onOpen={onCardOpen}
                      onContextMenu={onCardContextMenu}
                    />
                  );
                })}
              </BoardLane>
            );
          })}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <div
              className={cn(
                "w-[18rem] rounded-[var(--control-radius)] border border-border bg-card px-2.5 py-2 shadow-lg",
              )}
            >
              <span className="line-clamp-2 text-sm font-medium text-foreground">
                {activeCard.thread.title}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

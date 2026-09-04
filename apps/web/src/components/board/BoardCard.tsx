import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ProjectIconOverride } from "@t3tools/contracts";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlarmClockIcon, ListPlusIcon, MessageSquareIcon, PinIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { resolveSettledThreadTimestamp } from "../../lib/threadSort";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel, formatRelativeTimeUntilLabel } from "../../timestampFormat";
import { useUiStateStore } from "../../uiStateStore";
import {
  formatWorkingDurationLabel,
  resolveThreadStatusPill,
  resolveWorkingStartedAt,
} from "../Sidebar.logic";
import { SidebarWorkingDuel } from "../sidebar/SidebarWorkingDuel";
import { ProjectFavicon } from "../ProjectFavicon";
import { ThreadWorktreeIndicator } from "../ThreadStatusIndicators";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { BoardCard as BoardCardModel } from "./board.logic";

/**
 * Live elapsed time for a working card. The clock lives in state rather than
 * being read during render — reading Date.now() in the render body makes the
 * component impure and defeats the memo around every other card.
 */
function BoardWorkingDuration({ startedAt }: { startedAt: string | null }) {
  const startedMs = startedAt !== null ? Date.parse(startedAt) : Number.NaN;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return (
    <span className="font-mono tabular-nums text-primary">
      {formatWorkingDurationLabel(nowMs - startedMs)}
    </span>
  );
}

export interface BoardCardProps {
  readonly card: BoardCardModel;
  readonly projectTitle: string | null;
  readonly projectCwd: string | null;
  readonly projectFaviconPath: string | null | undefined;
  readonly projectIcon: ProjectIconOverride | null | undefined;
  /** Hidden when the board is already scoped to a single project. */
  readonly showProject: boolean;
  readonly onOpen: (card: BoardCardModel) => void;
  readonly onContextMenu: (card: BoardCardModel, event: React.MouseEvent) => void;
}

export const BoardCard = memo(function BoardCard({
  card,
  projectTitle,
  projectCwd,
  projectFaviconPath,
  projectIcon,
  showProject,
  onOpen,
  onContextMenu,
}: BoardCardProps) {
  const thread = card.thread;
  const threadKey = useMemo(
    () => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
    [thread.environmentId, thread.id],
  );
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);

  // Listeners go on the whole card (no dedicated handle): the pointer sensor's
  // distance constraint keeps plain clicks working. dnd-kit's aria attributes
  // are deliberately skipped, matching the sidebar's pinned rows — there is no
  // keyboard sensor, and the card body already carries its own button
  // semantics, which a second role="button" on the <li> would fight.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.cardId,
    data: { lane: card.lane, environmentId: card.environmentId },
  });

  const status = useMemo(
    () => resolveThreadStatusPill({ thread: { ...thread, lastVisitedAt } }),
    [lastVisitedAt, thread],
  );
  const isWorking = status?.label === "Working" || status?.label === "Connecting";

  // Settled cards read "how long ago did this wrap up", matching the lane's
  // sort key; everything else reads from its last user message.
  const timeLabel =
    card.lane === "done"
      ? formatRelativeTimeLabel(resolveSettledThreadTimestamp(thread) ?? thread.updatedAt)
      : formatRelativeTimeLabel(thread.latestUserMessageAt ?? thread.updatedAt);

  return (
    <li
      ref={setNodeRef}
      data-board-card
      data-lane={card.lane}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        // Same budget technique the sidebar rows use: cheaper than a
        // virtualizer and far simpler to keep correct under drag.
        "list-none [content-visibility:auto] [contain-intrinsic-size:auto_84px]",
        isDragging && "z-20 opacity-60",
      )}
      {...listeners}
    >
      <div
        role="button"
        tabIndex={0}
        data-testid={`board-card-${thread.id}`}
        className={cn(
          // A board card is a real object in a grid, so it takes the raised
          // tier rather than a hairline alone, and lifts a step further under
          // the pointer the way a Finder item does.
          "group/board-card w-full cursor-pointer rounded-lg border border-border/70 bg-card px-2.5 py-2 text-left shadow-[var(--shadow-raised)]",
          "transition-[background-color,border-color,box-shadow] duration-(--duration-fast) ease-out hover:border-border hover:bg-sidebar-row-hover hover:shadow-[var(--shadow-popover)]",
          "focus-ring",
        )}
        onClick={() => onOpen(card)}
        onContextMenu={(event) => onContextMenu(card, event)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(card);
          }
        }}
      >
        <div className="flex h-5 min-w-0 items-center gap-1.5">
          {showProject ? (
            <>
              <ProjectFavicon
                environmentId={thread.environmentId}
                cwd={projectCwd ?? ""}
                projectName={projectTitle ?? ""}
                faviconPath={projectFaviconPath}
                projectIcon={projectIcon}
                className="size-4 shrink-0"
                fallbackIcon={MessageSquareIcon}
              />
              <span className="min-w-0 flex-1 truncate text-secondary-label text-xs">
                {projectTitle}
              </span>
            </>
          ) : (
            <span className="flex-1" />
          )}
          {/* A captured task and an empty draft both sit in Draft, and only
              one of them is ready to fire. The marker is what tells them
              apart at a glance. */}
          {thread.queuedPrompt ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ListPlusIcon
                    aria-label="Captured task, ready to send"
                    role="img"
                    className="size-3 shrink-0 text-muted-foreground/65"
                  />
                }
              />
              <TooltipPopup side="top">Captured task, ready to send</TooltipPopup>
            </Tooltip>
          ) : null}
          {card.isPinned ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <PinIcon
                    aria-label="Pinned"
                    role="img"
                    className="size-3 shrink-0 text-muted-foreground/65"
                  />
                }
              />
              <TooltipPopup side="top">Pinned</TooltipPopup>
            </Tooltip>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums text-secondary-label">
            {status ? (
              <span className={cn("inline-flex items-center gap-1 font-medium", status.colorClass)}>
                {isWorking ? <SidebarWorkingDuel animated={false} /> : null}
                <span className={cn(isWorking && "sr-only")} role="status">
                  {status.label}
                </span>
                {isWorking ? (
                  <BoardWorkingDuration startedAt={resolveWorkingStartedAt(thread)} />
                ) : null}
              </span>
            ) : (
              timeLabel
            )}
          </span>
        </div>

        <div className="mt-1 min-w-0">
          <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
            {thread.title}
          </span>
        </div>

        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-secondary-label text-xs">
          {thread.branch ? (
            <>
              <ThreadWorktreeIndicator thread={thread} />
              <span className="min-w-0 flex-1 truncate whitespace-nowrap">{thread.branch}</span>
            </>
          ) : (
            <span className="flex-1" />
          )}
          {/* A snoozed card's headline fact is when it comes BACK, so the
              wake time takes the slot the timestamp holds elsewhere. */}
          {card.lane === "snoozed" && thread.snoozedUntil ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-status-snoozed-foreground">
              <AlarmClockIcon aria-hidden className="size-3" />
              {formatRelativeTimeUntilLabel(thread.snoozedUntil)}
            </span>
          ) : status ? (
            <span className="shrink-0 tabular-nums">{timeLabel}</span>
          ) : null}
        </div>
      </div>
    </li>
  );
});

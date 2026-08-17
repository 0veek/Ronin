import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import type { BoardCard, BoardDropAction, BoardLaneDescriptor } from "./board.logic";
import { boardDropLabel, boardDropRefusalHint } from "./board.logic";

export interface BoardLaneProps {
  readonly lane: BoardLaneDescriptor;
  readonly cards: readonly BoardCard[];
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  /**
   * What dropping the card currently being dragged would do here, or null when
   * nothing is being dragged. Drives the ring, the tint, and the verb.
   */
  readonly dropAction: BoardDropAction | null;
  readonly children: ReactNode;
}

export function BoardLane({
  lane,
  cards,
  collapsed,
  onToggleCollapsed,
  dropAction,
  children,
}: BoardLaneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${lane.key}`, data: { lane: lane.key } });

  const accepts = dropAction !== null && dropAction.kind !== "noop";
  const refusalHint = dropAction?.kind === "noop" ? boardDropRefusalHint(dropAction.reason) : null;
  const verb = dropAction ? boardDropLabel(dropAction) : null;

  return (
    <section
      data-board-lane={lane.key}
      className={cn(
        "flex min-w-0 shrink-0 flex-col",
        collapsed ? "w-12" : "w-[19rem]",
        "transition-[width] duration-(--duration-base) ease-out motion-reduce:transition-none",
      )}
      aria-label={lane.label}
    >
      {/* The accent rule is the lane's whole colour budget: a hairline in the
          status hue the sidebar already uses for this state. */}
      <div
        aria-hidden
        className="h-0.5 shrink-0 rounded-full"
        style={{
          backgroundColor: lane.accentVar ? `var(${lane.accentVar})` : "var(--color-border)",
        }}
      />

      <header className="flex h-9 shrink-0 items-center gap-1.5 px-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${lane.label}`}
          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-icon-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </button>
        {collapsed ? null : (
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{lane.label}</span>
        )}
        <span
          className={cn(
            "tabular-nums text-xs text-secondary-label",
            collapsed ? "mx-auto" : "ml-auto pr-1",
          )}
        >
          {cards.length}
        </span>
      </header>

      {collapsed ? (
        <div
          className="flex flex-1 items-start justify-center pt-2"
          // Rotated label so a collapsed lane still says which one it is.
          style={{ writingMode: "vertical-rl" }}
        >
          <span className="text-xs text-secondary-label">{lane.label}</span>
        </div>
      ) : (
        <div
          ref={setNodeRef}
          data-board-lane-body
          className={cn(
            "relative min-h-24 flex-1 overflow-y-auto rounded-[var(--control-radius)] p-1",
            "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
            isOver && accepts && "bg-accent/40 ring-1 ring-inset ring-ring ring-dashed",
            // A refused target dims rather than inviting: the board never
            // offers an affordance it cannot honor.
            isOver && !accepts && dropAction !== null && "bg-muted/30",
          )}
        >
          {cards.length === 0 && dropAction === null ? (
            <p className="px-2 py-3 text-xs leading-relaxed text-secondary-label">
              {lane.emptyHint}
            </p>
          ) : null}

          {isOver && (verb !== null || refusalHint !== null) ? (
            <p
              role="status"
              className={cn(
                "sticky top-0 z-10 mb-1 rounded-sm px-2 py-1 text-xs font-medium",
                accepts ? "bg-accent text-foreground" : "bg-muted text-secondary-label",
              )}
            >
              {verb ?? refusalHint}
            </p>
          ) : null}

          <SortableContext
            items={cards.map((card) => card.cardId)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="flex flex-col gap-1">{children}</ul>
          </SortableContext>
        </div>
      )}
    </section>
  );
}

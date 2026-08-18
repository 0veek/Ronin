/**
 * The rivals bar on a thread that is racing.
 *
 * A comparison lives or dies on how cheap it is to flip between the answers,
 * so the entrants sit above the transcript as one row of chips: who is
 * answering, what state they are in, and one click to read theirs instead.
 * No separate compare screen — the transcript you already know how to read
 * *is* the comparison surface, one entrant at a time.
 *
 * @module SecondOpinionBanner
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ThreadId } from "@t3tools/contracts";
import { SplitIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The model's name, recovered from the title the race gave the thread.
    Titles are `"<model>: <prompt excerpt>"`, and the prompt is identical
    across entrants, so the prefix is the only part worth showing here. */
function entrantLabel(thread: EnvironmentThreadShell): string {
  const separator = thread.title.indexOf(": ");
  return separator > 0 ? thread.title.slice(0, separator) : thread.title;
}

export const SecondOpinionBanner = memo(function SecondOpinionBanner({
  activeThreadId,
  entrants,
  onOpenThread,
}: {
  readonly activeThreadId: ThreadId;
  /** Every thread in the group, this one included, in creation order. */
  readonly entrants: ReadonlyArray<EnvironmentThreadShell>;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
}) {
  if (entrants.length < 2) return null;

  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-4 py-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
              <SplitIcon aria-hidden className="size-3.5" />
              <span className="hidden sm:inline">Second opinion</span>
            </span>
          }
        />
        <TooltipPopup side="bottom">
          These threads answer the same prompt, each in its own worktree.
        </TooltipPopup>
      </Tooltip>
      <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {entrants.map((entrant) => {
          const isActive = entrant.id === activeThreadId;
          const status = resolveThreadStatusPill({ thread: entrant });
          return (
            <li
              key={scopedThreadKey({ environmentId: entrant.environmentId, threadId: entrant.id })}
            >
              <button
                type="button"
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors",
                  isActive
                    ? "border-border bg-accent text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                onClick={() => {
                  if (isActive) return;
                  onOpenThread(entrant);
                }}
              >
                {status ? (
                  <span
                    aria-hidden
                    className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)}
                  />
                ) : null}
                {entrantLabel(entrant)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

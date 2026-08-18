/**
 * The team bar on a thread that is part of a run.
 *
 * One chip per role, the run's status, and cancel. The orchestrator thread
 * is home; the chips are how you jump to a teammate without hunting the
 * sidebar.
 *
 * @module BuildSystemRunBanner
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { BuildSystemRun, ThreadId } from "@t3tools/contracts";
import { isBuildSystemRunActive } from "@t3tools/contracts";
import { UsersIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function statusLabel(run: BuildSystemRun): string {
  switch (run.status) {
    case "starting":
      return "Starting";
    case "orchestrating":
      return "Leading";
    case "delegating":
      return "Working";
    case "waiting-gate":
      return "Needs approval";
    case "waiting-user":
      return "Needs you";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export const BuildSystemRunBanner = memo(function BuildSystemRunBanner({
  activeThreadId,
  onCancel,
  onOpenThread,
  run,
  shells,
}: {
  readonly activeThreadId: ThreadId;
  readonly onCancel: () => void;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly run: BuildSystemRun;
  readonly shells: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const roles: Array<{
    readonly id: string;
    readonly label: string;
    readonly threadId: string | null;
  }> = [
    {
      id: "orchestrator",
      label: "Lead",
      threadId: run.orchestratorThreadId,
    },
    ...run.config.teammates.map((role) => ({
      id: role.id,
      label: role.name,
      threadId: run.roleThreads.find((entry) => entry.roleId === role.id)?.threadId ?? null,
    })),
  ];

  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-4 py-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
              <UsersIcon aria-hidden className="size-3.5" />
              <span className="hidden sm:inline">{run.config.name}</span>
            </span>
          }
        />
        <TooltipPopup side="bottom">{statusLabel(run)}</TooltipPopup>
      </Tooltip>
      <ul className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {roles.map((role) => {
          const shell =
            role.threadId === null
              ? null
              : (shells.find((candidate) => candidate.id === role.threadId) ?? null);
          const isActive = role.threadId === activeThreadId;
          const status = shell === null ? null : resolveThreadStatusPill({ thread: shell });
          return (
            <li key={role.id}>
              <button
                type="button"
                disabled={shell === null}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition-colors",
                  shell === null
                    ? "cursor-default border-transparent text-muted-foreground/60"
                    : "cursor-pointer",
                  isActive
                    ? "border-border bg-accent text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                onClick={() => {
                  if (shell === null || isActive) return;
                  onOpenThread(shell);
                }}
              >
                {status ? (
                  <span
                    aria-hidden
                    className={cn("size-1.5 shrink-0 rounded-full", status.dotClass)}
                  />
                ) : null}
                {role.label}
              </button>
            </li>
          );
        })}
      </ul>
      <span className="shrink-0 text-2xs text-muted-foreground">{statusLabel(run)}</span>
      {isBuildSystemRunActive(run.status) ? (
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel run
        </Button>
      ) : null}
    </div>
  );
});

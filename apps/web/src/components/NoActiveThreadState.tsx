import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useClientSettings } from "~/hooks/useSettings";
import { shortcutLabelForCommand } from "~/keybindings";
import { useProjects, useThreadShells } from "~/state/entities";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { selectResumableThreads } from "./NoActiveThreadState.logic";
import { WorkspaceTopbar } from "./shell/WorkspaceTopbar";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";

/** Renders a shortcut as a key cap, or nothing when the command is unbound —
    a user who cleared the binding should not be told to press it. */
function ShortcutHint({ label }: { label: string | null }) {
  if (label === null) return null;
  return (
    <kbd className="rounded-[var(--control-radius)] border border-border/70 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {label}
    </kbd>
  );
}

/**
 * The screen with nothing open on it.
 *
 * It used to state the problem ("Pick a thread to continue") without offering
 * either way out, which on a fresh launch is the first thing the app shows.
 * The two ways out are now on it: start something new, or resume one of the
 * few threads recent enough to still be on the user's mind. The palette hint
 * is there because this is the moment a new user is most receptive to learning
 * the one shortcut that reaches everything else.
 */
export function NoActiveThreadState() {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const sortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();

  const projectTitleById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title] as const)),
    [projects],
  );
  const resumableThreads = useMemo(
    () => selectResumableThreads({ threads, sortOrder }),
    [sortOrder, threads],
  );

  const startNewThread = useCallback(() => {
    if (defaultProjectRef === null) {
      // No project to start in yet: the palette owns adding one, and it is
      // also where the user would have gone looking.
      openCommandPalette({ open: "add-project" });
      return;
    }
    void handleNewThread(defaultProjectRef);
  }, [defaultProjectRef, handleNewThread]);

  const openPalette = useCallback(() => openCommandPalette(), []);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspaceTopbar>
          <span className="label-meta text-muted-foreground">No active thread</span>
        </WorkspaceTopbar>

        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-xl">
                {resumableThreads.length > 0 ? "Pick up where you left off" : "Start something"}
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                {defaultProjectRef === null
                  ? "Add a project to start your first thread."
                  : "Open a recent thread, or start a new one."}
              </EmptyDescription>
            </EmptyHeader>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button onClick={startNewThread} size="sm">
                <PlusIcon aria-hidden />
                {defaultProjectRef === null ? "Add project" : "New thread"}
              </Button>
              <Button onClick={openPalette} size="sm" variant="outline">
                <SearchIcon aria-hidden />
                Search
                <ShortcutHint
                  label={shortcutLabelForCommand(keybindings, "commandPalette.toggle")}
                />
              </Button>
            </div>

            {resumableThreads.length > 0 ? (
              <ul className="mt-8 flex flex-col gap-1 text-left">
                {resumableThreads.map((thread) => {
                  const projectTitle = projectTitleById.get(thread.projectId) ?? null;
                  return (
                    <li key={`${thread.environmentId}:${thread.id}`}>
                      <Button
                        className="h-auto w-full justify-start gap-2.5 px-2 py-2 font-normal"
                        onClick={() => {
                          void navigate({
                            to: "/$environmentId/$threadId",
                            params: buildThreadRouteParams(
                              scopeThreadRef(thread.environmentId, thread.id),
                            ),
                          });
                        }}
                        variant="ghost"
                      >
                        <MessageSquareIcon aria-hidden className="size-4 text-icon-muted" />
                        <span className="min-w-0 flex-1 truncate text-sm">{thread.title}</span>
                        <span className="shrink-0 text-muted-foreground text-xs">
                          {projectTitle ?? ""}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground/70 text-xs">
                          {formatRelativeTimeLabel(
                            thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
                          )}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}

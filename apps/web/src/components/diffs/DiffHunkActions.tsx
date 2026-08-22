import type { SelectionSide } from "@pierre/diffs";
import { MessageSquarePlus, Minus, Plus, Undo2 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { PatchLineSide } from "~/lib/patchHunks";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type DiffHunkActionKind = "revert" | "stage" | "unstage";

export interface DiffHunkActionRequest {
  readonly filePath: string;
  readonly action: DiffHunkActionKind;
  /** Absent for a file-wide action, which takes every hunk the file has. */
  readonly line?: { readonly lineNumber: number; readonly side: PatchLineSide };
}

export interface DiffHunkActionsConfig {
  /** Ordered actions this diff scope offers. An empty list hides the controls entirely. */
  readonly actions: ReadonlyArray<DiffHunkActionKind>;
  /**
   * Whether a file can be acted on at all: a binary file, a patch cut short by output limits, and
   * an untracked file facing a revert all have no slice worth sending.
   */
  readonly isFileActionable: (filePath: string, action: DiffHunkActionKind) => boolean;
  readonly onAction: (request: DiffHunkActionRequest) => void;
  readonly busy: boolean;
}

const ACTION_ICONS: Record<DiffHunkActionKind, ComponentType<{ className?: string }>> = {
  revert: Undo2,
  stage: Plus,
  unstage: Minus,
};

const HUNK_ACTION_LABELS: Record<DiffHunkActionKind, string> = {
  revert: "Revert hunk",
  stage: "Stage hunk",
  unstage: "Unstage hunk",
};

const FILE_ACTION_LABELS: Record<DiffHunkActionKind, string> = {
  revert: "Revert file",
  stage: "Stage file",
  unstage: "Unstage file",
};

function GutterButton({
  label,
  disabled,
  destructive,
  onPress,
  children,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly destructive?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            className={cn(
              "inline-flex size-5 cursor-pointer items-center justify-center rounded-[5px] border-0 bg-transparent p-0 text-muted-foreground transition-colors",
              "hover:bg-foreground/10 hover:text-foreground focus-visible:outline-hidden",
              "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
              destructive && "hover:bg-error/12 hover:text-error",
            )}
            // The viewer reads a pointer press in the gutter as the start of a range selection,
            // so the press has to stop here or every action would also open a comment draft.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              if (disabled) return;
              onPress();
            }}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

function toPatchLineSide(side: SelectionSide | undefined): PatchLineSide {
  return side === "deletions" ? "deletions" : "additions";
}

/**
 * The hover pill that replaces the viewer's single gutter button: comment stays the first action,
 * and the git actions follow so a hunk can be staged or thrown away without leaving the diff.
 */
export function DiffHunkGutterActions({
  config,
  filePath,
  getHoveredLine,
  onComment,
}: {
  readonly config: DiffHunkActionsConfig;
  readonly filePath: string;
  /** The viewer hands back only a line number when it is rendering a file rather than a diff. */
  readonly getHoveredLine: () => { lineNumber: number; side?: SelectionSide } | undefined;
  readonly onComment: (line: { lineNumber: number; side?: SelectionSide }) => void;
}) {
  const runAction = (action: DiffHunkActionKind) => {
    const hovered = getHoveredLine();
    if (!hovered) return;
    config.onAction({
      filePath,
      action,
      line: { lineNumber: hovered.lineNumber, side: toPatchLineSide(hovered.side) },
    });
  };

  return (
    <div
      className={cn(
        "-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 z-20 flex items-center gap-px",
        "rounded-md border border-border/70 bg-popover/95 p-px shadow-xs backdrop-blur-[2px]",
      )}
      data-diff-hunk-actions
    >
      <GutterButton
        label="Comment on selection"
        disabled={false}
        onPress={() => {
          const hovered = getHoveredLine();
          if (hovered) onComment(hovered);
        }}
      >
        <MessageSquarePlus className="size-3.5" />
      </GutterButton>
      {config.actions.map((action) => {
        const Icon = ACTION_ICONS[action];
        return (
          <GutterButton
            key={action}
            label={HUNK_ACTION_LABELS[action]}
            destructive={action === "revert"}
            disabled={config.busy || !config.isFileActionable(filePath, action)}
            onPress={() => runAction(action)}
          >
            <Icon className="size-3.5" />
          </GutterButton>
        );
      })}
    </div>
  );
}

/** The same actions at file scope, in the diff header next to the filename. */
export function DiffFileActions({
  config,
  filePath,
}: {
  readonly config: DiffHunkActionsConfig;
  readonly filePath: string;
}) {
  const available = config.actions.filter((action) => config.isFileActionable(filePath, action));
  if (available.length === 0) return null;

  return (
    <div className="ms-1 flex items-center gap-px" data-diff-file-actions>
      {available.map((action) => {
        const Icon = ACTION_ICONS[action];
        const label = `${FILE_ACTION_LABELS[action]}: ${filePath}`;
        return (
          <Tooltip key={action}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={label}
                  disabled={config.busy}
                  className={cn(
                    "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0",
                    "text-muted-foreground/70 transition-colors",
                    "hover:bg-foreground/10 hover:text-foreground focus-visible:outline-hidden",
                    "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
                    action === "revert" && "hover:bg-error/12 hover:text-error",
                  )}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    config.onAction({ filePath, action });
                  }}
                />
              }
            >
              <Icon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">{FILE_ACTION_LABELS[action]}</TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

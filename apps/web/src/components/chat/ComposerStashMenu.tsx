import { BookmarkIcon, FileIcon, XIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "~/lib/utils";
import { type PromptStashEntry } from "../../promptStashStore";
import { Command, CommandGroup, CommandGroupLabel, CommandItem, CommandList } from "../ui/command";
import { Button } from "../ui/button";

const SNIPPET_MAX_CHARS = 90;

/** Images that did not make it into the entry, whatever the reason. */
function missingImageCount(entry: PromptStashEntry): number {
  return entry.droppedImageNames.length + (entry.unreadableImageNames?.length ?? 0);
}

function stashEntrySnippet(entry: PromptStashEntry): string {
  const trimmed = assistantCitationsToPlainText(entry.prompt).trim().replace(/\s+/g, " ");
  if (trimmed.length > 0) {
    return trimmed.length > SNIPPET_MAX_CHARS ? `${trimmed.slice(0, SNIPPET_MAX_CHARS)}…` : trimmed;
  }
  const imageCount = entry.attachments.length + entry.droppedImageNames.length;
  const fileCount = entry.files?.length ?? 0;
  const attachmentCount = imageCount + fileCount;
  if (attachmentCount === 0) {
    return "(empty)";
  }
  const label = imageCount > 0 && fileCount > 0 ? "attachment" : fileCount > 0 ? "file" : "image";
  return `(${attachmentCount} ${label}${attachmentCount === 1 ? "" : "s"})`;
}

/**
 * Popover listing the stashed prompts. Keyboard-first: opened by ⌘S on an
 * empty composer, navigated with arrows, restored with Enter, dismissed
 * with Escape. The listener runs capture-phase on window so it wins over
 * the Lexical editor's handlers while the menu is open.
 */
export const ComposerStashMenu = memo(function ComposerStashMenu(props: {
  entries: ReadonlyArray<PromptStashEntry>;
  stashShortcutLabel: string | null;
  onRestore: (entry: PromptStashEntry) => void;
  onDelete: (entry: PromptStashEntry) => void;
  onClose: () => void;
}) {
  const { entries, stashShortcutLabel, onRestore, onDelete, onClose } = props;
  const [highlightedId, setHighlightedId] = useState<string | null>(entries[0]?.id ?? null);

  const highlightedEntry = entries.find((entry) => entry.id === highlightedId) ?? entries[0];

  useEffect(() => {
    if (entries.length === 0) return;
    if (!entries.some((entry) => entry.id === highlightedId)) {
      setHighlightedId(entries[0]?.id ?? null);
    }
  }, [entries, highlightedId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (entries.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const currentIndex = entries.findIndex((entry) => entry.id === highlightedId);
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const normalizedIndex = currentIndex >= 0 ? currentIndex : offset === 1 ? -1 : 0;
        const nextIndex = (normalizedIndex + offset + entries.length) % entries.length;
        setHighlightedId(entries[nextIndex]?.id ?? null);
        return;
      }
      if (event.key === "Enter") {
        // A focused control inside the row (the delete button) owns its own
        // activation; swallowing Enter here would restore instead of delete.
        if (event.target instanceof HTMLElement && event.target.closest("button[aria-label]")) {
          return;
        }
        if (!highlightedEntry) return;
        event.preventDefault();
        event.stopPropagation();
        onRestore(highlightedEntry);
        return;
      }
      if (event.key === "Backspace" && (event.metaKey || event.ctrlKey)) {
        if (!highlightedEntry) return;
        event.preventDefault();
        event.stopPropagation();
        onDelete(highlightedEntry);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [entries, highlightedEntry, highlightedId, onClose, onDelete, onRestore]);

  return (
    <Command autoHighlight={false} mode="none">
      <div className="surface-menu relative w-full overflow-hidden rounded-[var(--radius-lg)]">
        <CommandList className="max-h-72">
          <CommandGroup>
            <CommandGroupLabel className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-3xs font-semibold uppercase tracking-[0.08em] text-secondary-label">
              <BookmarkIcon className="size-3" aria-hidden="true" />
              Stashed prompts
            </CommandGroupLabel>
            {entries.length === 0 ? (
              <p className="px-3 pb-3 pt-1 text-secondary-label text-xs">
                Nothing stashed yet.
                {stashShortcutLabel
                  ? ` Press ${stashShortcutLabel} with a prompt in the composer to stash it.`
                  : null}
              </p>
            ) : (
              entries.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={entry.id}
                  className={cn(
                    "group/stash cursor-pointer select-none gap-2 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit",
                    highlightedId === entry.id && "bg-accent! text-accent-foreground!",
                  )}
                  onMouseMove={() => {
                    if (highlightedId !== entry.id) setHighlightedId(entry.id);
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    onRestore(entry);
                  }}
                >
                  {entry.attachments.length > 0 ? (
                    <span className="flex shrink-0 items-center -space-x-1.5">
                      {entry.attachments.slice(0, 3).map((attachment) => (
                        <img
                          key={attachment.id}
                          src={attachment.dataUrl}
                          alt=""
                          aria-hidden="true"
                          className="size-5 rounded border border-border/70 object-cover"
                        />
                      ))}
                    </span>
                  ) : (
                    <BookmarkIcon className="size-4 shrink-0 text-icon-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {stashEntrySnippet(entry)}
                  </span>
                  {entry.pendingImageCount ? (
                    <span className="shrink-0 text-3xs text-secondary-label">
                      saving {entry.pendingImageCount} image
                      {entry.pendingImageCount === 1 ? "" : "s"}…
                    </span>
                  ) : missingImageCount(entry) > 0 ? (
                    <span className="shrink-0 text-3xs text-warning-foreground">
                      {missingImageCount(entry)} image
                      {missingImageCount(entry) === 1 ? "" : "s"} dropped
                    </span>
                  ) : null}
                  {(entry.files?.length ?? 0) > 0 ? (
                    <span className="flex shrink-0 items-center gap-1 text-secondary-label text-xs">
                      <FileIcon className="size-3.5 text-secondary-label" />
                      {entry.files!.length}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-secondary-label text-xs max-sm:hidden">
                    {formatRelativeTimeLabel(entry.createdAt)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 opacity-0 transition-opacity group-hover/stash:opacity-100"
                    aria-label="Delete stashed prompt"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(entry);
                    }}
                  >
                    <XIcon />
                  </Button>
                </CommandItem>
              ))
            )}
          </CommandGroup>
        </CommandList>
      </div>
    </Command>
  );
});

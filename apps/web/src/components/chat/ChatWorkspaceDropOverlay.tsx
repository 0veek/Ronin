import { PaperclipIcon } from "lucide-react";

/**
 * The drop target shown while files are dragged over the chat column.
 *
 * Lives on its own because it is the one overlay in the chat view that owns no
 * thread state — it reads a single boolean and paints. The dashed rule is inset
 * rather than full-bleed so it reads as "this region accepts the drop" instead
 * of as a window-level mode.
 */
export function ChatWorkspaceDropOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-primary/60 border-dashed bg-primary/[0.035]"
      data-chat-workspace-drop-overlay="true"
    >
      <div
        role="status"
        className="flex items-center gap-2 rounded-full border border-primary/25 bg-popover px-4 py-2.5 font-medium text-foreground text-sm shadow-[var(--shadow-popover)]"
      >
        <PaperclipIcon className="size-4 text-primary" aria-hidden="true" />
        Drop files to attach
      </div>
    </div>
  );
}

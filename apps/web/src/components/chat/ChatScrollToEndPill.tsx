import { ChevronDownIcon } from "lucide-react";

/**
 * The "jump back to the live edge" affordance, shown once the reader has
 * scrolled away from the end of the timeline.
 *
 * It floats over the timeline, so it takes the popover elevation rather than a
 * flat border — at rest it has to read as sitting above the messages it covers.
 * `bottom` is driven by the composer's measured height so the pill tracks the
 * composer as it grows instead of being hidden behind it.
 */
export function ChatScrollToEndPill({
  bottomOffset,
  onScrollToEnd,
}: {
  bottomOffset: number;
  onScrollToEnd: () => void;
}) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5"
      style={{ bottom: bottomOffset }}
    >
      <button
        type="button"
        aria-label="Scroll to end"
        onClick={onScrollToEnd}
        className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1 text-muted-foreground text-xs shadow-[var(--shadow-popover)] transition-colors duration-(--duration-fast) hover:bg-accent hover:text-foreground"
      >
        <ChevronDownIcon className="size-3.5" />
        Scroll to end
      </button>
    </div>
  );
}

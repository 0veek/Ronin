/**
 * The chip that appears when you select part of an answer.
 *
 * Reading is where the question forms, so this is the entry point that matters
 * — the hover row and the palette exist for completeness, but nobody discovers
 * a feature from either. It follows the selection rather than living anywhere,
 * which is also why it is a portal: the timeline is a virtualized list with its
 * own clipping, and a chip parented inside a row would be cut off at the row's
 * edge and scroll away from the text it belongs to.
 *
 * @module SideChatSelectionAction
 */
import { MessagesSquareIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Kbd } from "~/components/ui/kbd";
import {
  resolveSelectionAnchor,
  resolveSideChatSelection,
  type SideChatSelectionAnchor,
  type SideChatSelectionCandidate,
} from "~/sideChatSelection";
import { cn } from "~/lib/utils";

/** Matches the rendered chip; only used to keep it inside the viewport. */
const CHIP_WIDTH_PX = 168;
/** Gap between the selection's top edge and the chip's bottom edge. */
const CHIP_OFFSET_PX = 10;

interface ActiveSelection {
  readonly candidate: SideChatSelectionCandidate;
  readonly anchor: SideChatSelectionAnchor;
}

function endpointFrom(node: Node | null): {
  messageId: string | null;
  messageRole: string | null;
} {
  const element =
    node === null
      ? null
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
  const row = element?.closest("[data-message-id]") ?? null;
  return {
    messageId: row?.getAttribute("data-message-id") ?? null,
    messageRole: row?.getAttribute("data-message-role") ?? null,
  };
}

/**
 * Reads the live selection into a candidate, or `null` when it does not
 * qualify. All the "does this count" judgement lives in `sideChatSelection`;
 * this only bridges the DOM to it.
 */
function readSelection(): ActiveSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const candidate = resolveSideChatSelection({
    selectedText: selection.toString(),
    anchor: endpointFrom(selection.anchorNode),
    focus: endpointFrom(selection.focusNode),
  });
  if (candidate === null) return null;

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  // A zero-height rect means the range resolved to nothing paintable — a
  // collapsed range mid-reflow, or a selection inside a hidden node.
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    candidate,
    anchor: resolveSelectionAnchor({
      rect,
      viewportWidth: window.innerWidth,
      chipWidth: CHIP_WIDTH_PX,
    }),
  };
}

export function SideChatSelectionAction({
  enabled,
  onAsk,
}: {
  /** Off for draft threads, which have nowhere to open a side chat into. */
  readonly enabled: boolean;
  readonly onAsk: (messageId: string, passage: string) => void;
}) {
  const [active, setActive] = useState<ActiveSelection | null>(null);
  // Held across the click so pressing the chip — which clears the selection as
  // focus moves — still knows what was selected.
  const activeRef = useRef<ActiveSelection | null>(null);
  activeRef.current = active;

  useEffect(() => {
    if (!enabled) {
      setActive(null);
      return;
    }
    // `selectionchange` fires continuously while dragging, so the read is
    // deferred to the pointer/key release that ends the gesture. That also
    // stops the chip flickering along under the cursor mid-drag.
    const sync = () => setActive(readSelection());
    const clearWhileSelecting = () => {
      if (activeRef.current !== null) setActive(null);
    };

    document.addEventListener("selectionchange", clearWhileSelecting);
    document.addEventListener("pointerup", sync);
    document.addEventListener("keyup", sync);
    window.addEventListener("scroll", clearWhileSelecting, true);
    window.addEventListener("resize", clearWhileSelecting);
    return () => {
      document.removeEventListener("selectionchange", clearWhileSelecting);
      document.removeEventListener("pointerup", sync);
      document.removeEventListener("keyup", sync);
      window.removeEventListener("scroll", clearWhileSelecting, true);
      window.removeEventListener("resize", clearWhileSelecting);
    };
  }, [enabled]);

  const ask = useCallback(() => {
    const current = activeRef.current;
    if (current === null) return;
    setActive(null);
    window.getSelection()?.removeAllRanges();
    onAsk(current.candidate.messageId, current.candidate.text);
  }, [onAsk]);

  if (!enabled || active === null) return null;

  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full",
        // No entrance animation: the chip appears on pointer-up, and a fade
        // would put it behind the click that is already on its way.
      )}
      style={{ left: active.anchor.x, top: active.anchor.y - CHIP_OFFSET_PX }}
    >
      <button
        type="button"
        // `onPointerDown` rather than `onClick`: the browser clears the
        // selection on mousedown elsewhere, and by click time the passage
        // would be gone.
        onPointerDown={(event) => {
          event.preventDefault();
          ask();
        }}
        className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1.5 text-popover-foreground text-xs shadow-lg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessagesSquareIcon aria-hidden className="size-3.5" />
        Ask on the side
        <Kbd className="ml-0.5">⌘⇧A</Kbd>
      </button>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

const HIDE_AFTER_MS = 1500;
const ZOOM_EPSILON = 0.001;

interface Props {
  /** Current zoom factor (1.0 = 100%); changes drive the transient indicator. */
  zoomFactor: number;
}

/**
 * Floating "X%" pill that surfaces in the top-right of the webview area
 * whenever the zoom factor changes, then fades out after a short pause.
 *
 * Suppressed for the first render's value so we don't flash 100% on mount.
 */
export function ZoomIndicator({ zoomFactor }: Props) {
  const [visible, setVisible] = useState(false);
  const lastFactorRef = useRef(zoomFactor);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (Math.abs(lastFactorRef.current - zoomFactor) < ZOOM_EPSILON) return;
    lastFactorRef.current = zoomFactor;
    setVisible(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, HIDE_AFTER_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [zoomFactor]);

  const percent = `${Math.round(zoomFactor * 100)}%`;

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        // Opaque, not translucent: this floats over arbitrary page content, so
        // the only thing that keeps it readable is its own fill.
        "pointer-events-none absolute top-3 right-3 z-20 select-none rounded-(--control-radius) border border-border bg-popover px-2.5 py-1 text-xs font-medium tabular-nums text-foreground shadow-(--shadow-popover) transition-[opacity,translate] duration-(--duration-base) ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1",
      )}
    >
      {percent}
    </div>
  );
}

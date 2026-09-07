import { RefreshCwIcon } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * The refresh glyph, spinning in place while its owning action runs instead of
 * being swapped for a separate spinner. `loops-forever` parks it while the
 * window is in the background (see styles/motion.css).
 */
export function RefreshIcon({
  refreshing = false,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RefreshCwIcon> & { refreshing?: boolean }) {
  return (
    <RefreshCwIcon
      aria-hidden
      className={cn(refreshing && "loops-forever animate-spin", className)}
      {...props}
    />
  );
}

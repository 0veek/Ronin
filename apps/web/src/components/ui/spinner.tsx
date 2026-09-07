import { LoaderCircleIcon } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * The one loading indicator. `loops-forever` parks it while the window is in
 * the background rather than paying for a frame nobody sees (styles/motion.css).
 */
function Spinner({ className, ...props }: React.ComponentPropsWithoutRef<typeof LoaderCircleIcon>) {
  return (
    <LoaderCircleIcon
      aria-label="Loading"
      className={cn("loops-forever animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };

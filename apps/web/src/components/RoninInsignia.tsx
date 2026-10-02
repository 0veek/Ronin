import { cn } from "~/lib/utils";

/** Decorative workspace mark. Uses the active theme's ink and accent. */
export function RoninInsignia({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("ronin-insignia", className)}>
      <svg viewBox="0 0 40 40" fill="none">
        <path
          d="M11 29V11h11a7 7 0 0 1 0 14h-5m3-7 10 11"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="square"
          strokeLinejoin="bevel"
        />
        <path d="m7 7 4-4m22 30 4-4" stroke="currentColor" strokeOpacity=".45" />
      </svg>
    </span>
  );
}

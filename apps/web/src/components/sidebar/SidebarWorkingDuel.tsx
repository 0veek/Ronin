import { cn } from "~/lib/utils";

/**
 * The sidebar's working mark: animated for the active thread, resting
 * elsewhere, and bowing once when the thread settles.
 *
 * `settled` is the duel's ending. A run that just stops leaves the strike
 * mid-air and the mark simply vanishes on the next status change; landing it
 * on a bow gives the work a punchline and reuses the character the row already
 * established. It is one 400ms beat that holds its final pose — nothing here
 * loops, which is why the settled variant drops `loops-forever`.
 */
export function SidebarWorkingDuel({
  animated,
  settled = false,
}: {
  animated: boolean;
  settled?: boolean;
}) {
  return (
    <svg
      aria-hidden
      className={cn(
        "sidebar-working-duel h-4 w-9 shrink-0 text-primary",
        // Only the looping variant needs parking while the window is hidden.
        animated && !settled && "loops-forever",
      )}
      data-animated={animated}
      data-settled={settled}
      fill="none"
      focusable="false"
      viewBox="0 0 44 20"
    >
      <path className="sidebar-working-duel-ground" d="M3 18H41" pathLength="1" />

      <g className="working-ninja working-ninja-left">
        <path className="working-ninja-headband" d="M7.2 4.2 3.5 2.8l1.3 1.8-2.5.6" />
        <circle className="working-ninja-silhouette" cx="9.5" cy="6" r="3.25" />
        <path className="working-ninja-eyes" d="M7.3 5.5h4.4" />
        <path
          className="working-ninja-silhouette"
          d="M6.7 9.3c1.8-1 3.8-1 5.6 0l2 4.4-2.7 1.2-2-3-2.1 3.8H4.7l2-4.1-2.2 1.2-1-1.8 3.2-1.7Z"
        />
        <path className="working-ninja-limbs" d="m7.5 14.2-2.6 3.6m6.7-3.5 2.8 3.5" />
        <g className="working-ninja-blade working-ninja-blade-left">
          <path className="working-ninja-sword" d="m14 9 3-1.7 8.9-5.5" />
          <path className="working-ninja-sword-hilt" d="m15.2 6.8 2.1 2.5" />
        </g>
      </g>

      <g className="working-ninja working-ninja-right">
        <path className="working-ninja-headband" d="m36.8 4.2 3.7-1.4-1.3 1.8 2.5.6" />
        <circle className="working-ninja-silhouette" cx="34.5" cy="6" r="3.25" />
        <path className="working-ninja-eyes" d="M32.3 5.5h4.4" />
        <path
          className="working-ninja-silhouette"
          d="M37.3 9.3c-1.8-1-3.8-1-5.6 0l-2 4.4 2.7 1.2 2-3 2.1 3.8h2.8l-2-4.1 2.2 1.2 1-1.8-3.2-1.7Z"
        />
        <path className="working-ninja-limbs" d="m36.5 14.2 2.6 3.6m-6.7-3.5-2.8 3.5" />
        <g className="working-ninja-blade working-ninja-blade-right">
          <path className="working-ninja-sword" d="m30 9-3-1.7-8.9-5.5" />
          <path className="working-ninja-sword-hilt" d="m28.8 6.8-2.1 2.5" />
        </g>
      </g>

      <g className="working-ninja-spark">
        <path d="M22 1.2v1.3M22 5.7V7m-3.1-2.9h1.3m3.6 0h1.3M19.8 1.9l.9.9m2.6 2.6.9.9m0-4.4-.9.9m-2.6 2.6-.9.9" />
      </g>
    </svg>
  );
}

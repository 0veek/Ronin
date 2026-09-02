import { CompassIcon, FlaskConicalIcon, GitCompareArrowsIcon, ScanSearchIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { memo } from "react";

/**
 * Starting points under the draft composer.
 *
 * A blank composer asks the user to invent the first sentence; these are the
 * four jobs people most often hand an agent the moment they open a project.
 * Picking one drops a complete instruction into the composer and leaves the
 * caret at the end, so the user can send it as-is or narrow it before sending.
 * Nothing is sent on click.
 */
export interface DraftHeroStarter {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly icon: LucideIcon;
}

export const DRAFT_HERO_STARTERS: ReadonlyArray<DraftHeroStarter> = [
  {
    id: "review-changes",
    label: "Review my changes",
    prompt:
      "Review my uncommitted changes. Flag bugs, missing tests, and anything risky before I commit. Don't edit files yet.",
    icon: GitCompareArrowsIcon,
  },
  {
    id: "explain-codebase",
    label: "Explain this codebase",
    prompt:
      "Explain how this codebase is organized: entry points, the main modules and how they talk to each other, and where I should look first to make a change.",
    icon: CompassIcon,
  },
  {
    id: "fix-tests",
    label: "Fix failing tests",
    prompt:
      "Run the test suite, find the failing tests, and fix the underlying causes. Show me the failures before you change anything.",
    icon: FlaskConicalIcon,
  },
  {
    id: "audit-bugs",
    label: "Audit for bugs",
    prompt:
      "Audit this project for logic bugs, UI issues, and unhandled edge cases. List them ranked by severity with the file and line for each. Don't fix anything yet.",
    icon: ScanSearchIcon,
  },
];

export const DraftHeroStarters = memo(function DraftHeroStarters({
  onPick,
}: {
  readonly onPick: (starter: DraftHeroStarter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Starting points"
      className="pointer-events-auto mx-auto flex w-full max-w-[var(--app-chat-max-width,48rem)] flex-wrap items-center justify-center gap-1.5 px-1"
    >
      {DRAFT_HERO_STARTERS.map((starter) => (
        <button
          key={starter.id}
          type="button"
          onClick={() => onPick(starter)}
          className="focus-ring inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-card/70 px-3 text-muted-foreground text-xs transition-colors duration-(--duration-fast) hover:border-input hover:bg-card hover:text-foreground"
        >
          <starter.icon aria-hidden className="size-3.5 shrink-0 text-icon-muted" />
          {starter.label}
        </button>
      ))}
    </div>
  );
});

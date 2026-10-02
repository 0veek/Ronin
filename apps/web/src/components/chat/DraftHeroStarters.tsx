import {
  ArrowUpRightIcon,
  CompassIcon,
  FlaskConicalIcon,
  GitCompareArrowsIcon,
  ScanSearchIcon,
} from "lucide-react";
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
  readonly description: string;
  readonly prompt: string;
  readonly icon: LucideIcon;
}

export const DRAFT_HERO_STARTERS: ReadonlyArray<DraftHeroStarter> = [
  {
    id: "review-changes",
    label: "Review my changes",
    description: "A fresh pair of eyes",
    prompt:
      "Review my uncommitted changes. Flag bugs, missing tests, and anything risky before I commit. Don't edit files yet.",
    icon: GitCompareArrowsIcon,
  },
  {
    id: "explain-codebase",
    label: "Explain this codebase",
    description: "Find your way around",
    prompt:
      "Explain how this codebase is organized: entry points, the main modules and how they talk to each other, and where I should look first to make a change.",
    icon: CompassIcon,
  },
  {
    id: "fix-tests",
    label: "Fix failing tests",
    description: "Get back to green",
    prompt:
      "Run the test suite, find the failing tests, and fix the underlying causes. Show me the failures before you change anything.",
    icon: FlaskConicalIcon,
  },
  {
    id: "audit-bugs",
    label: "Audit for bugs",
    description: "Catch the unexpected",
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
      className="draft-starters pointer-events-auto mx-auto grid w-full max-w-[var(--app-chat-max-width,48rem)] grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {DRAFT_HERO_STARTERS.map((starter) => (
        <button
          key={starter.id}
          type="button"
          onClick={() => onPick(starter)}
          className="draft-starter focus-ring group relative flex min-w-0 cursor-pointer flex-col items-start gap-3 rounded-xl border p-3 text-left"
        >
          <span className="draft-starter-icon">
            <starter.icon aria-hidden className="size-4" />
          </span>
          <ArrowUpRightIcon
            aria-hidden
            className="draft-starter-arrow absolute right-3 top-3 size-3.5"
          />
          <span className="min-w-0">
            <span className="block text-xs font-medium text-foreground">{starter.label}</span>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              {starter.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
});

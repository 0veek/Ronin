import type { AutomationDraftState } from "./automationDraft";
import { startAutomationDraft } from "./automationDraft";

export const AUTOMATION_RECIPES = [
  {
    id: "morning-brief",
    title: "Morning brief",
    description: "Catch up on recent changes, unfinished work, and useful next steps.",
    prompt: `Prepare a concise morning brief for this project. Read the project instructions first.
Review recent commits and the current working tree. Summarize what changed, flag concrete risks or unfinished work, and suggest the three most useful next steps with file references.
Keep this read-only: do not edit files, install dependencies, commit, push, or open pull requests. Distinguish confirmed findings from guesses.`,
    envMode: "local",
    timeOfDayText: "09:00",
    weekdays: [1, 2, 3, 4, 5],
  },
  {
    id: "regression-patrol",
    title: "Regression patrol",
    description: "Investigate recent changes and fix one well-supported regression in a worktree.",
    prompt: `Look for a concrete regression in this project's recent commits. Read the project instructions and inspect the relevant code before changing anything.
Prioritize a reproducible failure with a clear user impact. If you find one, make the smallest useful fix and add or run a focused regression test. Follow the project's verification rules; do not run broad checks unless they are required.
If no regression is supported by evidence, report that without inventing work. Finish with what you found, what changed, and the checks you ran. Do not commit, push, or open pull requests.`,
    envMode: "worktree",
    timeOfDayText: "16:00",
    weekdays: [1, 2, 3, 4, 5],
  },
  {
    id: "test-gaps",
    title: "Test gap finder",
    description: "Add meaningful coverage for one recently changed behavior.",
    prompt: `Find one important recently changed behavior in this project that lacks meaningful test coverage. Read the project instructions first, then inspect the behavior and existing test patterns.
Add a focused test that would catch a real failure, such as an edge case, state transition, or error path. Avoid tests that merely repeat the implementation or assert callback wiring. Keep the change limited to this behavior and run the smallest relevant verification.
If there is no useful gap, explain what you checked. Finish with the behavior covered and test results. Do not install dependencies, commit, push, or open pull requests.`,
    envMode: "worktree",
    timeOfDayText: "10:00",
    weekdays: [1],
  },
  {
    id: "weekly-changelog",
    title: "Weekly changelog",
    description: "Turn the week's commits into a readable update for your team.",
    prompt: `Write a concise changelog for this project's last seven days of commits. Read the project instructions and inspect the changes behind each notable entry.
Group the update into features, fixes, and any breaking changes or migration steps. Explain user-visible outcomes in plain language and cite relevant commits or files. Leave out internal churn that does not affect users. Flag uncertainties rather than claiming unverified behavior.
Return the changelog in this thread. Keep this read-only: do not edit files, install dependencies, commit, push, or open pull requests.`,
    envMode: "local",
    timeOfDayText: "16:00",
    weekdays: [5],
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly prompt: string;
  readonly envMode: AutomationDraftState["envMode"];
  readonly timeOfDayText: string;
  readonly weekdays: ReadonlyArray<number>;
}>;

export type AutomationRecipe = (typeof AUTOMATION_RECIPES)[number];

/** Recipes populate the ordinary editor and never create or run an automation. */
export function draftFromAutomationRecipe(
  recipe: AutomationRecipe,
  projectId: string,
): AutomationDraftState {
  return {
    ...startAutomationDraft(projectId),
    title: recipe.title,
    prompt: recipe.prompt,
    envMode: recipe.envMode,
    timeOfDayText: recipe.timeOfDayText,
    weekdays: [...recipe.weekdays],
  };
}

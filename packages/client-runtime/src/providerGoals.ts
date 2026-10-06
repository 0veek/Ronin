import type { ProviderGoal } from "@t3tools/contracts";
import { formatDuration } from "@t3tools/shared/orchestrationTiming";

export interface ProviderGoalPresentation {
  /** "Pursuing goal", "Goal paused", "Goal complete"... */
  readonly title: string;
  readonly objective: string;
  /** "12k / 50k tokens · 4m" for Codex, "2 checks" for Claude; null when nothing is reported. */
  readonly usage: string | null;
  /** Only Codex stops a goal short of done, and only a stopped goal can resume. */
  readonly canResume: boolean;
}

const PROVIDER_GOAL_TITLES: Record<ProviderGoal["status"], string> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  blocked: "Goal blocked",
  usage_limited: "Goal hit a usage limit",
  budget_limited: "Goal reached its token budget",
  complete: "Goal complete",
};

function formatGoalTokens(tokens: number): string {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

/**
 * Status line for a native `/goal`, shared by the desktop renderer and web client.
 * An active goal on an idle thread (Claude after Stop) is set, not pursued.
 */
export function presentProviderGoal(
  goal: ProviderGoal,
  working: boolean,
): ProviderGoalPresentation {
  const usage: Array<string> = [];
  if (goal.tokensUsed !== undefined && goal.tokensUsed > 0) {
    usage.push(
      goal.tokenBudget == null
        ? `${formatGoalTokens(goal.tokensUsed)} tokens`
        : `${formatGoalTokens(goal.tokensUsed)} / ${formatGoalTokens(goal.tokenBudget)} tokens`,
    );
  }
  if (goal.timeUsedSeconds !== undefined && goal.timeUsedSeconds >= 60) {
    usage.push(formatDuration(goal.timeUsedSeconds * 1_000));
  }
  if (goal.checks !== undefined && goal.checks > 0) {
    usage.push(`${goal.checks} ${goal.checks === 1 ? "check" : "checks"}`);
  }
  return {
    title: goal.status === "active" && !working ? "Goal set" : PROVIDER_GOAL_TITLES[goal.status],
    objective: goal.objective,
    usage: usage.length === 0 ? null : usage.join(" · "),
    canResume: goal.status !== "active" && goal.status !== "complete",
  };
}

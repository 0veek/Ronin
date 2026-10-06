import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ProviderGoal } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type * as CodexSchema from "effect-codex-app-server/schema";

// In SDK mode Claude reports `/goal` only through the transcript (its
// `active_goal` event is remote-only): synthetic command output names the
// goal, and each unmet evaluator check returns as Stop hook feedback.
const CLAUDE_GOAL_SET_PREFIX = "Goal set: ";
const CLAUDE_GOAL_ACTIVE = /^Goal active: ([\s\S]+?) \((?:not yet evaluated|(\d+) turns?)\)/u;

/**
 * The goal after one root SDK frame, or undefined when the frame says nothing
 * about it. Completion has no frame of its own; see finalizeActiveTurn.
 */
export function nextClaudeGoal(
  current: ProviderGoal | null,
  message: SDKMessage,
): ProviderGoal | null | undefined {
  if (message.type === "assistant") {
    if (message.parent_tool_use_id !== null || message.message.model !== "<synthetic>") {
      return undefined;
    }
    const text = message.message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("")
      .trim();
    if (text.startsWith(CLAUDE_GOAL_SET_PREFIX)) {
      const objective = text.slice(CLAUDE_GOAL_SET_PREFIX.length).trim();
      return objective.length === 0 ? undefined : { objective, status: "active", checks: 0 };
    }
    if (text.startsWith("Goal cleared: ") || text.startsWith("No goal set")) return null;
    const active = CLAUDE_GOAL_ACTIVE.exec(text);
    if (active?.[1] === undefined) return undefined;
    return {
      ...(current?.objective === active[1] ? current : {}),
      objective: active[1],
      status: "active",
      checks: Number(active[2] ?? 0),
    };
  }
  if (
    message.type !== "user" ||
    message.parent_tool_use_id !== null ||
    message.isSynthetic !== true ||
    current === null
  ) {
    return undefined;
  }
  const prefix = `Stop hook feedback:\n[${current.objective}]: `;
  const content = message.message.content;
  const text =
    typeof content === "string"
      ? content
      : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
  if (!text.startsWith(prefix)) return undefined;
  return {
    ...current,
    status: "active",
    checks: (current.checks ?? 0) + 1,
    lastCheck: text.slice(prefix.length).trim(),
  };
}

export type CodexGoalCommand =
  | { readonly type: "show" }
  | { readonly type: "clear" }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "set"; readonly objective: string };

/**
 * Parses a `/goal` message the way the Codex TUI does: `clear`, `pause` and
 * `resume` control the current goal, a bare `/goal` shows it, and any other
 * text becomes the new objective. Returns null for every other message.
 */
export function parseCodexGoalCommand(text: string): CodexGoalCommand | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (match === null) return null;
  const argument = (match[1] ?? "").trim();
  switch (argument.toLowerCase()) {
    case "":
    case "edit":
      return { type: "show" };
    case "clear":
      return { type: "clear" };
    case "pause":
      return { type: "pause" };
    case "resume":
      return { type: "resume" };
    default:
      return { type: "set", objective: argument };
  }
}

type CodexThreadGoal = CodexSchema.V2ThreadGoalUpdatedNotification["goal"];

const CODEX_GOAL_STATUSES = {
  active: "active",
  paused: "paused",
  blocked: "blocked",
  usageLimited: "usage_limited",
  budgetLimited: "budget_limited",
  complete: "complete",
} as const satisfies Record<CodexThreadGoal["status"], ProviderGoal["status"]>;

export function providerGoalFromCodex(goal: CodexThreadGoal): ProviderGoal | null {
  const objective = goal.objective.trim();
  if (objective.length === 0) return null;
  return {
    objective,
    status: CODEX_GOAL_STATUSES[goal.status],
    tokensUsed: Math.max(0, goal.tokensUsed),
    tokenBudget: goal.tokenBudget ?? null,
    timeUsedSeconds: Math.max(0, goal.timeUsedSeconds),
  };
}

export const providerGoalsEqual = Schema.toEquivalence(Schema.NullOr(ProviderGoal));

export function describeCodexGoal(goal: ProviderGoal): string {
  return `Goal ${goal.status.replace("_", " ")}: ${goal.objective}`;
}

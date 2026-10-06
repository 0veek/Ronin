import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ProviderGoalStatus = Schema.Literals([
  "active",
  "paused",
  "blocked",
  "usage_limited",
  "budget_limited",
  "complete",
]);
export type ProviderGoalStatus = typeof ProviderGoalStatus.Type;

/** Provider-owned progress for a native goal, shared by the renderer and execution core. */
export const ProviderGoal = Schema.Struct({
  objective: TrimmedNonEmptyString,
  status: ProviderGoalStatus,
  /** Codex accounting across all native turns in the goal. */
  tokensUsed: Schema.optional(NonNegativeInt),
  tokenBudget: Schema.optional(Schema.NullOr(NonNegativeInt)),
  timeUsedSeconds: Schema.optional(NonNegativeInt),
  /** Claude evaluator checks that found the objective unmet. */
  checks: Schema.optional(NonNegativeInt),
  lastCheck: Schema.optional(Schema.String),
});
export type ProviderGoal = typeof ProviderGoal.Type;

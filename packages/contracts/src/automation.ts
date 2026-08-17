/**
 * Automations: work a project runs on a schedule without being asked.
 *
 * An automation is a saved prompt plus a rule for when to send it. Firing one
 * opens an ordinary thread in the project and starts an ordinary turn, so
 * everything downstream — the sidebar, checkpoints, diffs, provider switching
 * — works on it exactly as if a person had typed it. Nothing about a scheduled
 * turn is special once it has started.
 *
 * The schedule is deliberately not cron. Cron is a precise answer to a
 * question nobody asks in a GUI, and it makes the common cases ("every
 * weekday at 9") harder to write than the rare ones. The three shapes below
 * cover what people actually schedule, and each is directly editable in a
 * form.
 *
 * @module automation
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";
import { ThreadEnvMode } from "./environment.ts";

export const AutomationId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationId"));
export type AutomationId = typeof AutomationId.Type;

export const AutomationRunId = TrimmedNonEmptyString.pipe(Schema.brand("AutomationRunId"));
export type AutomationRunId = typeof AutomationRunId.Type;

/** Days of the week, Sunday-indexed to match `Date.getDay`. */
export const AutomationWeekday = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }));
export type AutomationWeekday = typeof AutomationWeekday.Type;

/**
 * Minutes past midnight, in the *server's* local time.
 *
 * Local rather than UTC because "every weekday at 9" means nine in the morning
 * where the machine is, and staying local is also what makes it survive a
 * daylight-saving change without drifting an hour.
 */
export const AutomationTimeOfDay = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 24 * 60 - 1 }),
);
export type AutomationTimeOfDay = typeof AutomationTimeOfDay.Type;

export const MIN_AUTOMATION_INTERVAL_MINUTES = 15;
export const MAX_AUTOMATION_INTERVAL_MINUTES = 60 * 24 * 30;

export const AutomationSchedule = Schema.Union([
  /**
   * Every N minutes from when it was last saved or last ran.
   *
   * Floored at fifteen minutes: an agent turn regularly runs longer than
   * that, and a schedule tighter than its own work produces a thread that is
   * never not running.
   */
  Schema.TaggedStruct("interval", {
    everyMinutes: Schema.Int.check(
      Schema.isBetween({
        minimum: MIN_AUTOMATION_INTERVAL_MINUTES,
        maximum: MAX_AUTOMATION_INTERVAL_MINUTES,
      }),
    ),
  }),
  /** At a time of day, on the chosen days. Empty `weekdays` means every day. */
  Schema.TaggedStruct("daily", {
    timeOfDay: AutomationTimeOfDay,
    weekdays: Schema.Array(AutomationWeekday),
  }),
  /** Once, at an instant. Disables itself after it fires. */
  Schema.TaggedStruct("once", {
    at: IsoDateTime,
  }),
]);
export type AutomationSchedule = typeof AutomationSchedule.Type;

export const AUTOMATION_MAX_PROMPT_CHARS = 20_000;
export const AUTOMATION_MAX_TITLE_CHARS = 120;

/** Consecutive start-failures before the scheduler pauses the automation. */
export const DEFAULT_AUTOMATION_STOP_AFTER_CONSECUTIVE_FAILURES = 3;

/**
 * Why an automation is off. Only the scheduler's own reasons live here —
 * the thread still owns what the agent did after a turn started.
 *
 * - `failures`: hit the consecutive start-failure threshold.
 * - `schedule`: a one-shot that already fired.
 * - `user`: the switch was turned off on purpose.
 */
export const AutomationDisabledReason = Schema.Literals(["failures", "schedule", "user"]);
export type AutomationDisabledReason = typeof AutomationDisabledReason.Type;

/**
 * How a run ended, from the scheduler's point of view.
 *
 * Only ever describes whether the turn *started*. What the agent then did is
 * the thread's business, and duplicating a turn's outcome here would be a
 * second source of truth that goes stale the moment anyone opens the thread.
 */
export const AutomationRunOutcome = Schema.Literals(["started", "skipped", "failed"]);
export type AutomationRunOutcome = typeof AutomationRunOutcome.Type;

export const AutomationRun = Schema.Struct({
  id: AutomationRunId,
  automationId: AutomationId,
  startedAt: IsoDateTime,
  outcome: AutomationRunOutcome,
  /** The thread the run opened. Null when it never got that far. */
  threadId: Schema.NullOr(ThreadId),
  /** Why a run was skipped or how it failed. Null on a clean start. */
  detail: Schema.NullOr(TrimmedNonEmptyString),
});
export type AutomationRun = typeof AutomationRun.Type;

export const Automation = Schema.Struct({
  id: AutomationId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(AUTOMATION_MAX_TITLE_CHARS)),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(AUTOMATION_MAX_PROMPT_CHARS)),
  schedule: AutomationSchedule,
  /**
   * Whether each run gets its own worktree.
   *
   * Defaults to a worktree for good reason: unattended work landing in the
   * checkout someone is using is the single worst thing an automation can do.
   */
  envMode: ThreadEnvMode,
  /** Null uses the project's default, exactly as a new thread would. */
  modelSelection: Schema.NullOr(ModelSelection),
  enabled: Schema.Boolean,
  /**
   * Consecutive failed *starts* allowed before the scheduler turns it off.
   * Null means keep retrying. Missing rows decode as the default of three.
   */
  stopAfterConsecutiveFailures: Schema.NullOr(PositiveInt).pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_AUTOMATION_STOP_AFTER_CONSECUTIVE_FAILURES)),
  ),
  consecutiveFailureCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  disabledReason: Schema.NullOr(AutomationDisabledReason).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  disabledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** When it last fired. Null before the first run. */
  lastRunAt: Schema.NullOr(IsoDateTime),
  /**
   * When it fires next, as the scheduler currently understands it. Null when
   * it is disabled or a `once` schedule has already gone.
   */
  nextRunAt: Schema.NullOr(IsoDateTime),
});
export type Automation = typeof Automation.Type;

export const AutomationListInput = Schema.Struct({
  /** Absent lists every project's automations. */
  projectId: Schema.optional(ProjectId),
});
export type AutomationListInput = typeof AutomationListInput.Type;

export const AutomationListResult = Schema.Struct({
  automations: Schema.Array(Automation),
});
export type AutomationListResult = typeof AutomationListResult.Type;

export const AutomationCreateInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(AUTOMATION_MAX_TITLE_CHARS)),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(AUTOMATION_MAX_PROMPT_CHARS)),
  schedule: AutomationSchedule,
  envMode: ThreadEnvMode,
  modelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  enabled: Schema.optional(Schema.Boolean),
  stopAfterConsecutiveFailures: Schema.optional(Schema.NullOr(PositiveInt)),
});
export type AutomationCreateInput = typeof AutomationCreateInput.Type;

/** Absent fields are left alone; this is a patch, not a replacement. */
export const AutomationUpdateInput = Schema.Struct({
  id: AutomationId,
  title: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(AUTOMATION_MAX_TITLE_CHARS)),
  ),
  prompt: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(AUTOMATION_MAX_PROMPT_CHARS)),
  ),
  schedule: Schema.optional(AutomationSchedule),
  envMode: Schema.optional(ThreadEnvMode),
  modelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  enabled: Schema.optional(Schema.Boolean),
  stopAfterConsecutiveFailures: Schema.optional(Schema.NullOr(PositiveInt)),
});
export type AutomationUpdateInput = typeof AutomationUpdateInput.Type;

export const AutomationMutationResult = Schema.Struct({
  automation: Automation,
});
export type AutomationMutationResult = typeof AutomationMutationResult.Type;

export const AutomationDeleteInput = Schema.Struct({
  id: AutomationId,
});
export type AutomationDeleteInput = typeof AutomationDeleteInput.Type;

export const AutomationDeleteResult = Schema.Struct({
  deleted: Schema.Boolean,
});
export type AutomationDeleteResult = typeof AutomationDeleteResult.Type;

export const AutomationRunNowInput = Schema.Struct({
  id: AutomationId,
});
export type AutomationRunNowInput = typeof AutomationRunNowInput.Type;

export const AutomationRunNowResult = Schema.Struct({
  run: AutomationRun,
});
export type AutomationRunNowResult = typeof AutomationRunNowResult.Type;

export const AUTOMATION_RUN_HISTORY_LIMIT = 50;

export const AutomationRunsInput = Schema.Struct({
  automationId: Schema.optional(AutomationId),
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(AUTOMATION_RUN_HISTORY_LIMIT)),
  ),
});
export type AutomationRunsInput = typeof AutomationRunsInput.Type;

export const AutomationRunsResult = Schema.Struct({
  runs: Schema.Array(AutomationRun),
});
export type AutomationRunsResult = typeof AutomationRunsResult.Type;

/**
 * Fold a scheduler outcome into the automation's durable failure policy.
 *
 * Skips never count. A successful start resets the streak, but only while the
 * automation is still enabled — a manual rerun of a disabled row keeps the
 * evidence until someone turns the switch back on. Crossing the threshold
 * pauses the schedule and records why.
 */
export function applyAutomationRunOutcome(input: {
  readonly automation: Automation;
  readonly outcome: AutomationRun["outcome"];
  readonly nowIso: string;
}): Automation {
  const { automation, outcome, nowIso } = input;
  if (outcome === "skipped") {
    return automation;
  }

  if (outcome === "started") {
    if (!automation.enabled || automation.consecutiveFailureCount === 0) {
      return automation;
    }
    return {
      ...automation,
      consecutiveFailureCount: 0,
    };
  }

  if (!automation.enabled) {
    return automation;
  }

  const consecutiveFailureCount = automation.consecutiveFailureCount + 1;
  const threshold = automation.stopAfterConsecutiveFailures;
  const hitThreshold = threshold !== null && consecutiveFailureCount >= threshold;
  if (!hitThreshold) {
    return { ...automation, consecutiveFailureCount };
  }

  return {
    ...automation,
    enabled: false,
    nextRunAt: null,
    consecutiveFailureCount,
    disabledReason: "failures",
    disabledAt: nowIso,
  };
}

/** Apply the enable switch. Turning it on is the only way out of a failure stop. */
export function applyAutomationEnabledChange(input: {
  readonly automation: Automation;
  readonly enabled: boolean;
  readonly nowIso: string;
}): Automation {
  if (input.enabled) {
    return {
      ...input.automation,
      enabled: true,
      consecutiveFailureCount: 0,
      disabledReason: null,
      disabledAt: null,
    };
  }
  return {
    ...input.automation,
    enabled: false,
    nextRunAt: null,
    disabledReason: input.automation.disabledReason ?? "user",
    disabledAt: input.automation.disabledAt ?? input.nowIso,
  };
}

export class AutomationError extends Schema.TaggedErrorClass<AutomationError>()("AutomationError", {
  reason: Schema.Literals(["notFound", "projectNotFound", "readFailed", "writeFailed"]),
  detail: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Automation failed (${this.reason}): ${this.detail}`;
  }
}

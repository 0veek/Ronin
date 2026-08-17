/**
 * AutomationScheduler - the clock behind automations.
 *
 * One fiber, one interval, one query. It does not hold a timer per automation:
 * timers do not survive a suspend intact, and a machine that wakes up owing
 * three timers fires them in whatever order the event loop happens to drain.
 * Polling a `next_run_at` index instead means the schedule is whatever the
 * database says it is, which is also what makes the catch-up rule in
 * `automationSchedule.ts` possible.
 *
 * @module AutomationScheduler
 */
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";

import { forkParked } from "../serverActivation.ts";
import { AutomationService } from "./AutomationService.ts";

/**
 * How often the due query runs.
 *
 * A minute is finer than the finest schedule the contract allows (fifteen
 * minutes), so nothing fires late because of the poll itself, and the query is
 * a partial-index lookup that is empty on almost every tick.
 */
export const AUTOMATION_TICK_INTERVAL_MS = 60_000;

export interface AutomationSchedulerShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class AutomationScheduler extends Context.Service<
  AutomationScheduler,
  AutomationSchedulerShape
>()("t3/automation/AutomationScheduler") {}

export const make = Effect.gen(function* () {
  const automations = yield* AutomationService;

  const start: AutomationSchedulerShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      automations.tick.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("automation scheduler tick failed", { cause: Cause.pretty(cause) }),
        ),
        // `spaced` rather than `fixed`: a tick that overruns should not have
        // the next one waiting behind it, and a burst of catch-up ticks after
        // a long tick is exactly the stampede the catch-up window exists to
        // avoid.
        Effect.repeat(Schedule.spaced(`${AUTOMATION_TICK_INTERVAL_MS} millis`)),
        Effect.asVoid,
      ),
    );
  });

  return AutomationScheduler.of({ start });
});

export const layer = Layer.effect(AutomationScheduler, make);

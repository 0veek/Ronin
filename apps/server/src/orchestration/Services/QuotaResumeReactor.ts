/**
 * QuotaResumeReactor - watches turns for the one failure that is worth
 * waiting out.
 *
 * @module QuotaResumeReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface QuotaResumeReactorShape {
  /**
   * Start watching domain events for spent subscription windows.
   *
   * The returned effect must be run in a scope so the worker fiber can be
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  /** Test-only: settle in-flight event processing. */
  readonly drain: Effect.Effect<void>;
}

export class QuotaResumeReactor extends Context.Service<
  QuotaResumeReactor,
  QuotaResumeReactorShape
>()("t3/orchestration/Services/QuotaResumeReactor") {}

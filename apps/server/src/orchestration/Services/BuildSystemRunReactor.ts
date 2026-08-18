/**
 * BuildSystemRunReactor - watches turn completions for active team runs.
 *
 * @module BuildSystemRunReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface BuildSystemRunReactorShape {
  /**
   * Start watching domain events for build-system run threads.
   *
   * The returned effect must be run in a scope so the worker fiber can be
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  /** Test-only: settle in-flight event processing. */
  readonly drain: Effect.Effect<void>;
}

export class BuildSystemRunReactor extends Context.Service<
  BuildSystemRunReactor,
  BuildSystemRunReactorShape
>()("t3/orchestration/Services/BuildSystemRunReactor") {}

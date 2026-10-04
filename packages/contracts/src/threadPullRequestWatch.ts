import * as Schema from "effect/Schema";
import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ThreadPullRequestWatch = Schema.Struct({
  startedAt: IsoDateTime,
  /** Head commit at the last pass; null where the host does not report one. */
  headSha: Schema.NullOr(TrimmedNonEmptyString),
  /** Failed checks on that commit the agent was told about; a rerun that fails again is news. */
  failedChecks: Schema.Array(TrimmedNonEmptyString),
  /** The agent was told the required checks on that commit passed. */
  passed: Schema.Boolean,
  /** Remarks from others created up to this host time were reported. */
  remarksThrough: IsoDateTime,
  /** Remarks created exactly at `remarksThrough` that were reported, so a late one still counts. */
  remarkIds: Schema.Array(TrimmedNonEmptyString),
  conflicting: Schema.Boolean,
  /** Comment-only wakes in a row. Watching stops at a limit, so bots cannot loop it. */
  wakes: NonNegativeInt,
});
export type ThreadPullRequestWatch = typeof ThreadPullRequestWatch.Type;

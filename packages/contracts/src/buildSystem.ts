/**
 * Build systems: a team of models that works one task together.
 *
 * A build system names an orchestrator and a handful of teammates, each a role
 * with its own model and standing instructions. Running one opens an ordinary
 * thread per role in the project and starts ordinary turns, so the sidebar,
 * checkpoints, diffs and approvals all work on them unchanged. What makes it a
 * team is only the coordinator: it reads the directive the orchestrator ends
 * its turn with, runs the teammate that was asked for, and hands the result
 * back.
 *
 * The team is orchestrator-led rather than a fixed pipeline. A pipeline is easy
 * to draw and wrong the moment the work does not fit the drawing — the second
 * review pass, the fix that needs the implementer again. Letting the lead model
 * decide who runs next costs a parse and buys every shape of collaboration.
 *
 * Configuration, not history: like automations, these live in their own tables.
 * A build system is edited in place, has no meaningful ordering against thread
 * events, and replaying the event log must never re-run a team.
 *
 * @module buildSystem
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

export const BuildSystemId = TrimmedNonEmptyString.pipe(Schema.brand("BuildSystemId"));
export type BuildSystemId = typeof BuildSystemId.Type;

export const BuildSystemRoleId = TrimmedNonEmptyString.pipe(Schema.brand("BuildSystemRoleId"));
export type BuildSystemRoleId = typeof BuildSystemRoleId.Type;

export const BuildSystemRunId = TrimmedNonEmptyString.pipe(Schema.brand("BuildSystemRunId"));
export type BuildSystemRunId = typeof BuildSystemRunId.Type;

export const BuildSystemRunStepId = TrimmedNonEmptyString.pipe(
  Schema.brand("BuildSystemRunStepId"),
);
export type BuildSystemRunStepId = typeof BuildSystemRunStepId.Type;

export const BUILD_SYSTEM_MAX_NAME_CHARS = 80;
export const BUILD_SYSTEM_MAX_DESCRIPTION_CHARS = 400;
export const BUILD_SYSTEM_MAX_ROLE_NAME_CHARS = 40;
export const BUILD_SYSTEM_MAX_INSTRUCTIONS_CHARS = 8_000;
export const BUILD_SYSTEM_MAX_TASK_CHARS = 20_000;

/**
 * Teammates per system.
 *
 * Six is not a technical limit. Past it the roster no longer fits in the
 * orchestrator's preamble as something it can reason about, and every extra
 * role widens the choice it has to make correctly on every turn.
 */
export const BUILD_SYSTEM_MAX_TEAMMATES = 6;

/**
 * Delegations before a run stops itself.
 *
 * A team that has handed work around twenty times without declaring itself done
 * is looping, and the cost of a loop is real tokens against somebody's
 * subscription. The cap is configurable because a large migration legitimately
 * needs more.
 */
export const DEFAULT_BUILD_SYSTEM_MAX_DELEGATIONS = 20;
export const BUILD_SYSTEM_MAX_DELEGATIONS_LIMIT = 200;

/** Malformed directives tolerated in a row before the run fails. */
export const BUILD_SYSTEM_MAX_CONSECUTIVE_NUDGES = 2;

export const BUILD_SYSTEM_RUN_HISTORY_LIMIT = 50;

/** The fence tag the orchestrator closes each turn with. */
export const BUILD_SYSTEM_DIRECTIVE_FENCE = "t3-directive";

export const BuildSystemRoleName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(BUILD_SYSTEM_MAX_ROLE_NAME_CHARS),
);

export const BuildSystemInstructions = TrimmedNonEmptyString.check(
  Schema.isMaxLength(BUILD_SYSTEM_MAX_INSTRUCTIONS_CHARS),
);

/**
 * One teammate.
 *
 * `name` is both the label and the key the orchestrator delegates by, which is
 * why it is unique within a system: a directive naming a role that matches two
 * rows has no correct answer.
 */
export const BuildSystemRole = Schema.Struct({
  id: BuildSystemRoleId,
  name: BuildSystemRoleName,
  /** Standing brief, prepended to every task this role is handed. */
  instructions: Schema.NullOr(BuildSystemInstructions),
  modelSelection: ModelSelection,
  /**
   * Hold the run and ask before this role is allowed to work.
   *
   * The point of a gate is the roles you want to see coming — the one that
   * rewrites migrations, the one that pushes.
   */
  gate: Schema.Boolean,
});
export type BuildSystemRole = typeof BuildSystemRole.Type;

export const BuildSystemOrchestrator = Schema.Struct({
  modelSelection: ModelSelection,
  instructions: Schema.NullOr(BuildSystemInstructions),
});
export type BuildSystemOrchestrator = typeof BuildSystemOrchestrator.Type;

export const BuildSystem = Schema.Struct({
  id: BuildSystemId,
  projectId: ProjectId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(BUILD_SYSTEM_MAX_NAME_CHARS)),
  description: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(BUILD_SYSTEM_MAX_DESCRIPTION_CHARS)),
  ),
  orchestrator: BuildSystemOrchestrator,
  teammates: Schema.Array(BuildSystemRole),
  maxDelegations: PositiveInt.check(
    Schema.isLessThanOrEqualTo(BUILD_SYSTEM_MAX_DELEGATIONS_LIMIT),
  ).pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_BUILD_SYSTEM_MAX_DELEGATIONS))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BuildSystem = typeof BuildSystem.Type;

/**
 * Where a run is.
 *
 * - `starting`: opening the orchestrator's thread.
 * - `orchestrating`: the orchestrator is thinking; its directive comes next.
 * - `waiting-gate`: a gated role was asked for and needs a person to say yes.
 * - `delegating`: a teammate is working.
 * - `waiting-user`: the orchestrator asked a question and cannot proceed.
 * - `completed` / `failed` / `cancelled`: terminal.
 */
export const BuildSystemRunStatus = Schema.Literals([
  "starting",
  "orchestrating",
  "waiting-gate",
  "delegating",
  "waiting-user",
  "completed",
  "failed",
  "cancelled",
]);
export type BuildSystemRunStatus = typeof BuildSystemRunStatus.Type;

const TERMINAL_RUN_STATUSES: ReadonlySet<BuildSystemRunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

/** Whether the coordinator still owns this run. */
export function isBuildSystemRunActive(status: BuildSystemRunStatus): boolean {
  return !TERMINAL_RUN_STATUSES.has(status);
}

/** Whether the run is stopped waiting for a person rather than for a model. */
export function isBuildSystemRunAwaitingUser(status: BuildSystemRunStatus): boolean {
  return status === "waiting-gate" || status === "waiting-user";
}

/**
 * What a paused run is waiting for.
 *
 * Carried on the run rather than inferred from the last step so that a client
 * rendering the prompt never has to replay history to know what it is asking.
 */
export const BuildSystemRunPending = Schema.Union([
  Schema.TaggedStruct("gate", {
    roleId: BuildSystemRoleId,
    roleName: BuildSystemRoleName,
    task: TrimmedNonEmptyString,
    context: Schema.NullOr(TrimmedNonEmptyString),
  }),
  Schema.TaggedStruct("question", {
    question: TrimmedNonEmptyString,
  }),
]);
export type BuildSystemRunPending = typeof BuildSystemRunPending.Type;

/** Which thread belongs to which role, so a teammate keeps its session. */
export const BuildSystemRunRoleThread = Schema.Struct({
  roleId: BuildSystemRoleId,
  threadId: ThreadId,
});
export type BuildSystemRunRoleThread = typeof BuildSystemRunRoleThread.Type;

export const BuildSystemRun = Schema.Struct({
  id: BuildSystemRunId,
  buildSystemId: BuildSystemId,
  projectId: ProjectId,
  /**
   * The team exactly as it was when the run started.
   *
   * Snapshotted because editing a build system mid-run would otherwise change
   * the rules under a conversation that already happened — and because a run
   * has to stay readable after its build system is deleted.
   */
  config: BuildSystem,
  task: TrimmedNonEmptyString.check(Schema.isMaxLength(BUILD_SYSTEM_MAX_TASK_CHARS)),
  /** Null only in the moment between recording the run and opening its thread. */
  orchestratorThreadId: Schema.NullOr(ThreadId),
  roleThreads: Schema.Array(BuildSystemRunRoleThread),
  status: BuildSystemRunStatus,
  pending: Schema.NullOr(BuildSystemRunPending),
  delegationCount: NonNegativeInt,
  /** The orchestrator's closing summary. Null until it declares itself done. */
  summary: Schema.NullOr(TrimmedNonEmptyString),
  /** Why it failed, in a sentence a person can act on. */
  failureDetail: Schema.NullOr(TrimmedNonEmptyString),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  settledAt: Schema.NullOr(IsoDateTime),
});
export type BuildSystemRun = typeof BuildSystemRun.Type;

/**
 * One entry in a run's timeline.
 *
 * Kept as its own rows rather than derived from the threads because the
 * interesting sequence — who was asked to do what, and what came back — is
 * spread across several threads and would otherwise have to be reassembled by
 * every reader.
 */
export const BuildSystemRunStepKind = Schema.Literals([
  "delegation",
  "report",
  "gate-approved",
  "gate-denied",
  "question",
  "answer",
  "nudge",
  "completed",
  "failed",
  "cancelled",
]);
export type BuildSystemRunStepKind = typeof BuildSystemRunStepKind.Type;

export const BuildSystemRunStep = Schema.Struct({
  id: BuildSystemRunStepId,
  runId: BuildSystemRunId,
  sequence: NonNegativeInt,
  kind: BuildSystemRunStepKind,
  roleId: Schema.NullOr(BuildSystemRoleId),
  roleName: Schema.NullOr(BuildSystemRoleName),
  threadId: Schema.NullOr(ThreadId),
  detail: Schema.NullOr(TrimmedNonEmptyString),
  at: IsoDateTime,
});
export type BuildSystemRunStep = typeof BuildSystemRunStep.Type;

export const BuildSystemRoleInput = Schema.Struct({
  /** Absent on a new role; the server mints the id. */
  id: Schema.optional(BuildSystemRoleId),
  name: BuildSystemRoleName,
  instructions: Schema.optional(Schema.NullOr(BuildSystemInstructions)),
  modelSelection: ModelSelection,
  gate: Schema.optional(Schema.Boolean),
});
export type BuildSystemRoleInput = typeof BuildSystemRoleInput.Type;

export const BuildSystemOrchestratorInput = Schema.Struct({
  modelSelection: ModelSelection,
  instructions: Schema.optional(Schema.NullOr(BuildSystemInstructions)),
});
export type BuildSystemOrchestratorInput = typeof BuildSystemOrchestratorInput.Type;

export const BuildSystemListInput = Schema.Struct({
  /** Absent lists every project's build systems. */
  projectId: Schema.optional(ProjectId),
});
export type BuildSystemListInput = typeof BuildSystemListInput.Type;

export const BuildSystemListResult = Schema.Struct({
  buildSystems: Schema.Array(BuildSystem),
});
export type BuildSystemListResult = typeof BuildSystemListResult.Type;

export const BuildSystemCreateInput = Schema.Struct({
  projectId: ProjectId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(BUILD_SYSTEM_MAX_NAME_CHARS)),
  description: Schema.optional(
    Schema.NullOr(
      TrimmedNonEmptyString.check(Schema.isMaxLength(BUILD_SYSTEM_MAX_DESCRIPTION_CHARS)),
    ),
  ),
  orchestrator: BuildSystemOrchestratorInput,
  teammates: Schema.Array(BuildSystemRoleInput),
  maxDelegations: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(BUILD_SYSTEM_MAX_DELEGATIONS_LIMIT)),
  ),
});
export type BuildSystemCreateInput = typeof BuildSystemCreateInput.Type;

/** Absent fields are left alone; this is a patch, not a replacement. */
export const BuildSystemUpdateInput = Schema.Struct({
  id: BuildSystemId,
  name: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(BUILD_SYSTEM_MAX_NAME_CHARS)),
  ),
  description: Schema.optional(
    Schema.NullOr(
      TrimmedNonEmptyString.check(Schema.isMaxLength(BUILD_SYSTEM_MAX_DESCRIPTION_CHARS)),
    ),
  ),
  orchestrator: Schema.optional(BuildSystemOrchestratorInput),
  teammates: Schema.optional(Schema.Array(BuildSystemRoleInput)),
  maxDelegations: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(BUILD_SYSTEM_MAX_DELEGATIONS_LIMIT)),
  ),
});
export type BuildSystemUpdateInput = typeof BuildSystemUpdateInput.Type;

export const BuildSystemMutationResult = Schema.Struct({
  buildSystem: BuildSystem,
});
export type BuildSystemMutationResult = typeof BuildSystemMutationResult.Type;

export const BuildSystemDeleteInput = Schema.Struct({
  id: BuildSystemId,
});
export type BuildSystemDeleteInput = typeof BuildSystemDeleteInput.Type;

export const BuildSystemDeleteResult = Schema.Struct({
  deleted: Schema.Boolean,
});
export type BuildSystemDeleteResult = typeof BuildSystemDeleteResult.Type;

export const BuildSystemRunStartInput = Schema.Struct({
  buildSystemId: BuildSystemId,
  task: TrimmedNonEmptyString.check(Schema.isMaxLength(BUILD_SYSTEM_MAX_TASK_CHARS)),
});
export type BuildSystemRunStartInput = typeof BuildSystemRunStartInput.Type;

export const BuildSystemRunCancelInput = Schema.Struct({
  runId: BuildSystemRunId,
});
export type BuildSystemRunCancelInput = typeof BuildSystemRunCancelInput.Type;

export const BuildSystemRunResolveGateInput = Schema.Struct({
  runId: BuildSystemRunId,
  approved: Schema.Boolean,
  /** Sent back to the orchestrator, which is the whole value of a denial. */
  note: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type BuildSystemRunResolveGateInput = typeof BuildSystemRunResolveGateInput.Type;

export const BuildSystemRunReplyInput = Schema.Struct({
  runId: BuildSystemRunId,
  reply: TrimmedNonEmptyString.check(Schema.isMaxLength(BUILD_SYSTEM_MAX_TASK_CHARS)),
});
export type BuildSystemRunReplyInput = typeof BuildSystemRunReplyInput.Type;

export const BuildSystemRunMutationResult = Schema.Struct({
  run: BuildSystemRun,
});
export type BuildSystemRunMutationResult = typeof BuildSystemRunMutationResult.Type;

export const BuildSystemRunsInput = Schema.Struct({
  buildSystemId: Schema.optional(BuildSystemId),
  projectId: Schema.optional(ProjectId),
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(BUILD_SYSTEM_RUN_HISTORY_LIMIT)),
  ),
});
export type BuildSystemRunsInput = typeof BuildSystemRunsInput.Type;

export const BuildSystemRunsResult = Schema.Struct({
  runs: Schema.Array(BuildSystemRun),
});
export type BuildSystemRunsResult = typeof BuildSystemRunsResult.Type;

export const BuildSystemRunGetInput = Schema.Struct({
  runId: BuildSystemRunId,
});
export type BuildSystemRunGetInput = typeof BuildSystemRunGetInput.Type;

export const BuildSystemRunGetResult = Schema.Struct({
  run: Schema.NullOr(BuildSystemRun),
  steps: Schema.Array(BuildSystemRunStep),
});
export type BuildSystemRunGetResult = typeof BuildSystemRunGetResult.Type;

/**
 * The key a role name is matched by.
 *
 * Case and spacing are flattened because the orchestrator writes the name from
 * memory of a roster it was shown once, and failing a whole delegation over
 * "Reviewer" versus "reviewer" — or one space versus two — would be pedantry
 * with a token cost. Lookup and the uniqueness check share this so a pair of
 * names that collide at delegation time cannot be saved in the first place.
 */
function roleNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Find the role a directive is asking for. */
export function findBuildSystemRole(
  teammates: ReadonlyArray<BuildSystemRole>,
  name: string,
): BuildSystemRole | null {
  const wanted = roleNameKey(name);
  return teammates.find((role) => roleNameKey(role.name) === wanted) ?? null;
}

/** Roles whose names collide once case and spacing are ignored. */
export function duplicateBuildSystemRoleNames(
  teammates: ReadonlyArray<{ readonly name: string }>,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const role of teammates) {
    const key = roleNameKey(role.name);
    if (key.length === 0) continue;
    if (seen.has(key)) duplicates.add(role.name.trim());
    seen.add(key);
  }
  return [...duplicates];
}

export class BuildSystemError extends Schema.TaggedErrorClass<BuildSystemError>()(
  "BuildSystemError",
  {
    reason: Schema.Literals([
      "notFound",
      "projectNotFound",
      "invalid",
      "runNotFound",
      "runNotActive",
      "runInProgress",
      "readFailed",
      "writeFailed",
    ]),
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Build system failed (${this.reason}): ${this.detail}`;
  }
}

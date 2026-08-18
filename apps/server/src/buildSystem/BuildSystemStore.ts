/**
 * BuildSystemStore - SQL access for build systems, their runs, and run steps.
 *
 * Deliberately dumb, like `AutomationStore`: it reads and writes rows and knows
 * nothing about how a team is coordinated. All the deciding lives in
 * `BuildSystemService.ts` and all the parsing in `directive.ts`, so the
 * logic that actually goes wrong is testable without a database.
 *
 * @module BuildSystemStore
 */
import {
  BuildSystem,
  BuildSystemError,
  BuildSystemId,
  BuildSystemOrchestrator,
  BuildSystemRole,
  BuildSystemRun,
  BuildSystemRunId,
  BuildSystemRunPending,
  BuildSystemRunRoleThread,
  BuildSystemRunStatus,
  BuildSystemRunStep,
  BuildSystemRunStepId,
  BuildSystemRunStepKind,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const decodeOrchestrator = Schema.decodeUnknownSync(BuildSystemOrchestrator);
const decodeTeammates = Schema.decodeUnknownSync(Schema.Array(BuildSystemRole));
const decodeConfig = Schema.decodeUnknownSync(BuildSystem);
const decodePending = Schema.decodeUnknownSync(BuildSystemRunPending);
const decodeRoleThreads = Schema.decodeUnknownSync(Schema.Array(BuildSystemRunRoleThread));

interface BuildSystemDbRow {
  readonly buildSystemId: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly orchestratorJson: string;
  readonly teammatesJson: string;
  readonly maxDelegations: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface BuildSystemRunDbRow {
  readonly runId: string;
  readonly buildSystemId: string;
  readonly projectId: string;
  readonly configJson: string;
  readonly task: string;
  readonly orchestratorThreadId: string | null;
  readonly roleThreadsJson: string;
  readonly status: string;
  readonly pendingJson: string | null;
  readonly delegationCount: number;
  readonly summary: string | null;
  readonly failureDetail: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly settledAt: string | null;
}

interface BuildSystemRunStepDbRow {
  readonly stepId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly roleId: string | null;
  readonly roleName: string | null;
  readonly threadId: string | null;
  readonly detail: string | null;
  readonly at: string;
}

const BUILD_SYSTEM_COLUMNS = `
  build_system_id AS "buildSystemId",
  project_id AS "projectId",
  name,
  description,
  orchestrator_json AS "orchestratorJson",
  teammates_json AS "teammatesJson",
  max_delegations AS "maxDelegations",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const RUN_COLUMNS = `
  run_id AS "runId",
  build_system_id AS "buildSystemId",
  project_id AS "projectId",
  config_json AS "configJson",
  task,
  orchestrator_thread_id AS "orchestratorThreadId",
  role_threads_json AS "roleThreadsJson",
  status,
  pending_json AS "pendingJson",
  delegation_count AS "delegationCount",
  summary,
  failure_detail AS "failureDetail",
  started_at AS "startedAt",
  updated_at AS "updatedAt",
  settled_at AS "settledAt"
`;

function toBuildSystem(row: BuildSystemDbRow): BuildSystem {
  return {
    id: BuildSystemId.make(row.buildSystemId),
    projectId: ProjectId.make(row.projectId),
    name: row.name,
    description: row.description,
    orchestrator: decodeOrchestrator(JSON.parse(row.orchestratorJson)),
    teammates: decodeTeammates(JSON.parse(row.teammatesJson)),
    maxDelegations: row.maxDelegations,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRun(row: BuildSystemRunDbRow): BuildSystemRun {
  return {
    id: BuildSystemRunId.make(row.runId),
    buildSystemId: BuildSystemId.make(row.buildSystemId),
    projectId: ProjectId.make(row.projectId),
    config: decodeConfig(JSON.parse(row.configJson)),
    task: row.task,
    orchestratorThreadId:
      row.orchestratorThreadId === null ? null : ThreadId.make(row.orchestratorThreadId),
    roleThreads: decodeRoleThreads(JSON.parse(row.roleThreadsJson)),
    status: row.status as BuildSystemRunStatus,
    pending: row.pendingJson === null ? null : decodePending(JSON.parse(row.pendingJson)),
    delegationCount: row.delegationCount,
    summary: row.summary,
    failureDetail: row.failureDetail,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    settledAt: row.settledAt,
  };
}

function toStep(row: BuildSystemRunStepDbRow): BuildSystemRunStep {
  return {
    id: BuildSystemRunStepId.make(row.stepId),
    runId: BuildSystemRunId.make(row.runId),
    sequence: row.sequence,
    kind: row.kind as BuildSystemRunStepKind,
    roleId: row.roleId === null ? null : (row.roleId as BuildSystemRunStep["roleId"]),
    roleName: row.roleName,
    threadId: row.threadId === null ? null : ThreadId.make(row.threadId),
    detail: row.detail,
    at: row.at,
  };
}

export interface BuildSystemStoreShape {
  readonly list: (projectId: ProjectId | null) => Effect.Effect<ReadonlyArray<BuildSystem>>;
  readonly get: (id: BuildSystemId) => Effect.Effect<Option.Option<BuildSystem>>;
  /** Fails loudly: a save that did not happen must never look like one that did. */
  readonly upsert: (buildSystem: BuildSystem) => Effect.Effect<void, BuildSystemError>;
  readonly remove: (id: BuildSystemId) => Effect.Effect<boolean, BuildSystemError>;
  readonly upsertRun: (run: BuildSystemRun) => Effect.Effect<void, BuildSystemError>;
  readonly getRun: (id: BuildSystemRunId) => Effect.Effect<Option.Option<BuildSystemRun>>;
  readonly listRuns: (input: {
    readonly buildSystemId: BuildSystemId | null;
    readonly projectId: ProjectId | null;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<BuildSystemRun>>;
  /** Runs the coordinator still owns, oldest first. The startup recovery query. */
  readonly listActiveRuns: () => Effect.Effect<ReadonlyArray<BuildSystemRun>>;
  /** The active run a thread belongs to, if any. Drives every turn-end decision. */
  readonly findActiveRunForThread: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<BuildSystemRun>>;
  readonly appendStep: (step: BuildSystemRunStep) => Effect.Effect<void, BuildSystemError>;
  readonly listSteps: (runId: BuildSystemRunId) => Effect.Effect<ReadonlyArray<BuildSystemRunStep>>;
  readonly nextStepSequence: (runId: BuildSystemRunId) => Effect.Effect<number>;
}

export class BuildSystemStore extends Context.Service<BuildSystemStore, BuildSystemStoreShape>()(
  "t3/buildSystem/BuildSystemStore",
) {}

/**
 * Turn a failed write into a `BuildSystemError` rather than a silent success.
 *
 * Reads stay tolerant — an unreadable list renders as empty and the next poll
 * recovers — but a write that vanished would leave a run whose recorded state
 * disagrees with the threads it is driving.
 */
const writeFailed =
  (detail: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, BuildSystemError, R> =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.fail(
          new BuildSystemError({ reason: "writeFailed", detail, cause: Cause.squash(cause) }),
        ),
      ),
    );

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const list = (projectId: ProjectId | null) =>
    Effect.gen(function* () {
      const rows = yield* projectId === null
        ? sql<BuildSystemDbRow>`
            SELECT ${sql.literal(BUILD_SYSTEM_COLUMNS)}
            FROM build_systems
            ORDER BY created_at ASC, build_system_id ASC
          `
        : sql<BuildSystemDbRow>`
            SELECT ${sql.literal(BUILD_SYSTEM_COLUMNS)}
            FROM build_systems
            WHERE project_id = ${projectId}
            ORDER BY created_at ASC, build_system_id ASC
          `;
      return rows.map(toBuildSystem);
    }).pipe(Effect.orElseSucceed(() => []));

  const get = (id: BuildSystemId) =>
    Effect.gen(function* () {
      const rows = yield* sql<BuildSystemDbRow>`
        SELECT ${sql.literal(BUILD_SYSTEM_COLUMNS)}
        FROM build_systems
        WHERE build_system_id = ${id}
      `;
      const row = rows[0];
      return row === undefined ? Option.none<BuildSystem>() : Option.some(toBuildSystem(row));
    }).pipe(Effect.orElseSucceed(() => Option.none<BuildSystem>()));

  const upsert = (buildSystem: BuildSystem) =>
    sql`
      INSERT INTO build_systems (
        build_system_id,
        project_id,
        name,
        description,
        orchestrator_json,
        teammates_json,
        max_delegations,
        created_at,
        updated_at
      )
      VALUES (
        ${buildSystem.id},
        ${buildSystem.projectId},
        ${buildSystem.name},
        ${buildSystem.description},
        ${JSON.stringify(buildSystem.orchestrator)},
        ${JSON.stringify(buildSystem.teammates)},
        ${buildSystem.maxDelegations},
        ${buildSystem.createdAt},
        ${buildSystem.updatedAt}
      )
      ON CONFLICT (build_system_id)
      DO UPDATE SET
        project_id = excluded.project_id,
        name = excluded.name,
        description = excluded.description,
        orchestrator_json = excluded.orchestrator_json,
        teammates_json = excluded.teammates_json,
        max_delegations = excluded.max_delegations,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid, writeFailed("The build system could not be saved."));

  const remove = (id: BuildSystemId) =>
    Effect.gen(function* () {
      const existing = yield* get(id);
      if (Option.isNone(existing)) return false;
      yield* sql`DELETE FROM build_systems WHERE build_system_id = ${id}`;
      // Runs survive their build system on purpose: they are the record of work
      // that really happened in threads that still exist.
      return true;
    }).pipe(writeFailed("The build system could not be deleted."));

  const upsertRun = (run: BuildSystemRun) =>
    sql`
      INSERT INTO build_system_runs (
        run_id,
        build_system_id,
        project_id,
        config_json,
        task,
        orchestrator_thread_id,
        role_threads_json,
        status,
        pending_json,
        delegation_count,
        summary,
        failure_detail,
        started_at,
        updated_at,
        settled_at
      )
      VALUES (
        ${run.id},
        ${run.buildSystemId},
        ${run.projectId},
        ${JSON.stringify(run.config)},
        ${run.task},
        ${run.orchestratorThreadId},
        ${JSON.stringify(run.roleThreads)},
        ${run.status},
        ${run.pending === null ? null : JSON.stringify(run.pending)},
        ${run.delegationCount},
        ${run.summary},
        ${run.failureDetail},
        ${run.startedAt},
        ${run.updatedAt},
        ${run.settledAt}
      )
      ON CONFLICT (run_id)
      DO UPDATE SET
        orchestrator_thread_id = excluded.orchestrator_thread_id,
        role_threads_json = excluded.role_threads_json,
        status = excluded.status,
        pending_json = excluded.pending_json,
        delegation_count = excluded.delegation_count,
        summary = excluded.summary,
        failure_detail = excluded.failure_detail,
        updated_at = excluded.updated_at,
        settled_at = excluded.settled_at
    `.pipe(Effect.asVoid, writeFailed("The run could not be saved."));

  const getRun = (id: BuildSystemRunId) =>
    Effect.gen(function* () {
      const rows = yield* sql<BuildSystemRunDbRow>`
        SELECT ${sql.literal(RUN_COLUMNS)}
        FROM build_system_runs
        WHERE run_id = ${id}
      `;
      const row = rows[0];
      return row === undefined ? Option.none<BuildSystemRun>() : Option.some(toRun(row));
    }).pipe(Effect.orElseSucceed(() => Option.none<BuildSystemRun>()));

  const listRuns = (input: {
    buildSystemId: BuildSystemId | null;
    projectId: ProjectId | null;
    limit: number;
  }) =>
    Effect.gen(function* () {
      const rows = yield* input.buildSystemId !== null
        ? sql<BuildSystemRunDbRow>`
            SELECT ${sql.literal(RUN_COLUMNS)}
            FROM build_system_runs
            WHERE build_system_id = ${input.buildSystemId}
            ORDER BY started_at DESC, run_id DESC
            LIMIT ${input.limit}
          `
        : input.projectId !== null
          ? sql<BuildSystemRunDbRow>`
              SELECT ${sql.literal(RUN_COLUMNS)}
              FROM build_system_runs
              WHERE project_id = ${input.projectId}
              ORDER BY started_at DESC, run_id DESC
              LIMIT ${input.limit}
            `
          : sql<BuildSystemRunDbRow>`
              SELECT ${sql.literal(RUN_COLUMNS)}
              FROM build_system_runs
              ORDER BY started_at DESC, run_id DESC
              LIMIT ${input.limit}
            `;
      return rows.map(toRun);
    }).pipe(Effect.orElseSucceed(() => []));

  const listActiveRuns = () =>
    Effect.gen(function* () {
      const rows = yield* sql<BuildSystemRunDbRow>`
        SELECT ${sql.literal(RUN_COLUMNS)}
        FROM build_system_runs
        WHERE settled_at IS NULL
        ORDER BY started_at ASC, run_id ASC
      `;
      return rows.map(toRun);
    }).pipe(Effect.orElseSucceed(() => []));

  /**
   * Matched in SQL against the orchestrator column and in memory against the
   * role map. The role map is a small JSON array and every active run is
   * already a candidate row, so scanning it costs less than the schema needed
   * to index inside it.
   */
  const findActiveRunForThread = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const runs = yield* listActiveRuns();
      const match = runs.find(
        (run) =>
          run.orchestratorThreadId === threadId ||
          run.roleThreads.some((entry) => entry.threadId === threadId),
      );
      return match === undefined ? Option.none<BuildSystemRun>() : Option.some(match);
    });

  const appendStep = (step: BuildSystemRunStep) =>
    sql`
      INSERT INTO build_system_run_steps (
        step_id, run_id, sequence, kind, role_id, role_name, thread_id, detail, at
      )
      VALUES (
        ${step.id},
        ${step.runId},
        ${step.sequence},
        ${step.kind},
        ${step.roleId},
        ${step.roleName},
        ${step.threadId},
        ${step.detail},
        ${step.at}
      )
    `.pipe(Effect.asVoid, writeFailed("The run step could not be recorded."));

  const listSteps = (runId: BuildSystemRunId) =>
    Effect.gen(function* () {
      const rows = yield* sql<BuildSystemRunStepDbRow>`
        SELECT
          step_id AS "stepId",
          run_id AS "runId",
          sequence,
          kind,
          role_id AS "roleId",
          role_name AS "roleName",
          thread_id AS "threadId",
          detail,
          at
        FROM build_system_run_steps
        WHERE run_id = ${runId}
        ORDER BY sequence ASC
      `;
      return rows.map(toStep);
    }).pipe(Effect.orElseSucceed(() => []));

  const nextStepSequence = (runId: BuildSystemRunId) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly next: number | null }>`
        SELECT MAX(sequence) + 1 AS "next"
        FROM build_system_run_steps
        WHERE run_id = ${runId}
      `;
      return rows[0]?.next ?? 0;
    }).pipe(Effect.orElseSucceed(() => 0));

  return BuildSystemStore.of({
    list,
    get,
    upsert,
    remove,
    upsertRun,
    getRun,
    listRuns,
    listActiveRuns,
    findActiveRunForThread,
    appendStep,
    listSteps,
    nextStepSequence,
  });
});

export const layer = Layer.effect(BuildSystemStore, make);

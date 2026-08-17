/**
 * AutomationStore - SQL access for automations and their run log.
 *
 * Deliberately dumb: it reads and writes rows and knows nothing about when
 * anything is due. All schedule reasoning lives in `automationSchedule.ts`,
 * and all deciding lives in `AutomationService.ts`, so the arithmetic that
 * actually goes wrong is testable without a database.
 *
 * @module AutomationStore
 */
import {
  Automation,
  AutomationError,
  AutomationId,
  AutomationRun,
  AutomationRunId,
  AutomationSchedule,
  ModelSelection,
  ProjectId,
  ThreadEnvMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const decodeSchedule = Schema.decodeUnknownSync(AutomationSchedule);
const decodeModelSelection = Schema.decodeUnknownSync(Schema.NullOr(ModelSelection));

interface AutomationDbRow {
  readonly automationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly prompt: string;
  readonly scheduleJson: string;
  readonly envMode: string;
  readonly modelSelectionJson: string | null;
  readonly enabled: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
}

interface AutomationRunDbRow {
  readonly runId: string;
  readonly automationId: string;
  readonly startedAt: string;
  readonly outcome: string;
  readonly threadId: string | null;
  readonly detail: string | null;
}

function toAutomation(row: AutomationDbRow): Automation {
  return {
    id: AutomationId.make(row.automationId),
    projectId: ProjectId.make(row.projectId),
    title: row.title,
    prompt: row.prompt,
    schedule: decodeSchedule(JSON.parse(row.scheduleJson)),
    envMode: row.envMode as ThreadEnvMode,
    modelSelection:
      row.modelSelectionJson === null
        ? null
        : decodeModelSelection(JSON.parse(row.modelSelectionJson)),
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
  };
}

function toRun(row: AutomationRunDbRow): AutomationRun {
  return {
    id: AutomationRunId.make(row.runId),
    automationId: AutomationId.make(row.automationId),
    startedAt: row.startedAt,
    outcome: row.outcome as AutomationRun["outcome"],
    threadId: row.threadId === null ? null : ThreadId.make(row.threadId),
    detail: row.detail,
  };
}

export interface AutomationStoreShape {
  readonly list: (projectId: ProjectId | null) => Effect.Effect<ReadonlyArray<Automation>>;
  readonly get: (id: AutomationId) => Effect.Effect<Option.Option<Automation>>;
  /** Fails loudly: a save that did not happen must never look like one that did. */
  readonly upsert: (automation: Automation) => Effect.Effect<void, AutomationError>;
  readonly remove: (id: AutomationId) => Effect.Effect<boolean, AutomationError>;
  /** Enabled automations whose next run is at or before `atIso`. */
  readonly listDue: (atIso: string) => Effect.Effect<ReadonlyArray<Automation>>;
  readonly appendRun: (run: AutomationRun) => Effect.Effect<void, AutomationError>;
  readonly listRuns: (input: {
    readonly automationId: AutomationId | null;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<AutomationRun>>;
}

export class AutomationStore extends Context.Service<AutomationStore, AutomationStoreShape>()(
  "t3/automation/AutomationStore",
) {}

/**
 * Turn a failed write into an `AutomationError` rather than a silent success.
 *
 * Reads below stay tolerant — an unreadable list renders as empty and the next
 * poll recovers — but a write that vanished would have the caller hand the
 * client an automation that was never stored.
 */
const writeFailed =
  (detail: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, AutomationError, R> =>
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.fail(
          new AutomationError({ reason: "writeFailed", detail, cause: Cause.squash(cause) }),
        ),
      ),
    );

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const list = (projectId: ProjectId | null) =>
    Effect.gen(function* () {
      const rows = yield* projectId === null
        ? sql<AutomationDbRow>`
            SELECT
              automation_id AS "automationId",
              project_id AS "projectId",
              title,
              prompt,
              schedule_json AS "scheduleJson",
              env_mode AS "envMode",
              model_selection_json AS "modelSelectionJson",
              enabled,
              created_at AS "createdAt",
              updated_at AS "updatedAt",
              last_run_at AS "lastRunAt",
              next_run_at AS "nextRunAt"
            FROM automations
            ORDER BY created_at ASC, automation_id ASC
          `
        : sql<AutomationDbRow>`
            SELECT
              automation_id AS "automationId",
              project_id AS "projectId",
              title,
              prompt,
              schedule_json AS "scheduleJson",
              env_mode AS "envMode",
              model_selection_json AS "modelSelectionJson",
              enabled,
              created_at AS "createdAt",
              updated_at AS "updatedAt",
              last_run_at AS "lastRunAt",
              next_run_at AS "nextRunAt"
            FROM automations
            WHERE project_id = ${projectId}
            ORDER BY created_at ASC, automation_id ASC
          `;
      return rows.map(toAutomation);
    }).pipe(Effect.orElseSucceed(() => []));

  const get = (id: AutomationId) =>
    Effect.gen(function* () {
      const rows = yield* sql<AutomationDbRow>`
        SELECT
          automation_id AS "automationId",
          project_id AS "projectId",
          title,
          prompt,
          schedule_json AS "scheduleJson",
          env_mode AS "envMode",
          model_selection_json AS "modelSelectionJson",
          enabled,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_run_at AS "lastRunAt",
          next_run_at AS "nextRunAt"
        FROM automations
        WHERE automation_id = ${id}
      `;
      const row = rows[0];
      return row === undefined ? Option.none<Automation>() : Option.some(toAutomation(row));
    }).pipe(Effect.orElseSucceed(() => Option.none<Automation>()));

  const upsert = (automation: Automation) =>
    sql`
      INSERT INTO automations (
        automation_id,
        project_id,
        title,
        prompt,
        schedule_json,
        env_mode,
        model_selection_json,
        enabled,
        created_at,
        updated_at,
        last_run_at,
        next_run_at
      )
      VALUES (
        ${automation.id},
        ${automation.projectId},
        ${automation.title},
        ${automation.prompt},
        ${JSON.stringify(automation.schedule)},
        ${automation.envMode},
        ${automation.modelSelection === null ? null : JSON.stringify(automation.modelSelection)},
        ${automation.enabled ? 1 : 0},
        ${automation.createdAt},
        ${automation.updatedAt},
        ${automation.lastRunAt},
        ${automation.nextRunAt}
      )
      ON CONFLICT (automation_id)
      DO UPDATE SET
        project_id = excluded.project_id,
        title = excluded.title,
        prompt = excluded.prompt,
        schedule_json = excluded.schedule_json,
        env_mode = excluded.env_mode,
        model_selection_json = excluded.model_selection_json,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at,
        last_run_at = excluded.last_run_at,
        next_run_at = excluded.next_run_at
    `.pipe(Effect.asVoid, writeFailed("The automation could not be saved."));

  const remove = (id: AutomationId) =>
    Effect.gen(function* () {
      const existing = yield* get(id);
      if (Option.isNone(existing)) return false;
      yield* sql`DELETE FROM automations WHERE automation_id = ${id}`;
      yield* sql`DELETE FROM automation_runs WHERE automation_id = ${id}`;
      return true;
    }).pipe(writeFailed("The automation could not be deleted."));

  const listDue = (atIso: string) =>
    Effect.gen(function* () {
      const rows = yield* sql<AutomationDbRow>`
        SELECT
          automation_id AS "automationId",
          project_id AS "projectId",
          title,
          prompt,
          schedule_json AS "scheduleJson",
          env_mode AS "envMode",
          model_selection_json AS "modelSelectionJson",
          enabled,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_run_at AS "lastRunAt",
          next_run_at AS "nextRunAt"
        FROM automations
        WHERE enabled = 1
          AND next_run_at IS NOT NULL
          AND next_run_at <= ${atIso}
        ORDER BY next_run_at ASC
      `;
      return rows.map(toAutomation);
    }).pipe(Effect.orElseSucceed(() => []));

  const appendRun = (run: AutomationRun) =>
    sql`
      INSERT INTO automation_runs (run_id, automation_id, started_at, outcome, thread_id, detail)
      VALUES (${run.id}, ${run.automationId}, ${run.startedAt}, ${run.outcome}, ${run.threadId}, ${run.detail})
    `.pipe(Effect.asVoid, writeFailed("The run could not be recorded."));

  const listRuns = (input: { automationId: AutomationId | null; limit: number }) =>
    Effect.gen(function* () {
      const rows = yield* input.automationId === null
        ? sql<AutomationRunDbRow>`
            SELECT
              run_id AS "runId",
              automation_id AS "automationId",
              started_at AS "startedAt",
              outcome,
              thread_id AS "threadId",
              detail
            FROM automation_runs
            ORDER BY started_at DESC, run_id DESC
            LIMIT ${input.limit}
          `
        : sql<AutomationRunDbRow>`
            SELECT
              run_id AS "runId",
              automation_id AS "automationId",
              started_at AS "startedAt",
              outcome,
              thread_id AS "threadId",
              detail
            FROM automation_runs
            WHERE automation_id = ${input.automationId}
            ORDER BY started_at DESC, run_id DESC
            LIMIT ${input.limit}
          `;
      return rows.map(toRun);
    }).pipe(Effect.orElseSucceed(() => []));

  return AutomationStore.of({
    list,
    get,
    upsert,
    remove,
    listDue,
    appendRun,
    listRuns,
  });
});

export const layer = Layer.effect(AutomationStore, make);

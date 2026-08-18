import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Teams of models a project can run a task through, and the log of what they did.
 *
 * Its own tables rather than the orchestration event log, for the same reason
 * automations have theirs: a build system is configuration, not history. It is
 * edited in place and has no meaningful ordering against thread events.
 *
 * A run, by contrast, *is* history — but it is history about a coordinator, not
 * about a thread, and replaying the event log must never restart a team. It
 * carries a snapshot of the config it started with so that editing or deleting
 * a build system cannot rewrite a conversation that already happened.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS build_systems (
      build_system_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      orchestrator_json TEXT NOT NULL,
      teammates_json TEXT NOT NULL,
      max_delegations INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_build_systems_project
    ON build_systems (project_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS build_system_runs (
      run_id TEXT PRIMARY KEY,
      build_system_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      config_json TEXT NOT NULL,
      task TEXT NOT NULL,
      orchestrator_thread_id TEXT,
      role_threads_json TEXT NOT NULL,
      status TEXT NOT NULL,
      pending_json TEXT,
      delegation_count INTEGER NOT NULL,
      summary TEXT,
      failure_detail TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      settled_at TEXT
    )
  `;

  // History reads are always "the newest few for this build system".
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_build_system_runs_recent
    ON build_system_runs (build_system_id, started_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_build_system_runs_project
    ON build_system_runs (project_id, started_at DESC)
  `;

  // The coordinator's hot query is "which runs do I still own", and after a
  // restart it is the only query. Partial because settled runs are the
  // permanent majority and indexing them would cost as much as the table.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_build_system_runs_active
    ON build_system_runs (status)
    WHERE settled_at IS NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS build_system_run_steps (
      step_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL,
      role_id TEXT,
      role_name TEXT,
      thread_id TEXT,
      detail TEXT,
      at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_build_system_run_steps_run
    ON build_system_run_steps (run_id, sequence ASC)
  `;
});

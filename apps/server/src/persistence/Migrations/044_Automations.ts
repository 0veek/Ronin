import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Saved prompts a project runs on a schedule, and the log of what they did.
 *
 * Its own tables rather than the orchestration event log: an automation is
 * configuration, not history. It is edited in place, it has no meaningful
 * ordering against thread events, and replaying the log must never re-fire a
 * schedule.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automations (
      automation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_json TEXT NOT NULL,
      env_mode TEXT NOT NULL,
      model_selection_json TEXT,
      enabled INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      next_run_at TEXT
    )
  `;

  // The scheduler's only hot query is "what is due", so the due time leads.
  // Partial on enabled: a disabled automation is never a candidate, and
  // leaving them out keeps the index the size of the working set.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automations_due
    ON automations (next_run_at)
    WHERE enabled = 1 AND next_run_at IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automations_project
    ON automations (project_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS automation_runs (
      run_id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      outcome TEXT NOT NULL,
      thread_id TEXT,
      detail TEXT
    )
  `;

  // History reads are always "the newest few for this automation".
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_automation_runs_recent
    ON automation_runs (automation_id, started_at DESC)
  `;
});

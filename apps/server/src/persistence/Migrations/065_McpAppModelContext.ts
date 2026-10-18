import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE mcp_app_model_context (
    thread_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, activity_id),
    FOREIGN KEY (activity_id) REFERENCES projection_thread_activities(activity_id) ON DELETE CASCADE
  )`;
});

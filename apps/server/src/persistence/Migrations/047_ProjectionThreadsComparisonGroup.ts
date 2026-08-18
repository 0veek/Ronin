import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Which race a thread is an entrant in.
 *
 * Indexed and partial: the comparison view's only query is "every thread in
 * this group", races are a small minority of threads, and indexing the NULLs
 * would cost as much as the table for no lookup — the same trade the side-chat
 * parent column makes.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "comparison_group_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN comparison_group_id TEXT
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_comparison_group
    ON projection_threads (comparison_group_id)
    WHERE comparison_group_id IS NOT NULL
  `;
});

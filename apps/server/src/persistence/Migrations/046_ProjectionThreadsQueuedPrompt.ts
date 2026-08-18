import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The prompt a captured task is waiting to send.
 *
 * One nullable column rather than a side table: a thread has at most one
 * queued prompt, it is read on every shell query the sidebar and board
 * already run, and a join to fetch a string that is null for almost every
 * row would cost more than the column ever will.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "queued_prompt")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN queued_prompt TEXT
    `;
  }
});

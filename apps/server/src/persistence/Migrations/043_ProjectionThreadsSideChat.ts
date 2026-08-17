import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Provenance for a thread opened from a message in another thread.
 *
 * Two flat columns rather than one JSON blob: the sidebar groups side chats
 * under their parent on every render, and an indexed column answers that
 * without parsing every row it reads.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "side_chat_parent_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN side_chat_parent_thread_id TEXT
    `;
  }

  if (!columns.some((column) => column.name === "side_chat_anchor_message_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN side_chat_anchor_message_id TEXT
    `;
  }

  // Partial: side chats are a small minority of threads, and indexing the
  // NULLs would cost as much as the table itself for no lookup.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_side_chat_parent
    ON projection_threads (side_chat_parent_thread_id)
    WHERE side_chat_parent_thread_id IS NOT NULL
  `;
});

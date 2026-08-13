/**
 * Records which provider authored each projected assistant message.
 *
 * A thread can be handed from one provider to another mid-conversation, so the
 * thread's current provider is no longer a safe stand-in for "who wrote this".
 * The handoff brief reads these columns to find the boundary between what a
 * returning provider already has in its own native session and what it missed
 * while another provider held the thread.
 *
 * Both columns are nullable: user and system messages have no author instance,
 * and every row written before switching existed carries neither.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_thread_messages
    ADD COLUMN provider_instance_id TEXT
  `;

  yield* sql`
    ALTER TABLE projection_thread_messages
    ADD COLUMN provider_name TEXT
  `;
});

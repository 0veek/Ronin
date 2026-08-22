/**
 * Adds `last_delivered_message_id` to `provider_session_ledger`: the last
 * message a continuation group is known to have actually processed.
 *
 * The handoff brief works out what a resuming provider has already seen from
 * authorship — the last message written by any instance in its group. That is
 * right whenever the provider answered, and wrong when it did not: a turn the
 * provider received and was interrupted on sits in its native transcript with
 * nothing of its own after it, so the brief replays a message the provider is
 * already holding.
 *
 * The column is written only once a turn reaches a terminal state that implies
 * the provider ingested its input, so trusting it can never skip a message the
 * provider never saw — the direction that is not recoverable. Null for every
 * group that predates this column, which simply falls back to authorship.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql`PRAGMA table_info(provider_session_ledger)`;
  const hasColumn = columns.some((column) => column.name === "last_delivered_message_id");
  if (hasColumn) {
    return;
  }

  yield* sql`
    ALTER TABLE provider_session_ledger
    ADD COLUMN last_delivered_message_id TEXT
  `;
});

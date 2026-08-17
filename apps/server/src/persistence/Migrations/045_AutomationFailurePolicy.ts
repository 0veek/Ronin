import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Consecutive start-failure policy for scheduled automations.
 *
 * Existing rows get the default threshold of three. An explicit SQL NULL
 * later means "never auto-disable".
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(automations)
  `;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("stop_after_consecutive_failures")) {
    yield* sql`
      ALTER TABLE automations
      ADD COLUMN stop_after_consecutive_failures INTEGER
    `;
    yield* sql`
      UPDATE automations
      SET stop_after_consecutive_failures = 3
      WHERE stop_after_consecutive_failures IS NULL
    `;
  }

  if (!names.has("consecutive_failure_count")) {
    yield* sql`
      ALTER TABLE automations
      ADD COLUMN consecutive_failure_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!names.has("disabled_reason")) {
    yield* sql`
      ALTER TABLE automations
      ADD COLUMN disabled_reason TEXT
    `;
  }

  if (!names.has("disabled_at")) {
    yield* sql`
      ALTER TABLE automations
      ADD COLUMN disabled_at TEXT
    `;
  }
});

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Credentials never enter schedule_json or the automation read model.
  yield* sql`ALTER TABLE automations ADD COLUMN webhook_token TEXT`;
  yield* sql`ALTER TABLE automations ADD COLUMN webhook_secret TEXT`;
  yield* sql`CREATE TABLE automation_webhook_deliveries (
    delivery_id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL,
    received_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX automation_webhook_deliveries_automation_time_idx
    ON automation_webhook_deliveries (automation_id, received_at DESC, delivery_id DESC)`;
});

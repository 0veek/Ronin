import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

interface ColumnRow {
  readonly name: string;
}

interface DeliveryRow {
  readonly thread_id: string;
  readonly last_delivered_message_id: string | null;
}

layer("049_ProviderSessionLedgerDelivery", (it) => {
  it.effect("leaves existing groups with no delivery mark, so they fall back to authorship", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 48 });
      yield* sql`
        INSERT INTO provider_session_ledger (
          thread_id, continuation_key, provider_name, provider_instance_id,
          adapter_key, runtime_mode, resume_cursor_json, runtime_payload_json,
          first_seen_at, last_seen_at
        ) VALUES (
          'thread-old', 'codex:home:/home/dev/.codex', 'codex', 'codex-personal',
          'codex', 'full-access', '{"sessionId":"codex-1"}', NULL,
          '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 49 });

      const rows = yield* sql<DeliveryRow>`
        SELECT thread_id, last_delivered_message_id FROM provider_session_ledger
      `;
      assert.deepStrictEqual(
        [...rows],
        [{ thread_id: "thread-old", last_delivered_message_id: null }],
      );
    }),
  );

  it.effect("is safe to run against a database that already has the column", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 49 });
      yield* runMigrations({ toMigrationInclusive: 49 });

      const columns = yield* sql<ColumnRow>`PRAGMA table_info(provider_session_ledger)`;
      assert.strictEqual(
        columns.filter((column) => column.name === "last_delivered_message_id").length,
        1,
      );
    }),
  );
});

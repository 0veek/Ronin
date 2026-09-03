import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_ProjectionThreadMessageProvider", (it) => {
  it.effect("adds nullable author columns to message projections", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* runMigrations({ toMigrationInclusive: 42 });

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(projection_thread_messages)
      `;

      // Nullable in both directions: user messages have no author instance, and
      // every message projected before switching existed carries neither field.
      for (const name of ["provider_instance_id", "provider_name"]) {
        const column = columns.find((entry) => entry.name === name);
        assert.equal(column?.name, name);
        assert.equal(column?.notnull, 0);
      }
    }),
  );

  it.effect("leaves messages projected before the migration unattributed", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at
        )
        VALUES (
          'message-legacy', 'thread-legacy', NULL, 'assistant', 'hi', 0,
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
        )
      `;
      yield* runMigrations({ toMigrationInclusive: 42 });

      const rows = yield* sql<{
        readonly provider_instance_id: string | null;
        readonly provider_name: string | null;
      }>`
        SELECT provider_instance_id, provider_name
        FROM projection_thread_messages
        WHERE message_id = 'message-legacy'
      `;

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.provider_instance_id, null);
      assert.equal(rows[0]?.provider_name, null);
    }),
  );
});

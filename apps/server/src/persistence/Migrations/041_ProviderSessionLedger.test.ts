import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

interface LedgerRow {
  readonly thread_id: string;
  readonly continuation_key: string;
  readonly provider_name: string;
  readonly provider_instance_id: string;
  readonly resume_cursor_json: string | null;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
}

layer("041_ProviderSessionLedger", (it) => {
  it.effect("backfills the currently bound provider so old threads can still resume", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id, provider_name, provider_instance_id, adapter_key,
          runtime_mode, status, last_seen_at, resume_cursor_json, runtime_payload_json
        ) VALUES (
          'thread-bound', 'codex', 'codex-personal', 'codex',
          'full-access', 'running', '2026-03-01T00:00:00.000Z', '{"sessionId":"codex-1"}', NULL
        )
      `;
      // Rows that predate the driver/instance split carry no instance id; the
      // backfill has to fall back to the provider name rather than drop them.
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id, provider_name, provider_instance_id, adapter_key,
          runtime_mode, status, last_seen_at, resume_cursor_json, runtime_payload_json
        ) VALUES (
          'thread-legacy', 'claudeAgent', NULL, 'claudeAgent',
          'full-access', 'stopped', '2026-02-01T00:00:00.000Z', NULL, NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 41 });

      const rows = yield* sql<LedgerRow>`
        SELECT
          thread_id, continuation_key, provider_name, provider_instance_id,
          resume_cursor_json, first_seen_at, last_seen_at
        FROM provider_session_ledger
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(rows, [
        {
          thread_id: "thread-bound",
          // `${driverKind}:instance:${instanceId}` — the default continuation
          // identity every driver except Codex uses.
          continuation_key: "codex:instance:codex-personal",
          provider_name: "codex",
          provider_instance_id: "codex-personal",
          resume_cursor_json: '{"sessionId":"codex-1"}',
          // Nothing records when the group first appeared, so the only honest
          // answer is when it was last seen.
          first_seen_at: "2026-03-01T00:00:00.000Z",
          last_seen_at: "2026-03-01T00:00:00.000Z",
        },
        {
          thread_id: "thread-legacy",
          continuation_key: "claudeAgent:instance:claudeAgent",
          provider_name: "claudeAgent",
          provider_instance_id: "claudeAgent",
          resume_cursor_json: null,
          first_seen_at: "2026-02-01T00:00:00.000Z",
          last_seen_at: "2026-02-01T00:00:00.000Z",
        },
      ]);
    }),
  );

  it.effect("leaves a ledger row written after the backfill alone on re-run", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 41 });
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id, provider_name, provider_instance_id, adapter_key,
          runtime_mode, status, last_seen_at, resume_cursor_json, runtime_payload_json
        ) VALUES (
          'thread-live', 'codex', 'codex-personal', 'codex',
          'full-access', 'running', '2026-03-01T00:00:00.000Z', '{"sessionId":"stale"}', NULL
        )
      `;
      yield* sql`
        INSERT INTO provider_session_ledger (
          thread_id, continuation_key, provider_name, provider_instance_id,
          adapter_key, runtime_mode, resume_cursor_json, runtime_payload_json,
          first_seen_at, last_seen_at
        ) VALUES (
          'thread-live', 'codex:instance:codex-personal', 'codex', 'codex-personal',
          'codex', 'full-access', '{"sessionId":"current"}', NULL,
          '2026-03-01T00:00:00.000Z', '2026-03-09T00:00:00.000Z'
        )
      `;

      // Migrations are recorded, so this is a no-op — but the INSERT OR IGNORE
      // is what guarantees a re-run could never overwrite a live cursor.
      yield* runMigrations({ toMigrationInclusive: 41 });

      const rows = yield* sql<Pick<LedgerRow, "resume_cursor_json">>`
        SELECT resume_cursor_json FROM provider_session_ledger WHERE thread_id = 'thread-live'
      `;
      assert.deepStrictEqual(rows, [{ resume_cursor_json: '{"sessionId":"current"}' }]);
    }),
  );
});

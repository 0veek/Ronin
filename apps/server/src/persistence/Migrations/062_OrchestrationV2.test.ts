import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("062_OrchestrationV2", (it) => {
  it.effect("preserves Ronin history, provider continuation, automations and build systems", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });
      const now = "2026-10-04T00:00:00.000Z";
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, default_thread_env_mode, favicon_path, project_icon_json, auto_pull)
      VALUES ('project', 'Ronin project', '/workspace', '[]', ${now}, ${now}, 'worktree', '/favicon.png', '{"type":"emoji","emoji":"🥷"}', 1)`;
      yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at,
      side_chat_parent_thread_id, side_chat_anchor_message_id, comparison_group_id, queued_prompt, pinned_at, pin_order_key, active_order_key, auto_settle_disabled_at)
      VALUES ('thread', 'project', 'Ronin thread', '{"instanceId":"claude-personal","model":"sonnet"}', 'auto-accept-edits', 'debug', ${now}, ${now}, 'parent', 'anchor', 'comparison', 'next prompt', ${now}, 'a', 'b', ${now})`;
      yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at, attachments_json, context_json)
      VALUES ('message', 'thread', 'turn', 'user', 'Existing conversation', 0, ${now}, ${now}, '[]', '{"records":[]}')`;
      yield* sql`INSERT INTO projection_turns (thread_id, turn_id, state, requested_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json)
      VALUES ('thread', 'turn', 'completed', ${now}, 7, 'refs/ronin/checkpoints/thread/7', 'ready', '[]')`;
      yield* sql`INSERT INTO provider_session_ledger (thread_id, continuation_key, provider_name, provider_instance_id, adapter_key, runtime_mode, resume_cursor_json, first_seen_at, last_seen_at)
      VALUES ('thread', 'claude:personal', 'claudeAgent', 'claude-personal', 'claudeAgent', 'auto-accept-edits', '{"sessionId":"native-memory"}', ${now}, ${now})`;
      yield* sql`INSERT INTO automations (automation_id, project_id, title, prompt, schedule_json, env_mode, enabled, created_at, updated_at)
      VALUES ('automation', 'project', 'Review', 'Review changes', '{"type":"manual"}', 'local', 1, ${now}, ${now})`;
      yield* sql`INSERT INTO build_systems (build_system_id, project_id, name, orchestrator_json, teammates_json, max_delegations, created_at, updated_at)
      VALUES ('build', 'project', 'Team', '{}', '[]', 4, ${now}, ${now})`;
      yield* sql`INSERT INTO orchestration_events (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, actor_kind, payload_json, metadata_json)
      VALUES ('old-event', 'thread', 'thread', 1, 'thread.message-sent', ${now}, 'user', '{}', '{}')`;
      yield* sql`INSERT INTO orchestration_command_receipts (command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status)
      VALUES ('old-command', 'thread', 'thread', ${now}, 1, 'accepted')`;
      const tables = [
        "projection_projects",
        "projection_threads",
        "projection_thread_messages",
        "projection_turns",
        "provider_session_ledger",
        "automations",
        "build_systems",
      ];
      const before = yield* Effect.forEach(tables, (table) => sql.unsafe(`SELECT * FROM ${table}`));
      yield* runMigrations({ toMigrationInclusive: 62 });
      const after = yield* Effect.forEach(tables, (table) => sql.unsafe(`SELECT * FROM ${table}`));
      assert.deepEqual(after, before);
      const events = yield* sql<{
        readonly event_id: string;
        readonly application_event_version: number;
      }>`SELECT event_id, application_event_version FROM orchestration_events ORDER BY sequence`;
      assert.deepEqual(events, [
        { event_id: "old-event", application_event_version: 1 },
        { event_id: "migration:62:project:project:baseline", application_event_version: 2 },
      ]);
      const receipts = yield* sql<{
        readonly command_type: string;
      }>`SELECT command_type FROM orchestration_command_receipts WHERE command_id = 'old-command'`;
      assert.equal(receipts[0]?.command_type, "legacy");
      yield* runMigrations({ toMigrationInclusive: 62 });
      assert.equal((yield* sql`SELECT * FROM orchestration_events`).length, 2);
    }),
  );
});

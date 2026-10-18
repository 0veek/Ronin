import { assert, it } from "@effect/vitest";
import { ThreadId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { makeThreadFind } from "./ThreadFind.ts";

const threadId = ThreadId.make("find-thread");
const turnId = TurnId.make("find-turn");
const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projection_projects
    (project_id, title, workspace_root, scripts_json, created_at, updated_at)
    VALUES ('find-project', 'Project', '/workspace/repo', '[]', '2026-10-01', '2026-10-01')`;
  yield* sql`INSERT INTO projection_threads
    (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
    VALUES (${threadId}, 'find-project', 'Thread', '{}', 'full-access', 'default', '2026-10-01', '2026-10-01')`;
  yield* sql`INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
    VALUES ('messages', 1, '2026-10-01')`;
  return sql;
});

it.effect("finds old prompts, commentary, rendered Markdown, and plans without tool bodies", () =>
  Effect.gen(function* () {
    const sql = yield* seed;
    const search = yield* makeThreadFind;
    yield* sql`INSERT INTO projection_thread_messages
      (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at)
      VALUES
      ('old', ${threadId}, ${turnId}, 'user', 'Needle **across** formatting. needle', 0, '2026-10-01', '2026-10-01'),
      ('commentary', ${threadId}, ${turnId}, 'assistant', 'A needle in commentary', 0, '2026-10-02', '2026-10-02'),
      ('link', ${threadId}, ${turnId}, 'assistant', '[visible label](https://hidden.example/needle)', 0, '2026-10-03', '2026-10-03'),
      ('system', ${threadId}, NULL, 'system', 'needle system body', 0, '2026-10-04', '2026-10-04')`;
    yield* sql`INSERT INTO projection_thread_proposed_plans
      (plan_id, thread_id, turn_id, plan_markdown, created_at, updated_at)
      VALUES ('plan', ${threadId}, ${turnId}, '# Plan needle\n\n## Summary\n\nPlan needle body', '2026-10-05', '2026-10-05')`;
    yield* sql`INSERT INTO projection_thread_activities
      (activity_id, thread_id, tone, kind, summary, payload_json, created_at)
      VALUES ('tool', ${threadId}, 'info', 'tool.completed', 'needle', 'invalid tool payload deliberately never decoded', '2026-10-06')`;
    // This is older than the client's initial five-turn window.
    for (let i = 0; i < 60; i++) {
      yield* sql`INSERT INTO projection_thread_messages
        (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
        VALUES (${`recent-${i}`}, ${threadId}, 'user', 'Unrelated recent prompt', 0, '2026-10-07', '2026-10-07')`;
    }
    const result = yield* search({ threadId, query: "NEEDLE" });
    assert.strictEqual(result.totalMatches, 5);
    assert.deepStrictEqual(result.match, { entryId: "old", runId: turnId, occurrence: 0 });
    assert.deepStrictEqual(
      result.navigation?.map(({ entryId }) => entryId),
      ["old", "commentary", "plan"],
    );
    assert.strictEqual(
      (yield* search({ threadId, query: "Needle across formatting" })).totalMatches,
      1,
    );
    assert.strictEqual((yield* search({ threadId, query: "visible label" })).totalMatches, 1);
    assert.strictEqual((yield* search({ threadId, query: "hidden.example" })).totalMatches, 0);
    assert.deepStrictEqual(
      (yield* search({
        threadId,
        query: "needle",
        start: { entryId: "plan", occurrence: 1 },
        offset: 1,
      })).match,
      { entryId: "old", runId: turnId, occurrence: 0 },
    );
    assert.deepStrictEqual((yield* search({ threadId, query: "needle", offset: -1 })).match, {
      entryId: "plan",
      runId: turnId,
      occurrence: 1,
    });
  }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "invalidates navigation after projection updates and rollback, and isolates deleted threads",
  () =>
    Effect.gen(function* () {
      const sql = yield* seed;
      const search = yield* makeThreadFind;
      yield* sql`INSERT INTO projection_thread_messages
      (message_id, thread_id, role, text, is_streaming, created_at, updated_at)
      VALUES ('streaming', ${threadId}, 'assistant', 'needle', 1, '2026-10-01', '2026-10-01')`;
      assert.strictEqual((yield* search({ threadId, query: "needle" })).totalMatches, 1);
      yield* sql`UPDATE projection_thread_messages SET text = 'needle needle' WHERE message_id = 'streaming'`;
      yield* sql`UPDATE projection_state SET last_applied_sequence = 2`;
      assert.strictEqual((yield* search({ threadId, query: "needle", index: 1 })).totalMatches, 2);
      yield* sql`DELETE FROM projection_thread_messages WHERE message_id = 'streaming'`;
      yield* sql`UPDATE projection_state SET last_applied_sequence = 3`;
      assert.strictEqual((yield* search({ threadId, query: "needle" })).totalMatches, 0);
      yield* sql`UPDATE projection_threads SET deleted_at = '2026-10-02'`;
      assert.strictEqual((yield* search({ threadId, query: "needle" })).match, null);
      assert.strictEqual(
        (yield* search({ threadId: ThreadId.make("other-thread"), query: "needle" })).totalMatches,
        0,
      );
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

it.effect(
  "excludes folded question answers and structured context while matching visible skill labels",
  () =>
    Effect.gen(function* () {
      const sql = yield* seed;
      const search = yield* makeThreadFind;
      yield* sql`INSERT INTO projection_thread_messages
      (message_id, thread_id, role, text, context_json, is_streaming, created_at, updated_at)
      VALUES
      ('async-answer:req1', ${threadId}, 'user', 'hidden answer needle', NULL, 0, '2026-10-01', '2026-10-01'),
      ('prompt', ${threadId}, 'user', 'Use $my-skill [hidden needle](t3-context://v1/terminal/terminal_1)', '{"version":1,"records":[]}', 0, '2026-10-02', '2026-10-02')`;
      yield* sql`INSERT INTO projection_thread_activities
      (activity_id, thread_id, tone, kind, summary, payload_json, created_at)
      VALUES ('answer', ${threadId}, 'info', 'user-input.answer-submitted', 'Answer', '{"requestId":"req1","answers":{},"attachmentsByQuestionId":{}}', '2026-10-01')`;
      assert.strictEqual((yield* search({ threadId, query: "needle" })).totalMatches, 0);
      assert.strictEqual(
        (yield* search({
          threadId,
          query: "Special Skill",
          skills: [{ name: "my-skill", displayName: "Special Skill" }],
        })).totalMatches,
        1,
      );
      assert.strictEqual((yield* search({ threadId, query: "Special Skill" })).totalMatches, 0);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
);

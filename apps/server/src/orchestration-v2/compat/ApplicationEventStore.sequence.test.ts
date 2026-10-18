import { assert, it } from "@effect/vitest";
import { CommandId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStoreLive as ApplicationEventStoreLive } from "./ApplicationEventStore.ts";
import { OrchestrationEventStore as ApplicationEventStore } from "./ApplicationEventStoreService.ts";
const occurredAt = "2026-10-07T00:00:00Z";

it.effect("replays a command's events through the command index, not the sequence range", () =>
  Effect.gen(function* () {
    const store = yield* ApplicationEventStore;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      WITH RECURSIVE history(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 25000
      )
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
        command_id, actor_kind, payload_json, metadata_json, application_event_version
      )
      SELECT 'history:' || n, 'thread', 'thread', n, 'provider-session.detached', ${occurredAt},
        CASE WHEN n IN (12, 24990) THEN 'retried-command' ELSE 'command:' || n END,
        'server',
        '{"providerSessionId":"session","detachedAt":"' || ${occurredAt} || '"}',
        '{}', 2
      FROM history
    `;
    const statements: Array<string> = [];
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (endTime, exit) => {
          end(endTime, exit);
          const query = span.attributes.get("db.query.text");
          if (typeof query === "string") statements.push(query);
        };
        return span;
      },
    });
    const replayed = yield* store
      .readAgentEvents({ commandId: CommandId.make("retried-command") })
      .pipe(Stream.runCollect, Effect.withTracer(tracer));
    assert.deepEqual(
      replayed.map((event) => event.sequence),
      [12, 24990],
    );
    assert.equal(statements.length, 1);
    const plan = yield* sql.unsafe<{ readonly detail: string }>(
      `EXPLAIN QUERY PLAN ${statements[0]}`,
      [0, Number.MAX_SAFE_INTEGER, "retried-command", 500],
    );
    assert.match(
      plan.map((row) => row.detail).join("\n"),
      /SEARCH orchestration_events USING INDEX idx_orch_events_command_id \(command_id=\?/,
    );
  }).pipe(
    Effect.provide(ApplicationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory))),
  ),
);

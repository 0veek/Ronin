import { assert, it } from "@effect/vitest";
import { CommandId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
const isolatedOutboxLayer = Layer.fresh(
  EffectOutbox.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);
it.effect("prunes settled effects past retention in batches and keeps the rest", () =>
  Effect.gen(function* () {
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const insert = (
      prefix: string,
      count: number,
      status: EffectOutbox.OrchestrationEffectStatusV2,
      completedAgo: Duration.Duration | null,
    ) => {
      const completedAt =
        completedAgo === null
          ? null
          : DateTime.formatIso(DateTime.subtractDuration(now, completedAgo));
      const createdAt = DateTime.formatIso(now);
      return sql`
          WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})
          INSERT INTO orchestration_v2_effect_outbox (
            effect_id, command_id, thread_id, effect_type, payload_json, status,
            available_at, created_at, updated_at, completed_at
          )
          SELECT ${prefix} || i, 'command:prune', 'thread:prune', 'terminal.cleanup',
            '{"type":"terminal.cleanup"}', ${status}, ${createdAt}, ${createdAt}, ${createdAt},
            ${completedAt}
          FROM n
        `;
    };
    const old = Duration.sum(EffectOutbox.SETTLED_EFFECT_RETENTION, Duration.minutes(1));
    const recent = Duration.subtract(EffectOutbox.SETTLED_EFFECT_RETENTION, Duration.minutes(1));
    // More expired rows than one delete batch.
    yield* insert("succeeded-old:", 1_201, "succeeded", old);
    yield* insert("cancelled-old:", 2, "cancelled", old);
    yield* insert("succeeded-recent:", 1, "succeeded", recent);
    yield* insert("failed-old:", 1, "failed", old);
    yield* insert("pending:", 1, "pending", null);
    yield* insert("running:", 1, "running", null);

    assert.equal(yield* outbox.pruneSettled, 1_203);

    const remaining = yield* sql<{ readonly effect_id: string }>`
        SELECT effect_id FROM orchestration_v2_effect_outbox ORDER BY effect_id
      `;
    assert.deepEqual(
      remaining.map((row) => row.effect_id),
      ["failed-old:1", "pending:1", "running:1", "succeeded-recent:1"],
    );
    assert.equal(yield* outbox.pruneSettled, 0);
  }).pipe(Effect.provide(isolatedOutboxLayer)),
);

it.effect("prunes settled effects hourly from the layer-owned worker", () =>
  Effect.gen(function* () {
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const commandId = CommandId.make("command:foundation-prune-worker");
    const threadId = ThreadId.make("thread:foundation-prune-worker");
    const workerId = "prune-worker";
    const request = { type: "terminal.cleanup" } as const;
    yield* outbox.enqueue([{ id: "effect:prune-worker:done", commandId, threadId, request }]);
    yield* outbox.claimNext({ workerId, leaseDurationMs: 30_000 });
    assert.isTrue(yield* outbox.succeed({ effectId: "effect:prune-worker:done", workerId }));
    yield* outbox.enqueue([{ id: "effect:prune-worker:pending", commandId, threadId, request }]);
    // Observe each run so the test waits for it instead of racing the clock.
    const runs = yield* Queue.unbounded<number>();
    const observed = EffectOutbox.EffectOutboxV2.of({
      ...outbox,
      pruneSettled: outbox.pruneSettled.pipe(Effect.tap((pruned) => Queue.offer(runs, pruned))),
    });
    const ids = Effect.map(outbox.listByCommandId(commandId), (rows) =>
      rows.map((row) => row.id).toSorted(),
    );

    yield* TestClock.adjust(
      Duration.subtract(EffectOutbox.SETTLED_EFFECT_RETENTION, Duration.minutes(30)),
    );
    yield* Layer.build(
      EffectOutbox.pruneWorkerLive.pipe(
        Layer.provide(Layer.succeed(EffectOutbox.EffectOutboxV2, observed)),
      ),
    );
    assert.equal(yield* Queue.take(runs), 0);
    assert.deepEqual(yield* ids, ["effect:prune-worker:done", "effect:prune-worker:pending"]);

    yield* TestClock.adjust("1 hour");
    assert.equal(yield* Queue.take(runs), 1);
    assert.deepEqual(yield* ids, ["effect:prune-worker:pending"]);
  }).pipe(Effect.scoped, Effect.provide(isolatedOutboxLayer)),
);

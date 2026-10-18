import { assert, it } from "@effect/vitest";
import { EventId, ProjectId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { vi } from "vite-plus/test";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
it.effect("pages complete user turns through SQL regardless of tool count or payload size", () =>
  Effect.gen(function* () {
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const nowIso = DateTime.formatIso(now);
    const threadId = ThreadId.make("thread:user-turn-pages");
    yield* projectionStore.apply({
      id: EventId.make("event:user-turn-pages:thread"),
      type: "thread.created",
      threadId,
      occurredAt: now,
      payload: {
        createdBy: "user",
        creationSource: "web",
        id: threadId,
        projectId: ProjectId.make("project:user-turn-pages"),
        title: "Bounded SQL history",
        providerInstanceId: ProviderInstanceId.make("codex"),
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
    });

    const allIds: string[] = [];
    let lastToolPayload = "";
    for (let turn = 1; turn <= 45; turn += 1) {
      const rows = Array.from({ length: 102 }, (_, offset) => {
        const ordinal = (turn - 1) * 102 + offset + 1;
        const id = `item:user-turn-pages:${ordinal}`;
        allIds.push(id);
        const base = {
          id,
          threadId,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal,
          status: "completed",
          title: null,
          startedAt: nowIso,
          completedAt: nowIso,
          updatedAt: nowIso,
        };
        const item =
          offset < 2
            ? {
                ...base,
                type: "user_message",
                createdBy: "user",
                creationSource: "web",
                messageId: `message:${id}`,
                inputIntent: offset === 0 ? "turn_start" : "steer",
                text: `Turn ${turn}`,
                attachments: [],
              }
            : {
                ...base,
                type: "command_execution",
                input: "command",
                output: "x".repeat(2048),
                exitCode: 0,
              };
        const payloadJson = JSON.stringify(item);
        if (offset >= 2) lastToolPayload = payloadJson;
        return {
          turn_item_id: id,
          thread_id: threadId,
          run_id: null,
          node_id: null,
          provider_thread_id: null,
          provider_turn_id: null,
          parent_item_id: null,
          ordinal,
          type: item.type,
          status: "completed",
          updated_at: nowIso,
          payload_json: payloadJson,
        };
      });
      yield* sql`INSERT INTO orchestration_v2_projection_turn_items ${sql.insert(rows)}`;
    }
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
    const initial = yield* Effect.acquireUseRelease(
      Effect.sync(() => vi.spyOn(JSON, "parse")),
      (parse) =>
        projectionStore.getThreadSnapshotWindow(threadId, { rowLimit: 77, userTurnLimit: 10 }).pipe(
          Effect.withTracer(tracer),
          Effect.tap(() =>
            Effect.sync(() => {
              // Tool outputs must not be allocated again just to collect cohort IDs.
              assert.lengthOf(
                parse.mock.calls.filter(([input]) => input === lastToolPayload),
                1,
              );
            }),
          ),
        ),
      (parse) => Effect.sync(() => parse.mockRestore()),
    );
    // Large threads blocked the server for over a second here. The boundary
    // must come from the user-message index rather than a scan of every tool
    // row, and payloads must not go through a sort after they are fetched.
    const windowStatement = statements.find((statement) => statement.includes("turn_anchors"));
    assert.isDefined(windowStatement);
    const windowPlan = yield* sql.unsafe<{ readonly parent: number; readonly detail: string }>(
      `EXPLAIN QUERY PLAN ${windowStatement}`,
    );
    assert.match(
      windowPlan.map((row) => row.detail).join("\n"),
      /SEARCH item USING INDEX orchestration_v2_projection_turn_items_user_message_idx \(thread_id=\? AND ordinal<\?\)/,
    );
    const topLevel = windowPlan.filter((row) => row.parent === 0).map((row) => row.detail);
    assert.include(topLevel, "SEARCH item USING INTEGER PRIMARY KEY (rowid=?)");
    assert.notInclude(topLevel, "USE TEMP B-TREE FOR ORDER BY");
    const nodeStatement = statements.find((statement) =>
      statement.includes("WITH RECURSIVE retained"),
    );
    assert.isDefined(nodeStatement);
    const nodePlan = yield* sql.unsafe<{ readonly detail: string }>(
      `EXPLAIN QUERY PLAN ${nodeStatement}`,
    );
    assert.include(
      nodePlan.map((row) => row.detail),
      "SEARCH orchestration_v2_projection_nodes USING INDEX orchestration_v2_projection_nodes_live_idx (thread_id=?)",
    );
    // Only the selected turn cohort and two lookahead anchors are decoded.
    assert.lengthOf(initial.projection.turnItems, 12 * 102);
    // Physical insert order cannot decide the order of tied timeline items.
    for (const suffix of ["b", "a"]) {
      const id = `item:user-turn-pages:tie:${suffix}`;
      yield* sql`
        INSERT INTO orchestration_v2_projection_turn_items
        SELECT ${id}, thread_id, run_id, node_id, provider_thread_id, provider_turn_id,
          parent_item_id, 5000, type, status, updated_at,
          json_set(payload_json, '$.id', ${id}, '$.ordinal', 5000)
        FROM orchestration_v2_projection_turn_items WHERE turn_item_id = ${allIds.at(-1)!}
      `;
    }
    const tied = yield* projectionStore.getThreadSnapshotWindow(threadId, { rowLimit: 2 });
    assert.deepEqual(
      tied.projection.turnItems.slice(-2).map((item) => item.id),
      ["item:user-turn-pages:tie:a", "item:user-turn-pages:tie:b"],
    );

    const nodes = Array.from({ length: 1002 }, (_, index) => {
      const id = `node:user-turn-pages:${index}`;
      const startedAt =
        index === 998
          ? null
          : index === 999
            ? DateTime.formatIso(DateTime.makeUnsafe(now.epochMilliseconds - 86_400_000))
            : nowIso;
      const status = index === 1001 ? "running" : "completed";
      return {
        node_id: id,
        thread_id: threadId,
        run_id: null,
        root_node_id: id,
        parent_node_id: null,
        kind: "assistant_message",
        status,
        provider_thread_id: null,
        provider_turn_id: null,
        runtime_request_id: null,
        checkpoint_scope_id: null,
        started_at: startedAt,
        completed_at: status === "running" ? null : nowIso,
        payload_json: JSON.stringify({
          id,
          threadId,
          runId: null,
          rootNodeId: id,
          parentNodeId: null,
          kind: "assistant_message",
          status,
          countsForRun: false,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          runtimeRequestId: null,
          checkpointScopeId: null,
          startedAt,
          completedAt: status === "running" ? null : nowIso,
        }),
      };
    });
    for (let offset = 0; offset < nodes.length; offset += 50) {
      yield* sql`INSERT INTO orchestration_v2_projection_nodes ${sql.insert(nodes.slice(offset, offset + 50))}`;
    }
    for (const [suffix, index] of [
      ["a", 998],
      ["b", 999],
    ] as const) {
      const nodeId = `node:user-turn-pages:${index}`;
      yield* sql`UPDATE orchestration_v2_projection_turn_items
        SET node_id = ${nodeId}, payload_json = json_set(payload_json, '$.nodeId', ${nodeId})
        WHERE turn_item_id = ${`item:user-turn-pages:tie:${suffix}`}`;
    }
    statements.length = 0;
    const boundedNodes = yield* projectionStore
      .getThreadSnapshotWindow(threadId, { rowLimit: 2 })
      .pipe(Effect.withTracer(tracer));
    assert.deepEqual(
      boundedNodes.projection.nodes.map((node) => node.id),
      ["node:user-turn-pages:998", "node:user-turn-pages:999", "node:user-turn-pages:1001"],
    );
    const bodiesStatement = statements.find((statement) =>
      statement.includes("SELECT node.payload_json"),
    );
    assert.isDefined(bodiesStatement);
    const bodyPlan = yield* sql.unsafe<{ readonly detail: string }>(
      `EXPLAIN QUERY PLAN ${bodiesStatement}`,
    );
    assert.deepEqual(
      bodyPlan.map((row) => row.detail).filter((detail) => detail.startsWith("SEARCH ")),
      ["SEARCH node USING INDEX sqlite_autoindex_orchestration_v2_projection_nodes_1 (node_id=?)"],
    );
    assert.notInclude(
      bodyPlan.map((row) => row.detail),
      "USE TEMP B-TREE FOR ORDER BY",
    );
    const full = yield* projectionStore.getThreadSnapshot(threadId);
    const retained = new Set(boundedNodes.projection.nodes.map((node) => node.id));
    assert.deepEqual(
      boundedNodes.projection.nodes,
      full.projection.nodes.filter((node) => retained.has(node.id)),
    );
  }).pipe(Effect.provide(ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)))),
);

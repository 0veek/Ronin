import { assert, it } from "@effect/vitest";
import { EventId, MessageId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore as LegacyEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive as ApplicationEventStoreLive } from "./ApplicationEventStore.ts";
import { OrchestrationEventStore as ApplicationEventStore } from "./ApplicationEventStoreService.ts";
import * as EventStore from "../EventStore.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import * as ProjectionMaintenance from "../ProjectionMaintenance.ts";

const layer = Layer.mergeAll(
  OrchestrationEventStoreLive,
  ApplicationEventStoreLive,
  ProjectionMaintenance.layer.pipe(
    Layer.provide(
      Layer.merge(
        EventStore.layerFromOrchestrationEventStore.pipe(Layer.provide(ApplicationEventStoreLive)),
        ProjectionStore.layer,
      ),
    ),
  ),
).pipe(Layer.provideMerge(SqlitePersistenceMemory));
it.layer(layer)("Ronin application event compatibility", (it) => {
  it.effect(
    "interleaves V1 and V2 writes without stream collisions or leaking V2 events to the client",
    () =>
      Effect.gen(function* () {
        const legacy = yield* LegacyEventStore;
        const application = yield* ApplicationEventStore;
        const sql = yield* SqlClient.SqlClient;
        const threadId = ThreadId.make("shared-thread");
        const now = "2026-10-04T00:00:00.000Z";
        const appendLegacy = (id: string) =>
          legacy.append({
            type: "thread.message-sent",
            eventId: EventId.make(id),
            aggregateKind: "thread",
            aggregateId: threadId,
            occurredAt: now,
            commandId: null,
            causationEventId: null,
            correlationId: null,
            metadata: {},
            payload: {
              threadId,
              messageId: MessageId.make(id),
              role: "assistant",
              text: id,
              turnId: null,
              streaming: false,
              createdAt: now,
              updatedAt: now,
            },
          });
        yield* appendLegacy("first");
        yield* application.appendAgentEvents({
          events: [
            {
              id: EventId.make("v2"),
              threadId,
              type: "message.updated",
              occurredAt: DateTime.makeUnsafe(now),
              payload: {
                id: MessageId.make("v2"),
                threadId,
                runId: null,
                nodeId: null,
                role: "assistant",
                text: "V2",
                attachments: [],
                streaming: false,
                createdBy: "agent",
                creationSource: "provider",
                createdAt: DateTime.makeUnsafe(now),
                updatedAt: DateTime.makeUnsafe(now),
              },
            },
          ],
        });
        yield* appendLegacy("last");
        const rows = yield* sql<{
          readonly stream_version: number;
          readonly application_event_version: number;
        }>`SELECT stream_version, application_event_version FROM orchestration_events WHERE stream_id = ${threadId} ORDER BY sequence`;
        assert.deepEqual(
          rows.map((row) => row.application_event_version),
          [1, 2, 1],
        );
        assert.equal(new Set(rows.map((row) => row.stream_version)).size, 3);
        assert.equal(rows[2]!.stream_version - rows[0]!.stream_version, 2);
        const oldEvents = yield* Stream.runCollect(legacy.readFromSequence(0));
        assert.deepEqual(
          Array.from(oldEvents, (event) => event.eventId),
          ["first", "last"],
        );
        const newEvents = yield* Stream.runCollect(application.readAgentEvents({ threadId }));
        assert.deepEqual(
          Array.from(newEvents, (stored) => stored.event.id),
          ["v2"],
        );
        const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
        yield* sql`INSERT INTO orchestration_v2_legacy_imports (thread_id, source_updated_at, source_message_rowid, shell_imported_at, transcript_imported_at, imported_message_count) VALUES (${threadId}, ${now}, 0, ${now}, ${now}, 0)`;
        yield* sql`INSERT INTO orchestration_command_receipts (command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status) VALUES ('legacy-command', 'thread', ${threadId}, ${now}, 1, 'accepted')`;
        const stored = Array.from(newEvents)[0]!;
        if (stored.event.type === "message.updated") {
          yield* application.appendAgentEvents({
            events: [
              {
                ...stored.event,
                id: EventId.make("v2-final"),
                payload: { ...stored.event.payload, text: "Final V2 message" },
              },
            ],
          });
        }
        const compacted = yield* maintenance.compactEventStore;
        assert.equal(compacted.deletedEventCount, 1);
        assert.equal(compacted.deletedReceiptCount, 0);
        assert.equal(
          (yield* sql`SELECT * FROM orchestration_command_receipts WHERE command_id = 'legacy-command'`)
            .length,
          1,
        );
        const retained = yield* Stream.runCollect(legacy.readFromSequence(0));
        assert.deepEqual(
          Array.from(retained, (event) => event.eventId),
          ["first", "last"],
        );
      }),
  );
});

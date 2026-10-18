import { assert, it } from "@effect/vitest";
import { EventId, NodeId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { endOrphanedNativeSubagent, endRunlessRootTurns } from "./SubagentProjection.ts";
const childThreadId = ThreadId.make("orphan-child");
const parentProviderInstanceId = ProviderInstanceId.make("claudeAgent");
it.effect("ends an orphaned native subagent's node when only its record already ended", () =>
  Effect.gen(function* () {
    const id = NodeId.make("node:orphaned-native-subagent");
    const subagent = { id, origin: "provider_native", status: "running", runId: null };
    const events = yield* endOrphanedNativeSubagent({
      projection: {
        subagents: [subagent],
        nodes: [{ id, status: "running", runId: null }],
        turnItems: [],
      } as never,
      subagentId: id,
      status: "cancelled",
      now: yield* DateTime.now,
      emitted: [
        { type: "subagent.updated", payload: { ...subagent, status: "cancelled" } },
      ] as never,
      allocateEventId: () => Effect.succeed(EventId.make("event:orphaned-native-subagent")),
    });
    assert.deepEqual(
      events.map((event) => [event.type, event.type === "node.updated" && event.payload.status]),
      [["node.updated", "cancelled"]],
    );
  }),
);

it.effect("ends a runless root turn's items when its node already ended", () =>
  Effect.gen(function* () {
    const root = {
      id: NodeId.make("node:runless-root"),
      kind: "root_turn",
      status: "running",
      runId: null,
    };
    const item = (id: string) => ({ id, nodeId: root.id, runId: null, status: "running" });
    const events = yield* endRunlessRootTurns({
      threadId: childThreadId,
      providerInstanceId: parentProviderInstanceId,
      projection: {
        nodes: [root],
        turnItems: [item("turn-item:command"), item("turn-item:reasoning")],
      } as never,
      status: "cancelled",
      now: yield* DateTime.now,
      emitted: [
        {
          type: "turn-item.updated",
          payload: { ...item("turn-item:command"), status: "cancelled" },
        },
        { type: "node.updated", payload: { ...root, status: "cancelled" } },
      ] as never,
      allocateEventId: () => Effect.succeed(EventId.make("event:runless-root")),
    });
    assert.deepEqual(
      events.map(
        (event) => `${event.type} ${event.type === "turn-item.updated" && event.payload.id}`,
      ),
      ["turn-item.updated turn-item:reasoning"],
    );
  }),
);

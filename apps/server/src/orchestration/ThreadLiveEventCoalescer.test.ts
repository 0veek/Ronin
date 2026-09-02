import {
  EventId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { coalesceLiveToolUpdatedEvents } from "./ThreadLiveEventCoalescer.ts";

const threadId = ThreadId.make("thread-coalescer-test");
const turnId = TurnId.make("turn-coalescer-test");

function makeToolActivity(
  sequence: number,
  options: {
    readonly kind?: "tool.updated" | "tool.completed";
    readonly toolCallId?: string;
    readonly turnId?: TurnId;
  } = {},
): OrchestrationEvent {
  const {
    kind = "tool.updated",
    toolCallId = "call-edit",
    turnId: activityTurnId = turnId,
  } = options;
  const activity: OrchestrationThreadActivity = {
    id: EventId.make(`activity-${sequence}`),
    tone: "tool",
    kind,
    summary: "Editing app.ts",
    payload: {
      itemType: "file_change",
      title: "Editing app.ts",
      data: toolCallId ? { toolCallId } : {},
    },
    turnId: activityTurnId,
    createdAt: "2026-01-01T00:00:01.000Z",
  };
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: "2026-01-01T00:00:01.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.activity-appended",
    payload: { threadId, activity },
  };
}

describe("ThreadLiveEventCoalescer", () => {
  it("coalesces only calls with a stable toolCallId", () => {
    const events = [
      makeToolActivity(1, { toolCallId: "call-a" }),
      makeToolActivity(2, { toolCallId: "call-b" }),
      makeToolActivity(3, { toolCallId: "call-a" }),
    ];

    expect(coalesceLiveToolUpdatedEvents(events).map((event) => event.sequence)).toEqual([2, 3]);
  });

  it("preserves parallel same-label calls without a stable toolCallId", () => {
    const events = [
      makeToolActivity(1, { toolCallId: "" }),
      makeToolActivity(2, { toolCallId: "" }),
      makeToolActivity(3, { kind: "tool.completed", toolCallId: "" }),
    ];

    expect(coalesceLiveToolUpdatedEvents(events).map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("does not coalesce stable tool calls across turns", () => {
    const events = [
      makeToolActivity(1, { turnId: TurnId.make("turn-old") }),
      makeToolActivity(2, { turnId: TurnId.make("turn-new") }),
    ];

    expect(coalesceLiveToolUpdatedEvents(events).map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("flushes a stable update run before a completion boundary", () => {
    const events = [
      makeToolActivity(1),
      makeToolActivity(2),
      makeToolActivity(3, { kind: "tool.completed" }),
      makeToolActivity(4),
    ];

    expect(coalesceLiveToolUpdatedEvents(events).map((event) => event.sequence)).toEqual([2, 3, 4]);
  });
});

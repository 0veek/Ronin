import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const GROUP = "race-1";

function threadCreated(input: {
  readonly sequence: number;
  readonly threadId: string;
  readonly comparisonGroupId?: string;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: "thread.created",
    aggregateKind: "thread",
    aggregateId: ThreadId.make(input.threadId),
    occurredAt: NOW,
    commandId: CommandId.make(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: {
      threadId: ThreadId.make(input.threadId),
      projectId: ProjectId.make("project-1"),
      title: "Race entrant",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      ...(input.comparisonGroupId === undefined
        ? {}
        : { comparisonGroupId: input.comparisonGroupId }),
      createdAt: NOW,
      updatedAt: NOW,
    },
  } as unknown as OrchestrationEvent;
}

it.effect("relates every entrant in a race by its group id", () =>
  Effect.gen(function* () {
    const first = yield* projectEvent(
      createEmptyReadModel(NOW),
      threadCreated({ sequence: 1, threadId: "thread-1", comparisonGroupId: GROUP }),
    );
    const second = yield* projectEvent(
      first,
      threadCreated({ sequence: 2, threadId: "thread-2", comparisonGroupId: GROUP }),
    );
    expect(second.threads.map((thread) => thread.comparisonGroupId)).toEqual([GROUP, GROUP]);
  }),
);

it.effect("leaves an ordinary thread out of every race", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(
      createEmptyReadModel(NOW),
      threadCreated({ sequence: 1, threadId: "thread-1" }),
    );
    expect(created.threads[0]?.comparisonGroupId).toBeNull();
  }),
);

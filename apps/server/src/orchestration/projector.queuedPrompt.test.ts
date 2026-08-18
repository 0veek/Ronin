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
const CAPTURED = "Drop the legacy shim in loader.ts";

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-1"),
    occurredAt: NOW,
    commandId: CommandId.make(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

const threadCreated = (queuedPrompt: string | undefined) =>
  makeEvent({
    sequence: 1,
    type: "thread.created",
    payload: {
      threadId: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Drop the legacy shim",
      modelSelection: { provider: "codex", model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      ...(queuedPrompt === undefined ? {} : { queuedPrompt }),
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

const messageSent = (role: "user" | "assistant") =>
  makeEvent({
    sequence: 2,
    type: "thread.message-sent",
    payload: {
      threadId: ThreadId.make("thread-1"),
      messageId: "message-1",
      role,
      text: CAPTURED,
      turnId: "turn-1",
      streaming: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

it.effect("carries a captured prompt onto the created thread", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(createEmptyReadModel(NOW), threadCreated(CAPTURED));
    expect(created.threads[0]?.queuedPrompt).toBe(CAPTURED);
  }),
);

it.effect("leaves an ordinary thread with nothing queued", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(createEmptyReadModel(NOW), threadCreated(undefined));
    expect(created.threads[0]?.queuedPrompt).toBeNull();
  }),
);

it.effect("clears the prompt once the user sends, since the transcript now holds it", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(createEmptyReadModel(NOW), threadCreated(CAPTURED));
    const sent = yield* projectEvent(created, messageSent("user"));
    expect(sent.threads[0]?.queuedPrompt).toBeNull();
  }),
);

it.effect("keeps the prompt when the agent speaks rather than the user", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(createEmptyReadModel(NOW), threadCreated(CAPTURED));
    const replied = yield* projectEvent(created, messageSent("assistant"));
    expect(replied.threads[0]?.queuedPrompt).toBe(CAPTURED);
  }),
);

it.effect("discards the prompt on request and leaves the thread standing", () =>
  Effect.gen(function* () {
    const created = yield* projectEvent(createEmptyReadModel(NOW), threadCreated(CAPTURED));
    const discarded = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "thread.meta-updated",
        payload: {
          threadId: ThreadId.make("thread-1"),
          queuedPrompt: null,
          updatedAt: NOW,
        },
      }),
    );
    expect(discarded.threads[0]?.queuedPrompt).toBeNull();
    expect(discarded.threads[0]?.title).toBe("Drop the legacy shim");
  }),
);

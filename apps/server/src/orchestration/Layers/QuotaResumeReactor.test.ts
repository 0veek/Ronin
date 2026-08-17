import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { expect, it } from "@effect/vitest";
import { describe } from "vite-plus/test";
import { vi } from "vite-plus/test";

import {
  QuotaResumeService,
  type QuotaResumePark,
  type QuotaResumeServiceShape,
} from "../../quotaResume/QuotaResumeService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";
import { QuotaResumeReactor } from "../Services/QuotaResumeReactor.ts";
import { QuotaResumeReactorLive } from "./QuotaResumeReactor.ts";

const threadId = ThreadId.make("thread-quota");
const now = "2026-05-01T00:00:00.000Z";

const unsupported = <A>() =>
  Effect.die(new Error("Unsupported call in QuotaResumeReactor test")) as Effect.Effect<A, never>;

function session(overrides: Partial<OrchestrationSession>): OrchestrationSession {
  return {
    threadId,
    status: "error",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: "Usage limit reached. Your limit will reset at 3pm.",
    updatedAt: now,
    ...overrides,
  };
}

function sessionSetEvent(overrides: Partial<OrchestrationSession>): OrchestrationEvent {
  return {
    sequence: 1,
    eventId: EventId.make("event-1"),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: now,
    commandId: CommandId.make("cmd-1"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.session-set",
    payload: { threadId, session: session(overrides) },
  } as OrchestrationEvent;
}

function threadDetail(text: string): OrchestrationThread {
  return {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: "Quota thread",
    messages: [
      {
        id: MessageId.make("message-1"),
        role: "user",
        text,
        turnId: TurnId.make("turn-1"),
        streaming: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
  } as unknown as OrchestrationThread;
}

function makeHarness(
  event: OrchestrationEvent,
  options?: { readonly detail: OrchestrationThread | null },
) {
  const park = vi.fn((_park: QuotaResumePark) => Effect.succeed(null));
  const supersede = vi.fn((_threadId: ThreadId) => Effect.void);

  // A finite stream that signals when the reactor has finished consuming it.
  // `start` forks, so draining the worker is only meaningful once the event has
  // actually been enqueued - without this the assertions race the fork.
  const consumed = Deferred.makeUnsafe<void>();
  const engineLayer = Layer.succeed(OrchestrationEngineService, {
    streamDomainEvents: Stream.fromIterable([event]).pipe(
      Stream.ensuring(Deferred.succeed(consumed, undefined)),
    ),
    dispatch: () => unsupported(),
    readEvents: () => Stream.empty,
  } as unknown as OrchestrationEngineShape);

  const detail = options === undefined ? threadDetail("Please continue.") : options.detail;
  const snapshotLayer = Layer.succeed(ProjectionSnapshotQuery, {
    getThreadDetailById: () =>
      Effect.succeed(detail === null ? Option.none() : Option.some(detail)),
  } as unknown as ProjectionSnapshotQueryShape);

  const quotaLayer = Layer.succeed(QuotaResumeService, {
    park,
    supersede,
    cancel: () => unsupported(),
    runNow: () => unsupported(),
    readSnapshot: unsupported(),
  } as unknown as QuotaResumeServiceShape);

  return {
    consumed,
    park,
    supersede,
    layer: QuotaResumeReactorLive.pipe(
      Layer.provide(Layer.mergeAll(engineLayer, snapshotLayer, quotaLayer)),
    ),
  };
}

/** Runs the reactor over its event and waits on the drain rather than a sleep. */
const runHarness = (harness: ReturnType<typeof makeHarness>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const reactor = yield* QuotaResumeReactor;
      yield* reactor.start();
      yield* Deferred.await(harness.consumed);
      yield* reactor.drain;
    }).pipe(Effect.provide(harness.layer)),
  );

describe("QuotaResumeReactor", () => {
  it.effect("parks the last user message when a resumable provider hits its quota", () =>
    Effect.gen(function* () {
      const harness = makeHarness(sessionSetEvent({}));
      yield* runHarness(harness);

      expect(harness.park).toHaveBeenCalledTimes(1);
      expect(harness.park.mock.calls[0]?.[0]).toMatchObject({
        threadId,
        provider: "codex",
        text: "Please continue.",
      });
      expect(harness.supersede).not.toHaveBeenCalled();
    }),
  );

  it.effect("ignores providers whose quota window cannot be read", () =>
    Effect.gen(function* () {
      const harness = makeHarness(sessionSetEvent({ providerName: "opencode" }));
      yield* runHarness(harness);

      expect(harness.park).not.toHaveBeenCalled();
    }),
  );

  it.effect("ignores errors that are not quota exhaustion", () =>
    Effect.gen(function* () {
      const harness = makeHarness(sessionSetEvent({ lastError: "Invalid API key." }));
      yield* runHarness(harness);

      expect(harness.park).not.toHaveBeenCalled();
    }),
  );

  it.effect("does not park when the thread has no user prompt to replay", () =>
    Effect.gen(function* () {
      const harness = makeHarness(sessionSetEvent({}), { detail: null });
      yield* runHarness(harness);

      expect(harness.park).not.toHaveBeenCalled();
    }),
  );

  it.effect("supersedes a parked turn once the session is live again", () =>
    Effect.gen(function* () {
      const harness = makeHarness(sessionSetEvent({ status: "running", lastError: null }));
      yield* runHarness(harness);

      expect(harness.supersede).toHaveBeenCalledTimes(1);
      expect(harness.park).not.toHaveBeenCalled();
    }),
  );

  it.effect("leaves a parked turn alone while the session is merely idle", () =>
    Effect.gen(function* () {
      const harness = makeHarness(sessionSetEvent({ status: "ready", lastError: null }));
      yield* runHarness(harness);

      expect(harness.supersede).not.toHaveBeenCalled();
      expect(harness.park).not.toHaveBeenCalled();
    }),
  );

  const movedOnEvent = (type: string, payload: unknown): OrchestrationEvent =>
    ({
      sequence: 2,
      eventId: EventId.make("event-2"),
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: now,
      commandId: CommandId.make("cmd-2"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type,
      payload,
    }) as unknown as OrchestrationEvent;

  for (const [type, payload] of [
    ["thread.turn-start-requested", { threadId, turnId: TurnId.make("turn-2") }],
    ["thread.archived", { threadId }],
    ["thread.deleted", { threadId }],
  ] as const) {
    it.effect(`supersedes when the thread moves on via ${type}`, () =>
      Effect.gen(function* () {
        const harness = makeHarness(movedOnEvent(type, payload));
        yield* runHarness(harness);

        expect(harness.supersede).toHaveBeenCalledTimes(1);
      }),
    );
  }
});

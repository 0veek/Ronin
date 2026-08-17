import type { ChatAttachment, OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { QuotaResumeService } from "../../quotaResume/QuotaResumeService.ts";
import {
  classifyQuotaFailure,
  resumableProviderKind,
} from "../../quotaResume/quotaFailureClassification.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  QuotaResumeReactor,
  type QuotaResumeReactorShape,
} from "../Services/QuotaResumeReactor.ts";

/**
 * Events this reactor acts on.
 *
 * `thread.session-set` carries the failure. The rest are the thread moving on
 * under a parked turn: a new turn means the user did not wait, and archive or
 * delete mean there is nothing left to resume into.
 */
const WATCHED_EVENT_TYPES = new Set([
  "thread.session-set",
  "thread.turn-start-requested",
  "thread.archived",
  "thread.deleted",
]);

type WatchedEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.session-set"
      | "thread.turn-start-requested"
      | "thread.archived"
      | "thread.deleted";
  }
>;

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const quotaResume = yield* QuotaResumeService;

  /**
   * The prompt to replay: the last thing the user actually said.
   *
   * Read from the thread rather than remembered from the turn-start command,
   * because the failure can arrive long after that command left this process
   * — a resumed session, a provider restart — and the thread is the only
   * place the text is guaranteed to still exist.
   */
  const lastUserMessage = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const detail = yield* snapshotQuery
        .getThreadDetailById(threadId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(detail)) return null;
      const messages = detail.value.messages;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message !== undefined && message.role === "user" && message.text.trim().length > 0) {
          return {
            text: message.text,
            attachments: (message.attachments ?? []) as ReadonlyArray<ChatAttachment>,
          };
        }
      }
      return null;
    });

  const processSessionSet = Effect.fn("processSessionSet")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.session-set" }>,
  ) {
    const { session } = event.payload;
    if (session.status !== "error") {
      // Any healthy session state means the thread is live again, which no
      // parked replay should survive.
      if (session.status === "running" || session.status === "starting") {
        yield* quotaResume.supersede(event.payload.threadId);
      }
      return;
    }

    const provider = resumableProviderKind(session.providerName);
    if (provider === null) return;

    const nowMs = yield* Clock.currentTimeMillis;
    const failure = classifyQuotaFailure({ message: session.lastError, nowMs });
    if (failure === null) return;

    const prompt = yield* lastUserMessage(event.payload.threadId);
    if (prompt === null) return;

    yield* quotaResume.park({
      threadId: event.payload.threadId,
      provider,
      windowKind: failure.windowKind,
      explicitResetAt: failure.explicitResetAt,
      detail: session.lastError,
      text: prompt.text,
      attachments: prompt.attachments,
    });
  });

  const processEvent = Effect.fn("processEvent")(function* (event: WatchedEvent) {
    if (event.type === "thread.session-set") {
      yield* processSessionSet(event);
      return;
    }
    yield* quotaResume.supersede(event.payload.threadId);
  });

  const processEventSafely = (event: WatchedEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("quota resume reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const start: QuotaResumeReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (!WATCHED_EVENT_TYPES.has(event.type)) {
          return Effect.void;
        }
        return worker.enqueue(event as WatchedEvent);
      }),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies QuotaResumeReactorShape;
});

export const QuotaResumeReactorLive = Layer.effect(QuotaResumeReactor, make);

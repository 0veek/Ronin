import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { BuildSystemService } from "../../buildSystem/BuildSystemService.ts";
import { forkParked } from "../../serverActivation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  BuildSystemRunReactor,
  type BuildSystemRunReactorShape,
} from "../Services/BuildSystemRunReactor.ts";

/**
 * Events this reactor acts on.
 *
 * `thread.turn-diff-completed` is the success path: the checkpoint exists, so
 * a report can name the files that changed. `thread.session-set` is only the
 * failure and interrupt path — idle/running updates are ignored so a finished
 * turn is not processed twice.
 */
const WATCHED_EVENT_TYPES = new Set(["thread.turn-diff-completed", "thread.session-set"]);

type WatchedEvent = Extract<
  OrchestrationEvent,
  { type: "thread.turn-diff-completed" | "thread.session-set" }
>;

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const buildSystems = yield* BuildSystemService;

  const processEvent = Effect.fn("processEvent")(function* (event: WatchedEvent) {
    if (event.type === "thread.turn-diff-completed") {
      yield* buildSystems.handleTurnSettled({
        threadId: event.payload.threadId,
        turnId: event.payload.turnId,
        files: event.payload.files,
        assistantMessageId: event.payload.assistantMessageId,
      });
      return;
    }
    yield* buildSystems.handleSessionSet({
      threadId: event.payload.threadId,
      status: event.payload.session.status,
      lastError: event.payload.session.lastError,
    });
  });

  const processEventSafely = (event: WatchedEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("build system reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const start: BuildSystemRunReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (!WATCHED_EVENT_TYPES.has(event.type)) {
          return Effect.void;
        }
        return worker.enqueue(event as WatchedEvent);
      }),
    );
    yield* buildSystems.recover;
  });

  return {
    start,
    drain: worker.drain,
  } satisfies BuildSystemRunReactorShape;
});

export const BuildSystemRunReactorLive = Layer.effect(BuildSystemRunReactor, make);

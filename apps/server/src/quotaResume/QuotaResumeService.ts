/**
 * QuotaResumeService - holds a turn that died on a spent subscription window
 * and replays it once the window turns over.
 *
 * The state here is intentionally in memory. A parked turn is a promise about
 * the near future, and a promise made before a restart is one nobody is
 * waiting on any more: the user who walked away from a running Ronin comes
 * back to a running Ronin, and the user who quit it chose to stop. Persisting
 * these would mean a relaunch days later replaying prompts whose worktrees
 * have moved on, which is worse than forgetting.
 *
 * One thread parks at most one turn. A second failure on the same thread
 * replaces the first rather than queueing behind it — the newer prompt is the
 * one the user actually cares about.
 *
 * @module QuotaResumeService
 */
import {
  type ChatAttachment,
  CommandId,
  MessageId,
  type QuotaResume,
  type QuotaResumeSnapshot,
  QUOTA_RESUME_MAX_ATTEMPTS,
  quotaResumeMaximumWaitMs,
  type RateLimitProviderKind,
  type RateLimitWindowKind,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { RateLimitService } from "../rateLimits/RateLimitService.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveResumeAt } from "./quotaFailureClassification.ts";

/** Longest provider message kept for the banner. */
const MAX_DETAIL_CHARS = 240;

export interface QuotaResumePark {
  readonly threadId: ThreadId;
  readonly provider: RateLimitProviderKind;
  readonly windowKind: RateLimitWindowKind | null;
  /** Reset instant the provider stated outright, if any. */
  readonly explicitResetAt: string | null;
  readonly detail: string | null;
  /** The prompt to replay, verbatim. */
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}

export interface QuotaResumeServiceShape {
  /**
   * Park a failed turn for replay.
   *
   * Returns the armed row, or `null` when this failure is not worth waiting
   * for: the feature is off, no reset time is knowable, the wait is longer
   * than the user allows, or the prompt has already burned its attempts.
   */
  readonly park: (park: QuotaResumePark) => Effect.Effect<QuotaResume | null>;
  /** Drop a parked turn. False when there was nothing parked. */
  readonly cancel: (threadId: ThreadId) => Effect.Effect<boolean>;
  /** Fire a parked turn now instead of at its reset. */
  readonly runNow: (threadId: ThreadId) => Effect.Effect<boolean>;
  /**
   * Drop a parked turn because the thread moved on under it — a new turn, an
   * archive, a delete. Distinct from {@link cancel} only in that it is not a
   * user action and never needs a result.
   */
  readonly supersede: (threadId: ThreadId) => Effect.Effect<void>;
  readonly readSnapshot: Effect.Effect<QuotaResumeSnapshot>;
}

export class QuotaResumeService extends Context.Service<
  QuotaResumeService,
  QuotaResumeServiceShape
>()("t3/quotaResume/QuotaResumeService") {}

interface ParkedEntry {
  readonly row: QuotaResume;
  readonly park: QuotaResumePark;
  readonly fiber: Fiber.Fiber<void> | null;
}

function boundedDetail(detail: string | null): string | null {
  const trimmed = detail?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return trimmed.length <= MAX_DETAIL_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_DETAIL_CHARS - 1)}…`;
}

export const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const rateLimits = yield* RateLimitService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4;

  const parked = new Map<ThreadId, ParkedEntry>();
  /**
   * Attempts survive the entry itself: an entry is cleared the moment it
   * fires, so without a separate tally the provider refusing again would look
   * like a first attempt forever.
   */
  const attempts = new Map<ThreadId, number>();

  const clearFiber = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const entry = parked.get(threadId);
      if (entry?.fiber != null) {
        yield* Fiber.interrupt(entry.fiber);
      }
    });

  /**
   * Replay the parked prompt as a fresh turn.
   *
   * A new turn rather than a retry of the old one: the failed turn is real
   * history the user can scroll back to, and rewriting it would make the
   * thread lie about what happened.
   */
  const fire = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const entry = parked.get(threadId);
      if (entry === undefined) return;
      parked.set(threadId, { ...entry, row: { ...entry.row, state: "resuming" }, fiber: null });

      const now = DateTime.formatIso(yield* DateTime.now);
      yield* orchestrationEngine
        .dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`server:quota-resume:${yield* randomUUID}`),
          threadId,
          message: {
            messageId: MessageId.make(yield* randomUUID),
            role: "user",
            text: entry.park.text,
            attachments: entry.park.attachments,
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: now,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("quota resume could not restart the turn", {
              threadId,
              cause: Cause.pretty(cause),
            }),
          ),
        );

      // Cleared unconditionally: if the dispatch failed the thread is no
      // longer in a state this scheduler understands, and holding a row that
      // will never fire is worse than dropping it.
      parked.delete(threadId);
    });

  const park: QuotaResumeServiceShape["park"] = Effect.fn("park")(function* (
    request: QuotaResumePark,
  ) {
    const nowMs = yield* Clock.currentTimeMillis;

    const settings = yield* settingsService.getSettings.pipe(Effect.orElseSucceed(() => null));
    const maximumWaitMs = quotaResumeMaximumWaitMs(settings?.quotaResume.maximumWait ?? "6h");
    if (maximumWaitMs === 0) return null;

    const attempt = (attempts.get(request.threadId) ?? 0) + 1;
    if (attempt > QUOTA_RESUME_MAX_ATTEMPTS) return null;

    // The provider's own message wins; the usage snapshot is the fallback for
    // refusals that name no time. A snapshot read failure is not fatal — an
    // explicit reset in the message still parks fine without it.
    const snapshot = yield* rateLimits.readSnapshot.pipe(Effect.orElseSucceed(() => null));
    const providerRow = snapshot?.providers.find((row) => row.provider === request.provider);
    const windowResetAt =
      providerRow?.windows.find((window) =>
        request.windowKind === null ? true : window.kind === request.windowKind,
      )?.resetsAt ?? null;

    const resumeAt = resolveResumeAt({
      explicitResetAt: request.explicitResetAt,
      windowResetAt,
      nowMs,
    });
    if (resumeAt === null) return null;

    attempts.set(request.threadId, attempt);
    yield* clearFiber(request.threadId);

    const waitMs = Date.parse(resumeAt) - nowMs;
    const withinBudget = maximumWaitMs === null || waitMs <= maximumWaitMs;
    const row: QuotaResume = {
      threadId: request.threadId,
      provider: request.provider,
      windowKind: request.windowKind,
      state: withinBudget ? "scheduled" : "blocked",
      resumeAt,
      parkedAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
      attempt,
      detail: boundedDetail(request.detail),
    };

    if (!withinBudget) {
      // Kept visible rather than dropped: the user asked not to wait *this*
      // long automatically, not to lose the prompt. The banner offers the
      // manual retry.
      parked.set(request.threadId, { row, park: request, fiber: null });
      return row;
    }

    // `orDie` because the only failure left in `fire` is the platform refusing
    // to produce a UUID; there is no scheduler behaviour that could recover
    // from that, and a live error channel would leak into every caller.
    const fiber = yield* Effect.forkDetach(
      Effect.sleep(`${Math.max(waitMs, 0)} millis`).pipe(
        Effect.andThen(fire(request.threadId)),
        Effect.orDie,
      ),
    );
    parked.set(request.threadId, { row, park: request, fiber });
    return row;
  });

  const cancel: QuotaResumeServiceShape["cancel"] = Effect.fn("cancel")(function* (
    threadId: ThreadId,
  ) {
    if (!parked.has(threadId)) return false;
    yield* clearFiber(threadId);
    parked.delete(threadId);
    // A cancel is the user taking the thread back, so the next quota wall on
    // it starts from a clean tally rather than inheriting this one's.
    attempts.delete(threadId);
    return true;
  });

  const runNow: QuotaResumeServiceShape["runNow"] = Effect.fn("runNow")(function* (
    threadId: ThreadId,
  ) {
    if (!parked.has(threadId)) return false;
    yield* clearFiber(threadId);
    yield* fire(threadId).pipe(Effect.orDie);
    return true;
  });

  const supersede: QuotaResumeServiceShape["supersede"] = Effect.fn("supersede")(function* (
    threadId: ThreadId,
  ) {
    const entry = parked.get(threadId);
    // A row mid-fire is the turn this scheduler just started. Treating that
    // as the thread moving on under us would cancel our own replay.
    if (entry === undefined || entry.row.state === "resuming") return;
    yield* clearFiber(threadId);
    parked.delete(threadId);
    attempts.delete(threadId);
  });

  const readSnapshot = Effect.gen(function* () {
    return {
      resumes: [...parked.values()].map((entry) => entry.row),
      readAt: DateTime.formatIso(yield* DateTime.now),
    } satisfies QuotaResumeSnapshot;
  });

  return QuotaResumeService.of({ park, cancel, runNow, supersede, readSnapshot });
});

export const layer = Layer.effect(QuotaResumeService, make);

/** Inert service, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  QuotaResumeService,
  QuotaResumeService.of({
    park: () => Effect.succeed(null),
    cancel: () => Effect.succeed(false),
    runNow: () => Effect.succeed(false),
    supersede: () => Effect.void,
    readSnapshot: Effect.succeed({ resumes: [], readAt: "1970-01-01T00:00:00.000Z" }),
  }),
);

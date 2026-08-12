/**
 * PiAdapter — `@earendil-works/pi-coding-agent` in-process runtime.
 *
 * Synara's implementation also injects a host gateway. Ronin loads the Pi
 * SDK lazily and maps session prompt events onto the shared adapter stream.
 *
 * @module PiAdapter
 */
import {
  EventId,
  type PiSettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { type PiAdapterShape } from "../Services/PiAdapter.ts";

const PROVIDER = ProviderDriverKind.make("pi");
const PI_RESUME_VERSION = 1 as const;

interface PiAgentSession {
  prompt: (input: string) => Promise<unknown>;
  abort?: () => Promise<unknown> | unknown;
  dispose?: () => Promise<unknown> | unknown;
  subscribe?: (listener: (event: { type?: string; text?: string }) => void) => () => void;
  sessionFile?: string;
  sessionManager?: { getSessionFile?: () => string | undefined };
}

interface PiAgentRuntime {
  session: PiAgentSession;
}

interface PiCodingAgentModule {
  createAgentSessionRuntime: (input: {
    cwd: string;
    sessionFile?: string;
    agentDir?: string;
  }) => Promise<PiAgentRuntime>;
}

let piModulePromise: Promise<PiCodingAgentModule> | undefined;

function loadPiCodingAgentModule(): Promise<PiCodingAgentModule> {
  piModulePromise ??= (
    Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<PiCodingAgentModule>
  )("@earendil-works/pi-coding-agent");
  return piModulePromise;
}

export interface PiAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
}

interface PiStoredTurn {
  readonly id: TurnId;
  readonly items: unknown[];
}

interface PiSessionContext {
  session: ProviderSession;
  runtime: PiAgentRuntime;
  unsubscribe: (() => void) | undefined;
  readonly turns: PiStoredTurn[];
  activeTurnId: TurnId | undefined;
  stopped: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePiResume(raw: unknown): { sessionFile: string } | undefined {
  if (typeof raw === "string" && raw.trim()) return { sessionFile: raw.trim() };
  if (!isRecord(raw) || raw.schemaVersion !== PI_RESUME_VERSION) return undefined;
  if (typeof raw.sessionFile !== "string" || !raw.sessionFile.trim()) return undefined;
  return { sessionFile: raw.sessionFile.trim() };
}

export function makePiAdapter(settings: PiSettings, options?: PiAdapterLiveOptions) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("pi");
    const serverConfig = yield* Effect.service(ServerConfig);
    const crypto = yield* Crypto.Crypto;
    const sessions = new Map<ThreadId, PiSessionContext>();
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate Pi runtime identifier.",
            cause,
          }),
      ),
    );
    const makeEventStamp = () =>
      Effect.all({
        eventId: Effect.map(randomUUIDv4, (id) => EventId.make(id)),
        createdAt: nowIso,
      });
    const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    const requireSession = (threadId: ThreadId) => {
      const ctx = sessions.get(threadId);
      return ctx && !ctx.stopped
        ? Effect.succeed(ctx)
        : Effect.fail(
            new ProviderAdapterSessionNotFoundError({
              provider: PROVIDER,
              threadId,
            }),
          );
    };

    const startSession: PiAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        if (sessions.has(input.threadId) && !sessions.get(input.threadId)?.stopped) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "A Pi session is already active for this thread.",
          });
        }
        const module = yield* Effect.tryPromise({
          try: () => loadPiCodingAgentModule(),
          catch: (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail:
                "Pi coding agent is not installed. Add `@earendil-works/pi-coding-agent` or install the `pi` CLI.",
              cause,
            }),
        });
        const cwd = input.cwd ?? serverConfig.cwd;
        const resume = parsePiResume(input.resumeCursor);
        const runtime = yield* Effect.tryPromise({
          try: () =>
            module.createAgentSessionRuntime({
              cwd,
              ...(resume ? { sessionFile: resume.sessionFile } : {}),
              ...(settings.agentDir.trim() ? { agentDir: settings.agentDir.trim() } : {}),
            }),
          catch: (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: "Failed to start a Pi coding-agent session.",
              cause,
            }),
        });
        const now = yield* nowIso;
        const sessionFile =
          runtime.session.sessionFile ?? runtime.session.sessionManager?.getSessionFile?.();
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd,
          model: input.modelSelection?.model,
          threadId: input.threadId,
          ...(sessionFile
            ? {
                resumeCursor: {
                  schemaVersion: PI_RESUME_VERSION,
                  sessionFile,
                },
              }
            : {}),
          createdAt: now,
          updatedAt: now,
        };
        const ctx: PiSessionContext = {
          session,
          runtime,
          unsubscribe: undefined,
          turns: [],
          activeTurnId: undefined,
          stopped: false,
        };
        ctx.unsubscribe = runtime.session.subscribe?.((event) => {
          if (ctx.activeTurnId === undefined) return;
          if (event.type === "message_update" && typeof event.text === "string" && event.text) {
            const turnId = ctx.activeTurnId;
            void Effect.runPromise(
              Effect.gen(function* () {
                yield* offerRuntimeEvent({
                  type: "content.delta",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  payload: { streamKind: "assistant_text", delta: event.text ?? "" },
                });
              }),
            );
          }
        });
        sessions.set(input.threadId, ctx);
        yield* offerRuntimeEvent({
          type: "session.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          payload: { resume: resume ?? null },
        });
        yield* offerRuntimeEvent({
          type: "session.state.changed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          payload: { state: "ready", reason: "Pi session ready" },
        });
        return session;
      });

    const sendTurn: PiAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        const prompt = input.input?.trim() ?? "";
        if (!prompt) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "A prompt is required.",
          });
        }
        const turnId = TurnId.make(yield* randomUUIDv4);
        ctx.activeTurnId = turnId;
        ctx.turns.push({ id: turnId, items: [] });
        ctx.session = {
          ...ctx.session,
          status: "running",
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
          activeTurnId: turnId,
          updatedAt: yield* nowIso,
        };
        yield* offerRuntimeEvent({
          type: "turn.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId,
          payload: { model: ctx.session.model },
        });
        yield* Effect.tryPromise({
          try: () => ctx.runtime.session.prompt(prompt),
          catch: (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: "Pi prompt failed.",
              cause,
            }),
        }).pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              ctx.activeTurnId = undefined;
              const updatedAt = yield* nowIso;
              const { activeTurnId: _activeTurnId, ...readySession } = ctx.session;
              ctx.session = { ...readySession, status: "ready", updatedAt };
              yield* offerRuntimeEvent({
                type: "turn.completed",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: input.threadId,
                turnId,
                payload: { state: "completed" },
              });
            }),
          ),
          Effect.tapError((error) =>
            Effect.gen(function* () {
              ctx.activeTurnId = undefined;
              const updatedAt = yield* nowIso;
              const { activeTurnId: _activeTurnId, ...readySession } = ctx.session;
              ctx.session = { ...readySession, status: "ready", updatedAt };
              yield* offerRuntimeEvent({
                type: "turn.completed",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: input.threadId,
                turnId,
                payload: { state: "failed", errorMessage: error.detail },
              });
            }),
          ),
          Effect.forkChild,
        );
        return { threadId: input.threadId, turnId };
      });

    const interruptTurn: PiAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const interruptedTurnId = turnId ?? ctx.activeTurnId;
        yield* Effect.tryPromise({
          try: async () => {
            await ctx.runtime.session.abort?.();
          },
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "interruptTurn",
              detail: "Failed to abort the Pi turn.",
              cause,
            }),
        }).pipe(Effect.ignore);
        ctx.activeTurnId = undefined;
        const updatedAt = yield* nowIso;
        const { activeTurnId: _activeTurnId, ...readySession } = ctx.session;
        ctx.session = { ...readySession, status: "ready", updatedAt };
        if (interruptedTurnId) {
          yield* offerRuntimeEvent({
            type: "turn.completed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId,
            turnId: interruptedTurnId,
            payload: { state: "cancelled" },
          });
        }
      });

    const unsupportedRequest = (threadId: ThreadId, method: string) =>
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method,
        detail: `Pi does not expose this interactive request for ${threadId}.`,
      });

    const stopSessionInternal = (ctx: PiSessionContext) =>
      Effect.sync(() => {
        if (ctx.stopped) return;
        ctx.stopped = true;
        ctx.unsubscribe?.();
        void ctx.runtime.session.dispose?.();
      });

    const stopSession: PiAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        yield* stopSessionInternal(ctx);
        sessions.delete(threadId);
      });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true }).pipe(
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest: (threadId) => Effect.fail(unsupportedRequest(threadId, "respondToRequest")),
      respondToUserInput: (threadId) =>
        Effect.fail(unsupportedRequest(threadId, "respondToUserInput")),
      stopSession,
      listSessions: () =>
        Effect.sync(() => Array.from(sessions.values(), (c) => ({ ...c.session }))),
      hasSession: (threadId) =>
        Effect.sync(() => {
          const c = sessions.get(threadId);
          return c !== undefined && !c.stopped;
        }),
      readThread: (threadId) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          return { threadId, turns: ctx.turns };
        }),
      rollbackThread: () =>
        Effect.fail(
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "rollbackThread",
            detail: "Pi sessions do not support provider-side rollback yet.",
          }),
        ),
      stopAll: () =>
        Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true }),
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies PiAdapterShape;
  });
}

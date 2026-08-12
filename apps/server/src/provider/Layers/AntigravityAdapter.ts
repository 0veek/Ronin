/**
 * AntigravityAdapter — Google Antigravity CLI (`agy -p`) print/stdio runtime.
 *
 * Synara's implementation polls hook files and injects a host gateway. Ronin
 * keeps the same CLI contract (`agy --print-timeout -p`) and maps stdout /
 * process lifetime onto the shared adapter event stream.
 *
 * @module AntigravityAdapter
 */
// @effect-diagnostics nodeBuiltinImport:off
import { spawn, type ChildProcess } from "node:child_process";

import {
  type AntigravitySettings,
  EventId,
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
import { type AntigravityAdapterShape } from "../Services/AntigravityAdapter.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");
const DEFAULT_MODEL = "Gemini 3.5 Flash";
const PRINT_TIMEOUT = "30m";
const ANTIGRAVITY_RESUME_VERSION = 1 as const;

export interface AntigravityAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly instanceId?: ProviderInstanceId;
}

interface StoredTurn {
  readonly id: TurnId;
  readonly items: unknown[];
}

interface AntigravitySessionContext {
  session: ProviderSession;
  readonly turns: StoredTurn[];
  activeTurnId: TurnId | undefined;
  activeProcess: ChildProcess | undefined;
  conversationId: string | undefined;
  stopped: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAntigravityResume(raw: unknown): { conversationId: string } | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== ANTIGRAVITY_RESUME_VERSION) return undefined;
  if (typeof raw.conversationId !== "string" || !raw.conversationId.trim()) return undefined;
  return { conversationId: raw.conversationId.trim() };
}

function messageFromCause(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

export function makeAntigravityAdapter(
  settings: AntigravitySettings,
  options?: AntigravityAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("antigravity");
    const serverConfig = yield* Effect.service(ServerConfig);
    const crypto = yield* Crypto.Crypto;
    const sessions = new Map<ThreadId, AntigravitySessionContext>();
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate Antigravity runtime identifier.",
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

    const startSession: AntigravityAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        if (sessions.has(input.threadId) && !sessions.get(input.threadId)?.stopped) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "An Antigravity session is already active for this thread.",
          });
        }
        const now = yield* nowIso;
        const resume = parseAntigravityResume(input.resumeCursor);
        const model = input.modelSelection?.model?.trim() || DEFAULT_MODEL;
        const session: ProviderSession = {
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: input.cwd ?? serverConfig.cwd,
          model,
          threadId: input.threadId,
          ...(resume
            ? {
                resumeCursor: {
                  schemaVersion: ANTIGRAVITY_RESUME_VERSION,
                  conversationId: resume.conversationId,
                },
              }
            : {}),
          createdAt: now,
          updatedAt: now,
        };
        sessions.set(input.threadId, {
          session,
          turns: [],
          activeTurnId: undefined,
          activeProcess: undefined,
          conversationId: resume?.conversationId,
          stopped: false,
        });
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
          payload: { state: "ready", reason: "Antigravity session ready" },
        });
        return session;
      });

    const sendTurn: AntigravityAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        if (ctx.activeProcess) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "An Antigravity turn is already active for this thread.",
          });
        }
        const prompt = input.input?.trim() ?? "";
        if (!prompt) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "turn/start",
            issue: "A prompt is required.",
          });
        }
        const turnId = TurnId.make(yield* randomUUIDv4);
        const model = input.modelSelection?.model?.trim() || ctx.session.model || DEFAULT_MODEL;
        const cwd = ctx.session.cwd ?? serverConfig.cwd;
        const command = settings.binaryPath || "agy";
        const args = [
          ...(ctx.conversationId ? ["--conversation", ctx.conversationId] : ["--new-project"]),
          "--dangerously-skip-permissions",
          "--model",
          model,
          "--print-timeout",
          PRINT_TIMEOUT,
          "-p",
          prompt,
        ];
        ctx.activeTurnId = turnId;
        ctx.turns.push({ id: turnId, items: [] });
        ctx.session = {
          ...ctx.session,
          status: "running",
          model,
          activeTurnId: turnId,
          updatedAt: yield* nowIso,
        };
        yield* offerRuntimeEvent({
          type: "turn.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId,
          payload: { model },
        });

        const child = yield* Effect.try({
          try: () =>
            spawn(command, args, {
              cwd,
              env: options?.environment,
              stdio: ["ignore", "pipe", "pipe"],
            }),
          catch: (cause) =>
            new ProviderAdapterProcessError({
              provider: PROVIDER,
              threadId: input.threadId,
              detail: messageFromCause(cause, "Failed to launch Antigravity CLI."),
              cause,
            }),
        });
        ctx.activeProcess = child;
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          if (!chunk.trim()) return;
          void Effect.runPromise(
            Effect.gen(function* () {
              yield* offerRuntimeEvent({
                type: "content.delta",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: input.threadId,
                turnId,
                payload: { streamKind: "assistant_text", delta: chunk },
              });
            }),
          );
        });
        child.once("close", (code) => {
          if (sessions.get(input.threadId) !== ctx || ctx.activeTurnId !== turnId) {
            return;
          }
          ctx.activeProcess = undefined;
          ctx.activeTurnId = undefined;
          void Effect.runPromise(
            Effect.gen(function* () {
              const updatedAt = yield* nowIso;
              const { activeTurnId: _activeTurnId, ...readySession } = ctx.session;
              ctx.session = { ...readySession, status: "ready", updatedAt };
              yield* offerRuntimeEvent({
                type: "turn.completed",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: input.threadId,
                turnId,
                payload: {
                  state: code === 0 ? "completed" : "failed",
                  ...(code === 0
                    ? {}
                    : { errorMessage: `Antigravity CLI exited with code ${String(code)}.` }),
                },
              });
            }),
          );
        });

        return { threadId: input.threadId, turnId };
      });

    const interruptTurn: AntigravityAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const child = ctx.activeProcess;
        if (!child) return;
        const interruptedTurnId = turnId ?? ctx.activeTurnId;
        child.kill();
        ctx.activeProcess = undefined;
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
        detail: `Antigravity print mode does not expose interactive requests for ${threadId}.`,
      });

    const stopSessionInternal = (ctx: AntigravitySessionContext) =>
      Effect.sync(() => {
        if (ctx.stopped) return;
        ctx.stopped = true;
        ctx.activeProcess?.kill();
        ctx.activeProcess = undefined;
        ctx.activeTurnId = undefined;
      });

    const stopSession: AntigravityAdapterShape["stopSession"] = (threadId) =>
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
      capabilities: { sessionModelSwitch: "unsupported" },
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
            detail: "Antigravity print sessions do not support provider-side rollback yet.",
          }),
        ),
      stopAll: () =>
        Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true }),
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies AntigravityAdapterShape;
  });
}

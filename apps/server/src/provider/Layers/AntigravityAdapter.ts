/**
 * AntigravityAdapter — Google Antigravity CLI (`agy -p`) print/stdio runtime.
 *
 * Each turn is one `agy` process. The CLI is driven in its NDJSON mode
 * (`--output-format stream-json`) rather than plain text, because that is the
 * only place it names the conversation it just ran: without that id every
 * follow-up would have to open a fresh `--new-project` and answer with no
 * memory of the turn before it. See `AntigravityStream` for the protocol.
 *
 * @module AntigravityAdapter
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import {
  type AntigravitySettings,
  DEFAULT_MODEL_BY_PROVIDER,
  EventId,
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  type RuntimeMode,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";
import { resolveSpawnCommand, terminateProcessTree } from "@t3tools/shared/shell";
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
import { type AntigravityStreamEvent, parseAntigravityStreamLine } from "./AntigravityStream.ts";

const PROVIDER = ProviderDriverKind.make("antigravity");
const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER[PROVIDER] ?? "gemini-3.5-flash-medium";
const PRINT_TIMEOUT = "30m";
/** Enough of a rejected launch to read, without holding a runaway log in memory. */
const STDERR_CAPTURE_LIMIT = 4_000;
const ANTIGRAVITY_RESUME_VERSION = 1 as const;

/**
 * `agy` matches `--model` against the ids from `agy models`, never against the
 * labels it prints beside them, and answers anything else with a hard
 * "invalid model selection". Threads saved under the old label-shaped slugs go
 * through the contracts alias table on their way to the command line.
 */
function resolveAntigravityModel(model: string | null | undefined): string {
  return normalizeModelSlug(model, PROVIDER) ?? DEFAULT_MODEL;
}

/**
 * Ends the CLI and whatever it started.
 *
 * Windows needs the tree walk: the handle here belongs to the `agy.cmd` shim's
 * cmd.exe, and terminating that alone would leave the agent running with nothing
 * left to stop it by.
 */
const killChildTree = (child: NodeChildProcess.ChildProcess): Effect.Effect<void> =>
  terminateProcessTree(child.pid).pipe(Effect.andThen(Effect.sync(() => child.kill())));

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
  activeProcess: NodeChildProcess.ChildProcess | undefined;
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

/**
 * Translates the thread's access setting into the CLI's own vocabulary.
 *
 * Print mode cannot stop to ask, so `agy` declines anything that would need a
 * prompt. That makes Supervised honest rather than useless: the agent reports
 * what it was not allowed to do instead of silently doing it, which is what
 * passing `--dangerously-skip-permissions` on every turn used to mean.
 */
export function antigravityAccessArgs(input: {
  readonly runtimeMode: RuntimeMode | undefined;
  readonly interactionMode: ProviderInteractionMode | undefined;
}): ReadonlyArray<string> {
  if (input.interactionMode === "plan") return ["--mode", "plan"];
  switch (input.runtimeMode) {
    case "approval-required":
      return [];
    case "auto-accept-edits":
      return ["--mode", "accept-edits"];
    default:
      return ["--dangerously-skip-permissions"];
  }
}

export function antigravityTurnArgs(input: {
  readonly conversationId: string | undefined;
  readonly model: string;
  readonly prompt: string;
  readonly runtimeMode: RuntimeMode | undefined;
  readonly interactionMode: ProviderInteractionMode | undefined;
}): ReadonlyArray<string> {
  return [
    ...(input.conversationId ? ["--conversation", input.conversationId] : ["--new-project"]),
    ...antigravityAccessArgs(input),
    "--model",
    input.model,
    "--output-format",
    "stream-json",
    "--print-timeout",
    PRINT_TIMEOUT,
    "-p",
    input.prompt,
  ];
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
    // The CLI's stdout/close handlers fire outside the fiber. Running them with
    // the captured context keeps the adapter's logger, tracer, and fiber refs
    // attached instead of spawning each callback on a fresh default runtime.
    const runDetached = Effect.runPromiseWith(yield* Effect.context<never>());

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

    /**
     * A thread carries one model selection, and it belongs to whichever
     * instance the user picked. Handing another instance's slug to this CLI
     * would spend the turn on `invalid model selection`.
     */
    const selectionForThisInstance = (selection: ModelSelection | undefined) =>
      selection?.instanceId === boundInstanceId ? selection : undefined;

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
        const model = resolveAntigravityModel(
          selectionForThisInstance(input.modelSelection)?.model,
        );
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
        const modelSelection = selectionForThisInstance(input.modelSelection);
        const model = resolveAntigravityModel(modelSelection?.model ?? ctx.session.model);
        const cwd = ctx.session.cwd ?? serverConfig.cwd;
        const command = settings.binaryPath || "agy";
        const args = antigravityTurnArgs({
          conversationId: ctx.conversationId,
          model,
          prompt,
          runtimeMode: ctx.session.runtimeMode,
          interactionMode: input.interactionMode,
        });
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

        // `agy` is an npm shim, so on Windows it is `agy.cmd` — a name Node
        // refuses to spawn directly and only finds through PATHEXT. The shared
        // resolver answers both: the real executable, and whether it has to go
        // through cmd.exe (with every argument escaped for it).
        const spawnCommand = yield* resolveSpawnCommand(
          command,
          args,
          options?.environment ? { env: options.environment } : {},
        );
        const child = yield* Effect.try({
          try: () =>
            NodeChildProcess.spawn(spawnCommand.command, spawnCommand.args, {
              cwd,
              env: options?.environment,
              stdio: ["ignore", "pipe", "pipe"],
              shell: spawnCommand.shell,
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
        // The CLI writes its launch rejections (an unknown `--model`, a missing
        // login) to stderr and then exits, so without this a bad model reads as
        // a bare exit code in the UI.
        let stderrTail = "";
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk: string) => {
          stderrTail = `${stderrTail}${chunk}`.slice(-STDERR_CAPTURE_LIMIT);
        });

        const openToolSteps = new Set<number>();
        let turnFailure: string | undefined;
        let sawAssistantText = false;
        const handleStreamEvent = (event: AntigravityStreamEvent) =>
          Effect.gen(function* () {
            switch (event.kind) {
              case "init": {
                if (ctx.conversationId === event.conversationId) return;
                ctx.conversationId = event.conversationId;
                ctx.session = {
                  ...ctx.session,
                  resumeCursor: {
                    schemaVersion: ANTIGRAVITY_RESUME_VERSION,
                    conversationId: event.conversationId,
                  },
                  updatedAt: yield* nowIso,
                };
                yield* offerRuntimeEvent({
                  type: "thread.started",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  payload: { providerThreadId: event.conversationId },
                });
                return;
              }
              case "text": {
                sawAssistantText = true;
                yield* offerRuntimeEvent({
                  type: "content.delta",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  payload: { streamKind: "assistant_text", delta: event.delta },
                });
                return;
              }
              case "tool": {
                const itemId = RuntimeItemId.make(`${turnId}:${String(event.stepIndex)}`);
                const payloadFor = (
                  status: "inProgress" | "completed" | "failed" | "declined",
                ) => ({
                  itemType: event.itemType,
                  status,
                  title: event.title,
                  ...(event.detail ? { detail: event.detail } : {}),
                  data: event.data,
                });
                const emit = (
                  type: "item.started" | "item.updated" | "item.completed",
                  status: "inProgress" | "completed" | "failed" | "declined",
                ) =>
                  makeEventStamp().pipe(
                    Effect.flatMap((stamp) =>
                      offerRuntimeEvent({
                        type,
                        ...stamp,
                        provider: PROVIDER,
                        threadId: input.threadId,
                        turnId,
                        itemId,
                        payload: payloadFor(status),
                      }),
                    ),
                  );

                // A tool the CLI opened and closed between two reads still needs
                // its opening event, or the timeline shows a result for work it
                // never saw start.
                if (!openToolSteps.has(event.stepIndex)) {
                  openToolSteps.add(event.stepIndex);
                  yield* emit("item.started", "inProgress");
                } else if (!event.completed) {
                  yield* emit("item.updated", "inProgress");
                }
                if (event.completed) {
                  openToolSteps.delete(event.stepIndex);
                  yield* emit("item.completed", event.status ?? "completed");
                }
                return;
              }
              case "result": {
                if (!event.succeeded) turnFailure = event.message ?? "Antigravity turn failed.";
                if (event.usage) {
                  yield* offerRuntimeEvent({
                    type: "thread.token-usage.updated",
                    ...(yield* makeEventStamp()),
                    provider: PROVIDER,
                    threadId: input.threadId,
                    turnId,
                    payload: { usage: event.usage },
                  });
                }
              }
            }
          });

        // stdout callbacks fire in order but their effects do not, so each batch
        // waits on the one before it. Interleaved text deltas would rewrite the
        // assistant's reply into nonsense.
        let pending: Promise<unknown> = Promise.resolve();
        const enqueue = (effect: Effect.Effect<void, ProviderAdapterRequestError>) => {
          pending = pending.then(() => runDetached(effect)).catch(() => undefined);
        };

        let stdoutBuffer = "";
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          stdoutBuffer += chunk;
          const lines = stdoutBuffer.split("\n");
          stdoutBuffer = lines.pop() ?? "";
          const events = lines
            .map(parseAntigravityStreamLine)
            .filter((event): event is AntigravityStreamEvent => event !== null);
          if (events.length === 0) return;
          enqueue(Effect.forEach(events, handleStreamEvent, { discard: true }));
        });

        child.once("close", (code) => {
          if (sessions.get(input.threadId) !== ctx || ctx.activeTurnId !== turnId) {
            return;
          }
          ctx.activeProcess = undefined;
          ctx.activeTurnId = undefined;
          // The CLI does not always end its last line, and that line is usually
          // the `result` this turn is judged by.
          const trailing = parseAntigravityStreamLine(stdoutBuffer);
          stdoutBuffer = "";
          if (trailing) enqueue(handleStreamEvent(trailing));
          enqueue(
            Effect.gen(function* () {
              const updatedAt = yield* nowIso;
              const { activeTurnId: _activeTurnId, ...readySession } = ctx.session;
              ctx.session = { ...readySession, status: "ready", updatedAt };
              const failed = code !== 0 || turnFailure !== undefined;
              // A run that answers with nothing at all has a reason, and the CLI
              // only ever writes it to stderr — a supervised turn whose tools
              // were auto-declined otherwise reads as a blank success.
              if (!failed && !sawAssistantText && stderrTail.trim()) {
                yield* offerRuntimeEvent({
                  type: "runtime.warning",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  threadId: input.threadId,
                  turnId,
                  payload: { message: stderrTail.trim().slice(0, 500) },
                });
              }
              yield* offerRuntimeEvent({
                type: "turn.completed",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: input.threadId,
                turnId,
                payload: {
                  state: failed ? "failed" : "completed",
                  ...(failed
                    ? {
                        errorMessage:
                          [
                            turnFailure ?? `Antigravity CLI exited with code ${String(code)}.`,
                            stderrTail.trim(),
                          ]
                            .filter(Boolean)
                            .join(" ") || "Antigravity turn failed.",
                      }
                    : {}),
                },
              });
            }),
          );
        });

        return {
          threadId: input.threadId,
          turnId,
          // Only known once a turn has run: the id lands in the ledger from the
          // next turn on, which is what lets a restarted server resume instead
          // of opening a new conversation.
          ...(ctx.conversationId
            ? {
                resumeCursor: {
                  schemaVersion: ANTIGRAVITY_RESUME_VERSION,
                  conversationId: ctx.conversationId,
                },
              }
            : {}),
        };
      });

    const interruptTurn: AntigravityAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const child = ctx.activeProcess;
        if (!child) return;
        const interruptedTurnId = turnId ?? ctx.activeTurnId;
        yield* killChildTree(child);
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
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        if (ctx.activeProcess) {
          yield* killChildTree(ctx.activeProcess);
        }
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
      // Every turn is a fresh `agy` process that takes `--model` on its spawn
      // line and rejoins the thread through `--conversation`, so switching
      // model costs nothing and keeps the conversation.
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
            detail: "Antigravity print sessions do not support provider-side rollback yet.",
          }),
        ),
      stopAll: () =>
        Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true }),
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies AntigravityAdapterShape;
  });
}

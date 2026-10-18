import { AgentScope } from "@t3tools/shared/AgentScope";
import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  TurnId,
  type ThreadId,
  type MuseSettings,
  type ProviderSession,
  type ProviderRuntimeEvent,
  type ServerProviderModel,
  type TurnTokenUsage,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import * as McpProviderSession from "../../mcp/McpProviderSession.ts";
import { museToolPresentation, museItemStatus } from "../MuseItemPresentation.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  ProviderOperationUnsupportedError,
  type ProviderAdapterError,
} from "../Errors.ts";
import {
  MuseApproval,
  MuseUserInput,
  MuseItemEvent,
  MuseDelta,
  MuseTurnCompleted,
  MuseSessionResult,
  MuseTurnStartResult,
  MuseContextUsage,
  MuseTodoList,
  museApprovalChoices,
  museApprovalOptions,
  type MuseItem,
} from "../museProtocol.ts";
import {
  createMuseSdkHost,
  createMuseSdkHostEffect,
  museApprovalMode,
  musePermissionProfile,
  museWorkspaceRoot,
  makeMuseEnvironment,
  type MuseSdkHost,
} from "../museSdk.ts";
import { museModelCapabilities, resolveMuseReasoningEffort } from "../museModelCatalog.ts";
import { buildRuntimeInstructions } from "../RuntimeInstructions.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("muse");
type Adapter = ProviderAdapterShape<ProviderAdapterError>;
type Unstamped<T> = T extends unknown
  ? Omit<T, "eventId" | "createdAt" | "provider" | "providerInstanceId" | "threadId">
  : never;
type Notice = { readonly method: string; readonly params: unknown };
interface Session {
  session: ProviderSession;
  readonly nativeId: string;
  readonly host: MuseSdkHost;
  readonly scope: Scope.Closeable;
  readonly items: Map<string, MuseItem>;
  readonly approvals: Map<string, typeof MuseApproval.Type>;
  readonly questions: Map<string, typeof MuseUserInput.Type>;
  readonly tasks: Map<string, { readonly turnId: TurnId; readonly status: string }>;
  compact: boolean;
  stopped: boolean;
}

export interface MuseAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly createHost?: typeof createMuseSdkHost;
  readonly modelCatalog?: Effect.Effect<ReadonlyArray<ServerProviderModel>>;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

/** One MSP host per thread, using the same adapter and event stream as Ronin's other providers. */
export function makeMuseAdapter(settings: MuseSettings, options: MuseAdapterOptions = {}) {
  return Effect.gen(function* () {
    const agentScope = yield* AgentScope;
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;
    const sessions = new Map<ThreadId, Session>();
    const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const instanceId = options.instanceId ?? ProviderInstanceId.make("muse");
    const now = Effect.map(DateTime.now, DateTime.formatIso);
    const runDetached = Effect.runPromiseWith(yield* Effect.context<never>());
    const error = (method: string, detail: string, cause?: unknown) =>
      new ProviderAdapterRequestError({
        provider: PROVIDER,
        method,
        detail,
        ...(cause === undefined ? {} : { cause }),
      });
    const invalid = (operation: string, issue: string) =>
      new ProviderAdapterValidationError({ provider: PROVIDER, operation, issue });
    const decode = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError((cause) => error("decode", "Invalid Muse protocol response.", cause)),
      );
    const emit = (ctx: Session, event: Unstamped<ProviderRuntimeEvent>) =>
      Effect.gen(function* () {
        yield* PubSub.publish(events, {
          ...event,
          provider: PROVIDER,
          providerInstanceId: instanceId,
          threadId: ctx.session.threadId,
          eventId: EventId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
          createdAt: yield* now,
        } as ProviderRuntimeEvent);
      });
    const requireSession = (threadId: ThreadId) => {
      const ctx = sessions.get(threadId);
      return ctx && !ctx.stopped
        ? Effect.succeed(ctx)
        : Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    };
    const publishTasks = (ctx: Session, item: MuseItem) =>
      Effect.gen(function* () {
        const children =
          item.kind === "subagent"
            ? [
                {
                  id: item.subagentId ?? item.itemId,
                  title: item.objective ?? item.role ?? "Muse agent",
                  status: item.status,
                  result: item.failureReason ?? item.result?.summary,
                },
              ]
            : item.kind === "workflow"
              ? (item.children ?? []).map((child) => ({
                  id: `${item.itemId}:${child.childId}:${child.attempt}`,
                  title: child.label ?? "Workflow agent",
                  status:
                    child.terminal ?? (item.status !== "inProgress" ? item.status : "inProgress"),
                  result: child.failureReason,
                }))
              : [];
        for (const child of children) {
          const previous = ctx.tasks.get(child.id);
          const turnId = previous?.turnId ?? ctx.session.activeTurnId;
          if (!turnId) continue;
          const taskId = RuntimeTaskId.make(`${ctx.nativeId}:${child.id}`);
          const linkage = {
            taskId,
            taskType: "subagent",
            title: child.title || "Muse agent",
            ...(item.kind === "workflow" && item.entryId ? { workflowName: item.entryId } : {}),
          };
          if (!previous)
            yield* emit(ctx, {
              type: "task.started",
              turnId,
              payload: { ...linkage, description: child.title || "Muse agent" },
            });
          if (previous?.status !== child.status && child.status !== "inProgress")
            yield* emit(ctx, {
              type: "task.completed",
              turnId,
              payload: {
                ...linkage,
                status:
                  child.status === "completed"
                    ? "completed"
                    : child.status === "cancelled"
                      ? "stopped"
                      : "failed",
                ...(child.result ? { summary: child.result } : {}),
              },
            });
          ctx.tasks.set(child.id, { turnId, status: child.status });
        }
      });
    const settleTasks = (ctx: Session, status: "failed" | "stopped") =>
      Effect.gen(function* () {
        for (const [id, task] of ctx.tasks) {
          if (task.status !== "inProgress") continue;
          yield* emit(ctx, {
            type: "task.completed",
            turnId: task.turnId,
            payload: {
              taskId: RuntimeTaskId.make(`${ctx.nativeId}:${id}`),
              taskType: "subagent",
              status,
            },
          });
        }
        ctx.tasks.clear();
      });
    const cancelChildApprovals = (ctx: Session) =>
      Effect.gen(function* () {
        for (const [id] of ctx.approvals) {
          ctx.approvals.delete(id);
          yield* emit(ctx, {
            type: "request.resolved",
            requestId: RuntimeRequestId.make(id),
            payload: { requestType: "command_execution_approval" },
          });
        }
      });
    const finish = (
      ctx: Session,
      state: "completed" | "failed" | "cancelled",
      message?: string,
      tokenUsage?: TurnTokenUsage,
    ) =>
      Effect.gen(function* () {
        const turnId = ctx.session.activeTurnId;
        if (!turnId) return;
        ctx.compact = false;
        const { activeTurnId: _active, ...session } = ctx.session;
        ctx.session = { ...session, status: "ready", updatedAt: yield* now };
        // Workflow children own their requests independently of the parent turn.
        for (const [id, approval] of ctx.approvals)
          if (!approval.subagentOrigin) ctx.approvals.delete(id);
        ctx.questions.clear();
        yield* emit(ctx, {
          type: "turn.completed",
          turnId,
          payload: {
            state,
            ...(message ? { errorMessage: message } : {}),
            ...(tokenUsage ? { tokenUsage } : {}),
          },
        });
        yield* emit(ctx, { type: "session.state.changed", payload: { state: "ready" } });
      });
    const failHost = (ctx: Session, cause: unknown) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        yield* settleTasks(ctx, "failed");
        yield* finish(
          ctx,
          "failed",
          cause instanceof Error ? cause.message : "Muse connection failed.",
        );
        yield* cancelChildApprovals(ctx);
        ctx.stopped = true;
        ctx.session = { ...ctx.session, status: "error", updatedAt: yield* now };
        yield* Effect.promise(() => ctx.host.close()).pipe(Effect.ignore);
        yield* emit(ctx, {
          type: "session.exited",
          payload: { reason: "Muse connection failed.", recoverable: true, exitKind: "error" },
        });
      });
    const request = (
      ctx: Session,
      method: string,
      params: Record<string, unknown>,
      commandId?: string,
      read = false,
    ) =>
      Effect.tryPromise({
        try: () =>
          read
            ? ctx.host.connection.request(method, { sessionId: ctx.nativeId, ...params })
            : ctx.host.connection.command(
                method,
                { sessionId: ctx.nativeId, ...params },
                {
                  ...(method === "turn/start" ? {} : { maxAttempts: 1 }),
                  ...(commandId ? { commandId } : {}),
                },
              ),
        catch: (cause) => error(method, `Muse ${method} failed.`, cause),
      }).pipe(
        Effect.timeout(30_000),
        Effect.catchTags({
          TimeoutError: (cause) =>
            failHost(ctx, cause).pipe(
              Effect.andThen(
                Effect.fail(error(method, `Muse ${method} timed out; its host was closed.`, cause)),
              ),
            ),
        }),
      );
    const itemType = (item: MuseItem) =>
      item.kind === "agentMessage"
        ? ("assistant_message" as const)
        : item.kind === "userMessage"
          ? ("user_message" as const)
          : item.kind === "reasoning"
            ? ("reasoning" as const)
            : item.kind === "compaction"
              ? ("context_compaction" as const)
              : item.kind === "commandExecution" ||
                  item.kind === "userShell" ||
                  /shell|bash|exec_command/i.test(item.tool ?? "")
                ? ("command_execution" as const)
                : item.kind === "toolCall" && /write|edit|patch/i.test(item.tool ?? "")
                  ? ("file_change" as const)
                  : item.kind === "toolCall" && /web|browse|fetch/i.test(item.tool ?? "")
                    ? ("web_search" as const)
                    : ("dynamic_tool_call" as const);
    const publishItem = (ctx: Session, item: MuseItem, previous?: MuseItem) =>
      Effect.gen(function* () {
        if (item.kind === "userMessage" || item.kind === "reminderChild") return;
        if (
          item.kind === "toolCall" &&
          ["request_user_input", "workflow"].includes(item.tool ?? "") &&
          item.status !== "failed"
        )
          return;
        const turnId = ctx.session.activeTurnId;
        if (!turnId) return;
        const itemId = RuntimeItemId.make(item.itemId);
        const type = itemType(item);
        const content =
          type === "assistant_message"
            ? item.text
            : type === "reasoning"
              ? (item.summary?.join("\n") ?? item.text)
              : undefined;
        const prior =
          (type === "reasoning"
            ? (previous?.summary?.join("\n") ?? previous?.text)
            : previous?.text) ?? "";
        if (!previous)
          yield* emit(ctx, {
            type: "item.started",
            turnId,
            itemId,
            payload: {
              itemType: type,
              status: "inProgress",
              ...(item.tool ? { title: item.tool } : {}),
            },
          });
        if (content && content.startsWith(prior) && content.length > prior.length)
          yield* emit(ctx, {
            type: "content.delta",
            turnId,
            itemId,
            payload: {
              streamKind: type === "reasoning" ? "reasoning_text" : "assistant_text",
              delta: content.slice(prior.length),
            },
          });
        if (item.status !== "inProgress")
          yield* emit(ctx, {
            type: "item.completed",
            turnId,
            itemId,
            payload: {
              itemType: type,
              status:
                museItemStatus(item) === "completed"
                  ? "completed"
                  : item.status === "cancelled"
                    ? "declined"
                    : "failed",
              ...(item.tool ? { title: item.tool } : {}),
              data: (() => {
                const tool = museToolPresentation(item);
                return {
                  ...item,
                  ...(tool.type === "command_execution"
                    ? { command: tool.input, rawOutput: tool.output }
                    : {}),
                  ...(tool.type === "file_change" ? { files: [{ path: tool.fileName }] } : {}),
                  ...(tool.type === "dynamic_tool"
                    ? { toolName: tool.toolName, input: tool.input, rawOutput: tool.output }
                    : {}),
                };
              })(),
              ...(item.visibleOutput || item.failureReason
                ? { detail: item.failureReason ?? item.visibleOutput }
                : {}),
            },
          });
        if (ctx.compact && item.kind === "compaction" && item.status !== "inProgress") {
          const succeeded =
            item.status === "completed" && (!item.outcome || item.outcome === "compacted");
          if (succeeded)
            yield* emit(ctx, { type: "thread.state.changed", payload: { state: "compacted" } });
          yield* finish(ctx, succeeded ? "completed" : "failed", item.failureReason);
        }
      });
    const handle = (ctx: Session, notice: Notice) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        const params = notice.params;
        if (
          typeof params !== "object" ||
          params === null ||
          !("sessionId" in params) ||
          params.sessionId !== ctx.nativeId
        )
          return;
        if (options.nativeEventLogger)
          yield* options.nativeEventLogger
            .write(
              {
                observedAt: yield* now,
                event: {
                  id: yield* crypto.randomUUIDv4.pipe(Effect.orDie),
                  kind: "notification",
                  provider: PROVIDER,
                  createdAt: yield* now,
                  method: notice.method,
                  threadId: ctx.session.threadId,
                  payload: params,
                },
              },
              ctx.session.threadId,
            )
            .pipe(Effect.ignore);
        switch (notice.method) {
          case "turn/started": {
            if (
              ctx.session.activeTurnId ||
              !("turnId" in params) ||
              typeof params.turnId !== "string"
            )
              return;
            const turnId = TurnId.make(params.turnId);
            ctx.session = {
              ...ctx.session,
              activeTurnId: turnId,
              status: "running",
              updatedAt: yield* now,
            };
            yield* emit(ctx, { type: "turn.started", turnId, payload: {} });
            break;
          }
          case "item/started":
          case "item/updated":
          case "item/completed": {
            const { item } = yield* decode(MuseItemEvent, params);
            const previous = ctx.items.get(item.itemId);
            if (previous && previous.revision >= item.revision) return;
            ctx.items.set(item.itemId, item);
            yield* publishTasks(ctx, item);
            yield* publishItem(ctx, item, previous);
            break;
          }
          case "item/delta": {
            const delta = yield* decode(MuseDelta, params);
            const previous = ctx.items.get(delta.itemId);
            if (!previous || previous.status !== "inProgress") return;
            const field = delta.field ?? "text";
            let item = previous;
            if (field === "text") item = { ...previous, text: (previous.text ?? "") + delta.delta };
            else if (field === "output" || field === "visibleOutput")
              item = { ...previous, visibleOutput: (previous.visibleOutput ?? "") + delta.delta };
            else if (/^summary\.\d+$/.test(field)) {
              const index = Number(field.slice(8));
              if (index < 100) {
                const summary = [...(previous.summary ?? [])];
                summary[index] = (summary[index] ?? "") + delta.delta;
                item = { ...previous, summary };
              }
            }
            ctx.items.set(item.itemId, item);
            yield* publishItem(ctx, item, previous);
            break;
          }
          case "turn/completed": {
            const result = yield* decode(MuseTurnCompleted, params);
            if (result.turnId !== ctx.session.activeTurnId || ctx.compact) return;
            yield* finish(
              ctx,
              result.terminal === "completed"
                ? "completed"
                : result.terminal === "cancelled" || result.terminal === "interrupted"
                  ? "cancelled"
                  : "failed",
              result.error?.message ?? result.reason,
              result.usage
                ? {
                    usageScope: "main_agent",
                    usageStatus: "complete",
                    hasSubagents: ctx.tasks.size > 0,
                    inputTokens: result.usage.inputTokens,
                    outputTokens: result.usage.outputTokens,
                    cachedInputTokens: result.usage.cacheReadTokens ?? result.usage.cachedTokens,
                    reasoningTokens: result.usage.reasoningTokens,
                    ...(result.usage.cacheWriteTokens === undefined
                      ? {}
                      : { cacheCreationTokens: result.usage.cacheWriteTokens }),
                  }
                : undefined,
            );
            break;
          }
          case "approval/requested":
          case "approval/updated": {
            const approval = yield* decode(MuseApproval, params);
            if (notice.method === "approval/updated" && !ctx.approvals.has(approval.approvalId))
              return;
            ctx.approvals.set(approval.approvalId, approval);
            yield* emit(ctx, {
              type: "request.opened",
              requestId: RuntimeRequestId.make(approval.approvalId),
              ...(!approval.subagentOrigin && ctx.session.activeTurnId
                ? { turnId: ctx.session.activeTurnId }
                : {}),
              payload: {
                requestType: "command_execution_approval",
                options: museApprovalOptions(approval),
                args: approval,
                detail:
                  approval.subject.command ??
                  approval.subject.path ??
                  approval.toolName ??
                  "Muse approval",
              },
            });
            if (approval.subagentOrigin && ctx.session.runtimeMode === "full-access") {
              const choice = museApprovalChoices(approval).get("accept");
              if (choice)
                yield* request(ctx, "approval/decide", {
                  approvalId: approval.approvalId,
                  requirementId: approval.currentRequirementId,
                  choiceId: choice.choiceId,
                }).pipe(Effect.ignore, Effect.forkIn(ctx.scope));
            }
            break;
          }
          case "approval/resolved": {
            if (!("approvalId" in params) || typeof params.approvalId !== "string") return;
            ctx.approvals.delete(params.approvalId);
            yield* emit(ctx, {
              type: "request.resolved",
              requestId: RuntimeRequestId.make(params.approvalId),
              payload: { requestType: "command_execution_approval" },
            });
            break;
          }
          case "userInput/requested": {
            const input = yield* decode(MuseUserInput, params);
            ctx.questions.set(input.userInputId, input);
            yield* emit(ctx, {
              type: "user-input.requested",
              requestId: RuntimeRequestId.make(input.userInputId),
              turnId: ctx.session.activeTurnId ?? TurnId.make(input.turnId),
              payload: {
                questions: input.questions.map((q) => ({
                  id: q.id,
                  header: q.header,
                  question: q.question,
                  options: q.options.map((o) => ({
                    label: o.label,
                    description: o.description ?? "",
                  })),
                  multiSelect: q.selection.mode === "multiple",
                  allowCustomAnswer: true,
                })),
              },
            });
            break;
          }
          case "session/contextUsage": {
            const usage = yield* decode(MuseContextUsage, params);
            yield* emit(ctx, {
              type: "thread.token-usage.updated",
              payload: {
                usage: {
                  usedTokens: usage.usedTokens,
                  ...(usage.windowTokens ? { maxTokens: usage.windowTokens } : {}),
                },
              },
            });
            break;
          }
          case "session/todoListChanged": {
            const todo = yield* decode(MuseTodoList, params);
            if (!ctx.session.activeTurnId) return;
            yield* emit(ctx, {
              type: "turn.plan.updated",
              turnId: ctx.session.activeTurnId,
              payload: {
                plan: todo.items
                  .filter((item) => item.text.trim() && item.status !== "cancelled")
                  .map((item) => ({
                    step: item.text.trim(),
                    status:
                      item.status === "completed"
                        ? "completed"
                        : item.status === "inProgress"
                          ? "inProgress"
                          : "pending",
                  })),
              },
            });
            break;
          }
          case "userInput/settled": {
            if (
              !("userInputId" in params) ||
              typeof params.userInputId !== "string" ||
              !ctx.questions.delete(params.userInputId)
            )
              return;
            yield* emit(ctx, {
              type: "user-input.resolved",
              requestId: RuntimeRequestId.make(params.userInputId),
              payload: { answers: {} },
            });
            break;
          }
        }
      });
    const stop = (ctx: Session) =>
      Effect.gen(function* () {
        if (ctx.stopped) {
          yield* Scope.close(ctx.scope, Exit.void);
          return;
        }
        yield* finish(ctx, "cancelled");
        yield* cancelChildApprovals(ctx);
        yield* settleTasks(ctx, "stopped");
        ctx.stopped = true;
        yield* Scope.close(ctx.scope, Exit.void);
        ctx.session = { ...ctx.session, status: "closed", updatedAt: yield* now };
      });
    const startSession: Adapter["startSession"] = (input) =>
      Effect.gen(function* () {
        if (sessions.has(input.threadId) && !sessions.get(input.threadId)?.stopped)
          return yield* invalid(
            "startSession",
            "A Muse session is already active for this thread.",
          );
        const previous = sessions.get(input.threadId);
        if (previous) yield* Scope.close(previous.scope, Exit.void);
        const scope = yield* Scope.make();
        return yield* Effect.gen(function* () {
          const mcp = McpProviderSession.readMcpProviderSession(input.threadId);
          const environment = McpProviderSession.withAgentDeviceEnvironment(
            options.environment ?? makeMuseEnvironment(),
            mcp,
          );
          const launch = yield* agentScope.wrap({
            command: settings.binaryPath,
            args: [],
            name: "muse",
            threadId: input.threadId,
            env: environment,
          });
          const host = yield* Effect.acquireRelease(
            createMuseSdkHostEffect(
              {
                binaryPath: launch.command,
                launchArgs: launch.args,
                cwd: input.cwd ?? config.cwd,
                environment,
                runtimeMode: input.runtimeMode,
              },
              options.createHost,
            ),
            (host) => Effect.promise(() => host.close()),
          ).pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.mapError((cause) => error("startSession", "Failed to start Muse Code.", cause)),
          );
          const resume = input.resumeCursor;
          const nativeId =
            typeof resume === "object" &&
            resume !== null &&
            "sessionId" in resume &&
            typeof resume.sessionId === "string"
              ? resume.sessionId
              : undefined;
          const createdAt = yield* now;
          const ctx: Session = {
            session: {
              provider: PROVIDER,
              providerInstanceId: instanceId,
              threadId: input.threadId,
              status: "ready",
              runtimeMode: input.runtimeMode,
              cwd: input.cwd ?? config.cwd,
              ...(input.modelSelection ? { model: input.modelSelection.model } : {}),
              createdAt,
              updatedAt: createdAt,
            },
            nativeId: nativeId ?? host.connection.mintCommandId(),
            host,
            scope,
            items: new Map(),
            approvals: new Map(),
            questions: new Map(),
            tasks: new Map(),
            compact: false,
            stopped: false,
          };
          const inbox = yield* Queue.unbounded<Notice>();
          host.connection.onNotification((notification) => {
            Queue.offerUnsafe(inbox, { method: notification.method, params: notification.params });
          });
          host.connection.onServerRequest(async (request) => {
            if (request.method === "approval/request" || request.method === "userInput/request")
              return {};
            throw new Error(`Unsupported Muse server request: ${request.method}`);
          });
          host.connection.onProtocolError((cause) => {
            void runDetached(failHost(ctx, cause));
          });
          void host.connection.closed.then(() =>
            runDetached(failHost(ctx, new Error("Muse connection closed unexpectedly."))),
          );
          void host.exited.then((exit) =>
            runDetached(
              failHost(ctx, new Error(`Muse exited unexpectedly (${exit.code ?? exit.signal}).`)),
            ),
          );
          yield* Stream.runForEach(Stream.fromQueue(inbox), (notice) =>
            handle(ctx, notice).pipe(Effect.catch((cause) => failHost(ctx, cause))),
          ).pipe(Effect.forkIn(scope));
          const model = input.modelSelection?.model;
          if (mcp && !host.initializeResult.grantedCapabilities.includes("sessionMcp"))
            return yield* error(
              "startSession",
              "Update Muse Code to a version supporting session MCP servers.",
            );
          const mcpConfig = mcp
            ? {
                config: {
                  mcpServers: {
                    [McpProviderSession.MCP_SERVER_NAME]: {
                      transport: "streamableHttp",
                      mode: "optional",
                      url: mcp.endpoint,
                      headers: { Authorization: mcp.authorizationHeader },
                    },
                  },
                },
              }
            : {};
          const result = yield* request(ctx, nativeId ? "session/resume" : "session/start", {
            ...mcpConfig,
            permissionProfile: musePermissionProfile(input.runtimeMode),
            ...(nativeId
              ? { excludeItems: true }
              : {
                  workspaceRoot: ctx.session.cwd,
                  approvalMode: museApprovalMode(input.runtimeMode),
                  providerId: "meta",
                  ...(model && model !== "default" ? { modelId: model } : {}),
                }),
          }).pipe(Effect.flatMap((value) => decode(MuseSessionResult, value)));
          if (result.session.sessionId !== ctx.nativeId)
            return yield* error("startSession", "Muse returned a different session identity.");
          if (nativeId)
            yield* request(ctx, "session/setApprovalMode", {
              mode: museApprovalMode(input.runtimeMode),
            });
          ctx.session = {
            ...ctx.session,
            resumeCursor: { sessionId: ctx.nativeId },
            ...(result.session.modelId ? { model: result.session.modelId } : {}),
          };
          sessions.set(input.threadId, ctx);
          yield* emit(ctx, {
            type: "session.started",
            payload: { resume: ctx.session.resumeCursor },
          });
          yield* emit(ctx, { type: "session.state.changed", payload: { state: "ready" } });
          return ctx.session;
        }).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
      });
    const sendTurn: Adapter["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        if (input.interactionMode === "plan")
          return yield* invalid("turn/start", "Muse does not support dedicated Plan mode.");
        if (ctx.session.activeTurnId)
          return yield* invalid("turn/start", "Muse already has an active turn.");
        const catalog = options.modelCatalog ? yield* options.modelCatalog : [];
        const selectedModel = input.modelSelection?.model;
        const model =
          selectedModel === "default"
            ? catalog.find((model) => model.isDefault && !model.isCustom)?.slug
            : selectedModel;
        if (model && model !== ctx.session.model) {
          yield* request(ctx, "session/setModel", {
            model: { modelId: model, providerId: "meta" },
          });
          ctx.session = { ...ctx.session, model };
        }
        const workspaceRoot = yield* museWorkspaceRoot(ctx.session.cwd ?? config.cwd);
        const effort = resolveMuseReasoningEffort(
          catalog.find((m) => m.slug === ctx.session.model)?.capabilities ??
            museModelCapabilities(),
          getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort"),
        );
        const parts: Array<Record<string, unknown>> = [
          {
            type: "text",
            text: buildRuntimeInstructions({
              harness: "Muse Code",
              model: ctx.session.model,
              reasoningEffort: effort,
            }),
          },
        ];
        if (input.input) parts.push({ type: "text", text: input.input });
        for (const attachment of input.attachments ?? []) {
          if (attachment.type !== "image") continue;
          const path = resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment });
          if (!path) return yield* invalid("turn/start", "Invalid image attachment.");
          const bytes = yield* fs
            .readFile(path)
            .pipe(
              Effect.mapError((cause) =>
                error("turn/start", "Failed to read image attachment.", cause),
              ),
            );
          parts.push({
            type: "image",
            base64Data: Buffer.from(bytes).toString("base64"),
            mediaType: attachment.mimeType,
          });
        }
        const turnId = TurnId.make(ctx.host.connection.mintCommandId());
        ctx.session = {
          ...ctx.session,
          status: "running",
          activeTurnId: turnId,
          updatedAt: yield* now,
        };
        yield* emit(ctx, { type: "turn.started", turnId, payload: {} });
        yield* request(
          ctx,
          "turn/start",
          {
            input: parts,
            displayText: input.input ?? "Image attachment",
            workspaceRoots: [workspaceRoot],
            ifBusy: "queue",
            ...(effort ? { reasoningEffort: effort } : {}),
          },
          turnId,
        ).pipe(
          Effect.flatMap((value) => decode(MuseTurnStartResult, value)),
          Effect.flatMap((result) =>
            result.turnId === turnId
              ? Effect.void
              : Effect.fail(error("turn/start", "Muse admitted a different turn.")),
          ),
          Effect.tapError((cause) => finish(ctx, "failed", cause.detail)),
        );
        return { threadId: input.threadId, turnId, resumeCursor: ctx.session.resumeCursor };
      });
    const readThread: Adapter["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const result = yield* request(
          ctx,
          "session/read",
          { excludeItems: false },
          undefined,
          true,
        ).pipe(Effect.flatMap((value) => decode(MuseSessionResult, value)));
        if (result.session.sessionId !== ctx.nativeId)
          return yield* error("session/read", "Muse returned another session's history.");
        const turns = new Map<TurnId, unknown[]>();
        for (const item of result.history?.items ?? result.history?.snapshot?.state.items ?? []) {
          if (!item.turnId) continue;
          const id = TurnId.make(item.turnId);
          const items = turns.get(id) ?? [];
          items.push(item);
          turns.set(id, items);
        }
        return { threadId, turns: Array.from(turns, ([id, items]) => ({ id, items })) };
      });
    yield* Effect.addFinalizer(() =>
      Effect.forEach(sessions.values(), stop, { discard: true }).pipe(
        Effect.andThen(PubSub.shutdown(events)),
      ),
    );
    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
      compaction: {
        type: "native",
        start: (threadId) =>
          Effect.gen(function* () {
            const ctx = yield* requireSession(threadId);
            if (ctx.session.activeTurnId)
              return yield* invalid("session/compact", "Muse already has an active turn.");
            const turnId = TurnId.make(ctx.host.connection.mintCommandId());
            ctx.compact = true;
            ctx.session = {
              ...ctx.session,
              status: "running",
              activeTurnId: turnId,
              updatedAt: yield* now,
            };
            yield* emit(ctx, { type: "turn.started", turnId, payload: {} });
            const result = yield* request(ctx, "session/compact", {}, turnId).pipe(
              Effect.flatMap((value) =>
                decode(
                  Schema.Struct({ status: Schema.String, reason: Schema.optional(Schema.String) }),
                  value,
                ),
              ),
              Effect.tapError((cause) => finish(ctx, "failed", cause.detail)),
            );
            if (result.status !== "accepted")
              yield* finish(ctx, "failed", result.reason ?? "Muse has no context to compact.");
          }),
      },
      startSession,
      sendTurn,
      readThread,
      interruptTurn: (threadId, turnId) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          const active = ctx.session.activeTurnId;
          if (ctx.compact && active && (!turnId || turnId === active)) {
            yield* stop(ctx);
            return;
          }
          if (active && (!turnId || turnId === active))
            yield* request(ctx, "turn/interrupt", { turnId: active });
        }),
      respondToRequest: (threadId, requestId, decision) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          const approval = ctx.approvals.get(requestId);
          const choice = approval && museApprovalChoices(approval).get(decision);
          if (!approval || !choice)
            return yield* invalid(
              "approval/decide",
              "This Muse approval decision is not available.",
            );
          yield* request(ctx, "approval/decide", {
            approvalId: approval.approvalId,
            requirementId: approval.currentRequirementId,
            choiceId: choice.choiceId,
          });
        }),
      respondToUserInput: (threadId, requestId, values) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          const input = ctx.questions.get(requestId);
          if (!input)
            return yield* invalid("userInput/answer", "This Muse question is no longer pending.");
          const answers = [];
          for (const question of input.questions) {
            const raw = values[question.id];
            const entries =
              typeof raw === "string" ? [raw] : Array.isArray(raw) ? [...new Set(raw)] : [];
            const selected = entries.filter((value) =>
              question.options.some((o) => o.label === value),
            );
            const freeText = entries.filter((value) => !selected.includes(value)).join("\n");
            if (
              (!selected.length && !freeText) ||
              freeText.length > 500 ||
              (question.selection.mode === "single" && selected.length > 1) ||
              (selected.length &&
                (selected.length < (question.selection.minSelections ?? 0) ||
                  selected.length > (question.selection.maxSelections ?? Infinity)))
            )
              return yield* invalid("userInput/answer", "Muse question selection is invalid.");
            answers.push({
              questionId: question.id,
              ...(selected.length
                ? question.selection.mode === "single"
                  ? { selectedLabel: selected[0] }
                  : { selectedLabels: selected }
                : {}),
              ...(freeText ? (selected.length ? { note: freeText } : { freeText }) : {}),
            });
          }
          yield* request(ctx, "userInput/answer", { userInputId: input.userInputId, answers });
          ctx.questions.delete(requestId);
          yield* emit(ctx, {
            type: "user-input.resolved",
            requestId: RuntimeRequestId.make(requestId),
            payload: { answers: values },
          });
        }),
      stopSession: (threadId) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          yield* stop(ctx);
          sessions.delete(threadId);
        }),
      listSessions: () =>
        Effect.sync(() =>
          Array.from(sessions.values())
            .filter((ctx) => !ctx.stopped)
            .map((ctx) => ctx.session),
        ),
      hasSession: (threadId) =>
        Effect.sync(() => sessions.has(threadId) && !sessions.get(threadId)?.stopped),
      stopAll: () => Effect.forEach(sessions.values(), stop, { discard: true }),
      rollbackThread: (_threadId: ThreadId, _numTurns: number) =>
        Effect.fail(
          new ProviderOperationUnsupportedError({
            provider: PROVIDER,
            operation: "rollbackThread",
          }),
        ),
      streamEvents: Stream.fromPubSub(events),
    } satisfies Adapter;
  });
}

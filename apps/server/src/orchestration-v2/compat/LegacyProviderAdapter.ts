import {
  ApprovalRequestId,
  MessageId,
  NodeId,
  PlanId,
  ProviderThreadId,
  ProviderTurnId,
  RuntimeRequestId,
  TurnItemId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import {
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2TurnItem,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2Subagent,
} from "@t3tools/contracts/orchestration-v2";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { ProviderInstance } from "../../provider/ProviderDriver.ts";
import type { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  ProviderAdapterOpenSessionError,
  ProviderAdapterEnsureThreadError,
  ProviderAdapterTurnStartError,
  ProviderAdapterInterruptError,
  ProviderAdapterSteerRunError,
  ProviderAdapterRuntimeRequestResponseError,
  ProviderAdapterRollbackThreadError,
  ProviderAdapterForkThreadError,
  ProviderAdapterEventStreamError,
  ProviderAdapterV2Event,
  type ProviderAdapterV2Shape,
  type ProviderAdapterV2TurnInput,
} from "../ProviderAdapter.ts";
import { legacyProviderCapabilities } from "./LegacyProviderCapabilities.ts";
import type { PreparedTurnRequests } from "./PreparedTurnRequests.ts";
import { makeProviderFailure } from "../ProviderFailure.ts";

const decodeEvent = Schema.decodeUnknownEffect(ProviderAdapterV2Event);

function nativeThreadId(cursor: unknown) {
  if (typeof cursor === "string") return cursor;
  if (!Predicate.isObject(cursor)) return null;
  for (const key of ["threadId", "sessionId", "sessionFile"]) {
    const value = cursor[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

function requestKind(
  kind: Extract<ProviderRuntimeEvent, { type: "request.opened" }>["payload"]["requestType"],
): OrchestrationV2RuntimeRequest["kind"] {
  switch (kind) {
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    case "mcp_elicitation_approval":
      return "mcp-elicitation";
    case "tool_user_input":
      return "user_input";
    case "dynamic_tool_call":
      return "dynamic_tool_call";
    case "auth_tokens_refresh":
      return "auth_refresh";
    default:
      return "command";
  }
}

/** Runs V2 through Ronin's provider facade, retaining instance routing, resume ledgers and native integrations. */
export function makeLegacyProviderAdapterV2(
  instance: Pick<ProviderInstance, "instanceId" | "driverKind"> & {
    readonly adapter: Pick<ProviderInstance["adapter"], "capabilities">;
  },
  providers: ProviderService["Service"],
  prepared?: PreparedTurnRequests["Service"],
): ProviderAdapterV2Shape {
  const driver = instance.driverKind;
  const capabilities = legacyProviderCapabilities(driver, instance.adapter.capabilities);
  return {
    instanceId: instance.instanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
    planSelectionTransition: ({ current, target }) =>
      Effect.succeed(
        current.instanceId !== target.instanceId
          ? { type: "create_with_handoff" }
          : instance.adapter.capabilities.sessionModelSwitch === "in-session" &&
              instance.adapter.capabilities.sessionModelOptionsSwitch !== "unsupported"
            ? { type: "apply_on_next_turn" }
            : { type: "restart_session" },
      ),
    openSession: Effect.fn("LegacyProviderAdapter.openSession")(function* (input) {
      const continuation = yield* providers
        .getContinuationState({ threadId: input.threadId, instanceId: instance.instanceId })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterOpenSessionError({
                driver,
                providerSessionId: input.providerSessionId,
                cause,
              }),
          ),
        );
      const resumeCursor = Option.isSome(continuation)
        ? continuation.value.resumeCursor
        : undefined;
      const existing = (yield* providers.listSessions()).find(
        (session) =>
          session.threadId === input.threadId &&
          session.providerInstanceId === instance.instanceId &&
          session.status !== "closed" &&
          session.status !== "error" &&
          session.runtimeMode === input.runtimePolicy.runtimeMode &&
          (input.runtimePolicy.cwd === null || session.cwd === input.runtimePolicy.cwd),
      );
      const session =
        existing ??
        (yield* providers
          .startSession(input.threadId, {
            threadId: input.threadId,
            providerInstanceId: instance.instanceId,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimePolicy.runtimeMode,
            ...(input.runtimePolicy.cwd === null ? {} : { cwd: input.runtimePolicy.cwd }),
            ...(resumeCursor == null ? {} : { resumeCursor }),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterOpenSessionError({
                  driver,
                  providerSessionId: input.providerSessionId,
                  cause,
                }),
            ),
          ));
      const now = yield* DateTime.now;
      let providerThread: OrchestrationV2ProviderThread = {
        id: ProviderThreadId.make(`ronin:${instance.instanceId}:${input.threadId}`),
        driver,
        providerInstanceId: instance.instanceId,
        providerSessionId: input.providerSessionId,
        appThreadId: input.threadId,
        ownerNodeId: null,
        nativeThreadRef: {
          driver,
          nativeId: nativeThreadId(session.resumeCursor),
          strength: "weak",
        },
        nativeConversationHeadRef: null,
        status: "idle",
        firstRunOrdinal: null,
        lastRunOrdinal: null,
        handoffIds: [],
        forkedFrom: null,
        createdAt: now,
        updatedAt: now,
      };
      let active: ProviderAdapterV2TurnInput | undefined;
      const turns = new Map<string, OrchestrationV2ProviderTurn>();
      const messages = new Map<string, OrchestrationV2ConversationMessage>();
      const items = new Map<string, OrchestrationV2TurnItem>();
      const nodes = new Map<string, OrchestrationV2ExecutionNode>();
      const requests = new Map<string, OrchestrationV2RuntimeRequest>();
      const tasks = new Map<string, ProviderAdapterV2TurnInput>();
      const subagents = new Map<string, OrchestrationV2Subagent>();
      const turnOwners = new Map<string, ProviderAdapterV2TurnInput>();
      let lastNativeTurn: string | undefined;
      let rootTurnEnded = false;
      let ordinal = 0;
      const snapshot = () => ({
        providerThread,
        providerTurns: [...turns.values()],
        messages: [...messages.values()],
        runtimeRequests: [...requests.values()],
      });
      const hasPendingBackgroundWork = Effect.sync(() =>
        [...tasks.keys()].some((taskId) => {
          const status = nodes.get(`${instance.instanceId}:task:${taskId}`)?.status;
          return status === "pending" || status === "running" || status === "waiting";
        }),
      );
      const convert = Effect.fn("LegacyProviderAdapter.convert")(function* (
        event: ProviderRuntimeEvent,
      ) {
        if (active === undefined && event.type !== "session.exited") return [];
        const stoppedSession: ProviderAdapterV2Event = {
          type: "provider_session.updated",
          driver,
          providerSession: {
            id: input.providerSessionId,
            driver,
            providerInstanceId: instance.instanceId,
            status: "stopped",
            cwd: session.cwd ?? input.runtimePolicy.cwd ?? ".",
            model: session.model ?? input.modelSelection.model,
            capabilities,
            createdAt: now,
            updatedAt: DateTime.makeUnsafe(event.createdAt),
            lastError: null,
          },
        };
        if (active === undefined) return [stoppedSession];
        const isTaskEvent =
          event.type === "task.started" ||
          event.type === "task.progress" ||
          event.type === "task.updated" ||
          event.type === "task.completed";
        // Ronin's native adapters can wake themselves after a root turn ends.
        // Those turns still flow through V1 ingestion and checkpointing; only
        // background-task lifecycle events belong to the completed V2 run.
        if (
          rootTurnEnded &&
          !isTaskEvent &&
          event.type !== "session.exited" &&
          event.type !== "runtime.error"
        )
          return [];
        const owner =
          event.turnId === undefined ? active : (turnOwners.get(event.turnId) ?? active);
        if (event.type === "turn.started" && event.turnId !== undefined) {
          turnOwners.set(event.turnId, owner);
          lastNativeTurn = event.turnId;
        }
        const occurredAt = DateTime.makeUnsafe(event.createdAt);
        const nativeTurn =
          (rootTurnEnded && isTaskEvent ? lastNativeTurn : event.turnId) ??
          lastNativeTurn ??
          owner.attemptId;
        const providerTurnId = ProviderTurnId.make(`${instance.instanceId}:${nativeTurn}`);
        const nativeRef =
          event.turnId === undefined && lastNativeTurn === undefined
            ? null
            : { driver, nativeId: String(nativeTurn), strength: "strong" as const };
        const previousTurn = turns.get(providerTurnId);
        const turn: OrchestrationV2ProviderTurn = {
          id: providerTurnId,
          providerThreadId: providerThread.id,
          nodeId: owner.rootNodeId,
          runAttemptId: owner.attemptId,
          nativeTurnRef: nativeRef,
          ordinal: owner.providerTurnOrdinal,
          status: "running",
          startedAt: previousTurn?.startedAt ?? occurredAt,
          completedAt: null,
        };
        const output: Array<ProviderAdapterV2Event> = [];
        const cancelBackgroundTasks = (status: "failed" | "cancelled") => {
          for (const taskId of tasks.keys()) {
            const key = `${instance.instanceId}:task:${taskId}`;
            const node = nodes.get(key);
            const item = items.get(key);
            const subagent = subagents.get(key);
            if (node) {
              const updated = { ...node, status, completedAt: occurredAt };
              nodes.set(key, updated);
              output.push({ type: "node.updated", driver, node: updated });
            }
            if (item?.type === "subagent") {
              const updated = { ...item, status, completedAt: occurredAt, updatedAt: occurredAt };
              items.set(key, updated);
              output.push({ type: "turn_item.updated", driver, turnItem: updated });
            }
            if (subagent) {
              const updated = {
                ...subagent,
                status,
                completedAt: occurredAt,
                updatedAt: occurredAt,
              };
              subagents.set(key, updated);
              output.push({ type: "subagent.updated", driver, subagent: updated });
            }
          }
          tasks.clear();
        };
        if (event.type === "thread.started" && event.payload.providerThreadId !== undefined) {
          providerThread = {
            ...providerThread,
            nativeThreadRef: { driver, nativeId: event.payload.providerThreadId, strength: "weak" },
            updatedAt: occurredAt,
          };
          output.push({ type: "provider_thread.updated", driver, providerThread });
        }
        const baseItem = (key: string, nodeId = owner.rootNodeId) => {
          const previous = items.get(key);
          return {
            id: TurnItemId.make(key),
            threadId: input.threadId,
            runId: owner.runId,
            nodeId,
            providerThreadId: providerThread.id,
            providerTurnId,
            nativeItemRef:
              event.itemId === undefined
                ? null
                : { driver, nativeId: event.itemId, strength: "strong" as const },
            parentItemId: null,
            ordinal: previous?.ordinal ?? ++ordinal,
            status: "running" as const,
            title: null,
            startedAt: previous?.startedAt ?? occurredAt,
            completedAt: null,
            updatedAt: occurredAt,
          };
        };
        if (event.type === "thread.token-usage.updated") {
          const updated = {
            ...(previousTurn ?? turn),
            tokenUsage: { ...event.payload.usage, updatedAt: event.createdAt },
          };
          turns.set(providerTurnId, updated);
          output.push({ type: "provider_turn.updated", driver, providerTurn: updated });
        }
        if (
          event.type === "turn.started" ||
          event.type === "turn.completed" ||
          event.type === "turn.aborted" ||
          ((event.type === "runtime.error" || event.type === "session.exited") &&
            (previousTurn === undefined || previousTurn.status === "running"))
        ) {
          const terminal = event.type !== "turn.started";
          const state: OrchestrationV2ProviderTurn["status"] =
            event.type === "turn.completed"
              ? event.payload.state
              : event.type === "turn.aborted"
                ? "interrupted"
                : event.type === "runtime.error"
                  ? "failed"
                  : event.type === "session.exited"
                    ? "cancelled"
                    : "running";
          const updated = {
            ...turn,
            status: state,
            completedAt: terminal ? occurredAt : null,
            ...(event.type === "turn.completed" && event.payload.tokenUsage !== undefined
              ? { turnTokenUsage: event.payload.tokenUsage }
              : {}),
          };
          turns.set(providerTurnId, updated);
          output.push({ type: "provider_turn.updated", driver, providerTurn: updated });
          if (terminal) {
            rootTurnEnded = true;
            if (state === "failed" || state === "cancelled" || state === "interrupted")
              cancelBackgroundTasks(state === "failed" ? "failed" : "cancelled");
            for (const [key, node] of nodes) {
              if (
                node.runId !== owner.runId ||
                !node.countsForRun ||
                (node.status !== "running" &&
                  node.status !== "pending" &&
                  node.status !== "waiting")
              )
                continue;
              const completed = {
                ...node,
                status:
                  state === "failed"
                    ? ("failed" as const)
                    : state === "interrupted" || state === "cancelled"
                      ? ("cancelled" as const)
                      : ("completed" as const),
                completedAt: occurredAt,
              };
              nodes.set(key, completed);
              output.push({ type: "node.updated", driver, node: completed });
            }
            for (const [key, request] of requests) {
              if (request.providerTurnId !== providerTurnId || request.status !== "pending")
                continue;
              const cancelled = {
                ...request,
                status: "cancelled" as const,
                resolvedAt: occurredAt,
              };
              requests.set(key, cancelled);
              output.push({
                type: "runtime_request.updated",
                driver,
                threadId: input.threadId,
                runtimeRequest: cancelled,
              });
            }
            for (const [key, item] of items) {
              if (
                item.runId !== owner.runId ||
                (item.type !== "assistant_message" && item.type !== "reasoning")
              )
                continue;
              const completed = {
                ...item,
                streaming: false,
                status: "completed" as const,
                completedAt: occurredAt,
                updatedAt: occurredAt,
              };
              items.set(key, completed);
              output.push({ type: "turn_item.updated", driver, turnItem: completed });
              if (item.type === "assistant_message") {
                const message = messages.get(item.messageId);
                if (message) {
                  const completedMessage = { ...message, streaming: false, updatedAt: occurredAt };
                  messages.set(item.messageId, completedMessage);
                  output.push({ type: "message.updated", driver, message: completedMessage });
                }
              }
            }
            if (state === "failed")
              output.push({
                type: "turn.terminal",
                driver,
                providerThreadId: providerThread.id,
                providerTurnId,
                runOrdinal: owner.runOrdinal,
                failureItemOrdinal: ++ordinal,
                status: "failed",
                failure: makeProviderFailure({
                  class:
                    event.type === "runtime.error"
                      ? (event.payload.class ?? "provider_error")
                      : "provider_error",
                  message:
                    event.type === "turn.completed"
                      ? (event.payload.errorMessage ?? "Provider turn failed.")
                      : event.type === "runtime.error"
                        ? event.payload.message
                        : "Provider turn failed.",
                }),
                threadDisposition: event.type === "runtime.error" ? "broken" : "reusable",
              });
            else
              output.push({
                type: "turn.terminal",
                driver,
                providerThreadId: providerThread.id,
                providerTurnId,
                runOrdinal: owner.runOrdinal,
                status: state === "running" ? "completed" : state,
                failure: null,
                threadDisposition: "reusable",
              });
          }
        }
        if (
          event.type === "content.delta" &&
          (event.payload.streamKind === "assistant_text" ||
            event.payload.streamKind === "reasoning_text" ||
            event.payload.streamKind === "reasoning_summary_text")
        ) {
          const reasoning = event.payload.streamKind !== "assistant_text";
          const key = `${owner.runId}:${event.itemId ?? (reasoning ? "reasoning" : "assistant")}`;
          const previous = items.get(key);
          const text =
            (previous !== undefined && "text" in previous ? previous.text : "") +
            event.payload.delta;
          const base = {
            id: TurnItemId.make(key),
            threadId: input.threadId,
            runId: owner.runId,
            nodeId: owner.rootNodeId,
            providerThreadId: providerThread.id,
            providerTurnId,
            nativeItemRef:
              event.itemId === undefined
                ? null
                : { driver, nativeId: event.itemId, strength: "strong" as const },
            parentItemId: null,
            ordinal: previous?.ordinal ?? ++ordinal,
            status: "running" as const,
            title: null,
            startedAt: previous?.startedAt ?? occurredAt,
            completedAt: null,
            updatedAt: occurredAt,
          };
          const messageId = MessageId.make(key);
          const item: OrchestrationV2TurnItem = reasoning
            ? { ...base, type: "reasoning", text, streaming: true }
            : { ...base, type: "assistant_message", messageId, text, streaming: true };
          items.set(key, item);
          output.push({ type: "turn_item.updated", driver, turnItem: item });
          if (!reasoning) {
            const message: OrchestrationV2ConversationMessage = {
              id: messageId,
              threadId: input.threadId,
              runId: owner.runId,
              nodeId: owner.rootNodeId,
              role: "assistant",
              text,
              attachments: [],
              streaming: true,
              createdBy: "agent",
              creationSource: "provider",
              createdAt: messages.get(messageId)?.createdAt ?? occurredAt,
              updatedAt: occurredAt,
            };
            messages.set(messageId, message);
            output.push({ type: "message.updated", driver, message });
          }
        }
        if (
          (event.type === "request.opened" ||
            event.type === "request.resolved" ||
            event.type === "user-input.requested" ||
            event.type === "user-input.resolved") &&
          event.requestId !== undefined
        ) {
          const resolved =
            event.type === "request.resolved" || event.type === "user-input.resolved";
          const requestId = RuntimeRequestId.make(event.requestId);
          const previous = requests.get(requestId);
          const request: OrchestrationV2RuntimeRequest = {
            id: requestId,
            nodeId: previous?.nodeId ?? NodeId.make(`request:${input.threadId}:${requestId}`),
            providerTurnId,
            nativeRequestRef: {
              driver,
              nativeId: event.providerRefs?.providerRequestId ?? requestId,
              strength: "strong",
            },
            kind:
              event.type === "request.opened" || event.type === "request.resolved"
                ? requestKind(event.payload.requestType)
                : "user_input",
            status: resolved ? "resolved" : "pending",
            responseCapability:
              event.type === "user-input.requested" && event.payload.responseMode === "message"
                ? { type: "message" }
                : (previous?.responseCapability ?? {
                    type: "live",
                    providerSessionId: input.providerSessionId,
                  }),
            createdAt: previous?.createdAt ?? occurredAt,
            resolvedAt: resolved ? occurredAt : null,
            ...(event.type === "user-input.resolved" ? { answers: event.payload.answers } : {}),
          };
          requests.set(requestId, request);
          const node: OrchestrationV2ExecutionNode = {
            id: request.nodeId,
            threadId: input.threadId,
            runId: owner.runId,
            parentNodeId: owner.rootNodeId,
            rootNodeId: owner.rootNodeId,
            kind: request.kind === "user_input" ? "user_input_request" : "approval_request",
            status: resolved ? "completed" : "waiting",
            countsForRun: true,
            providerThreadId: providerThread.id,
            providerTurnId,
            nativeItemRef: request.nativeRequestRef,
            runtimeRequestId: requestId,
            checkpointScopeId: null,
            startedAt: request.createdAt,
            completedAt: resolved ? occurredAt : null,
          };
          nodes.set(request.nodeId, node);
          output.push({ type: "node.updated", driver, node });
          output.push({
            type: "runtime_request.updated",
            driver,
            threadId: input.threadId,
            runtimeRequest: request,
          });
          const key = `request:${input.threadId}:${requestId}`;
          const previousItem = items.get(key);
          const base = {
            id: TurnItemId.make(key),
            threadId: input.threadId,
            runId: owner.runId,
            nodeId: node.id,
            providerThreadId: providerThread.id,
            providerTurnId,
            nativeItemRef: request.nativeRequestRef,
            parentItemId: null,
            ordinal: previousItem?.ordinal ?? ++ordinal,
            status: node.status,
            title: null,
            startedAt: request.createdAt,
            completedAt: node.completedAt,
            updatedAt: occurredAt,
          };
          const item =
            event.type === "user-input.requested"
              ? yield* decodeEvent({
                  type: "turn_item.updated",
                  driver,
                  turnItem: {
                    ...base,
                    type: "user_input_request",
                    requestId,
                    questions: event.payload.questions.map((question) => ({
                      ...question,
                      options: question.options.map((option) => ({
                        ...option,
                        description: option.description.trim() || option.label,
                      })),
                    })),
                    ...(event.payload.responseMode === undefined
                      ? {}
                      : { responseMode: event.payload.responseMode }),
                  },
                })
              : event.type === "request.opened" &&
                  (request.kind === "command" ||
                    request.kind === "file-read" ||
                    request.kind === "file-change" ||
                    request.kind === "mcp-elicitation")
                ? yield* decodeEvent({
                    type: "turn_item.updated",
                    driver,
                    turnItem: {
                      ...base,
                      type: "approval_request",
                      requestId,
                      requestKind: request.kind,
                      prompt: event.payload.detail,
                      appName: event.payload.appName,
                      options: event.payload.options,
                    },
                  })
                : previousItem === undefined
                  ? null
                  : {
                      type: "turn_item.updated" as const,
                      driver,
                      turnItem: {
                        ...previousItem,
                        status: "completed" as const,
                        completedAt: occurredAt,
                        updatedAt: occurredAt,
                      },
                    };
          if (item?.type === "turn_item.updated") {
            items.set(key, item.turnItem);
            output.push(item);
          }
        }
        if (
          event.type === "item.started" ||
          event.type === "item.updated" ||
          event.type === "item.completed"
        ) {
          const key = `${owner.runId}:tool:${event.itemId ?? event.eventId}`;
          const previous = items.get(key);
          if (
            event.payload.itemType === "assistant_message" ||
            event.payload.itemType === "reasoning"
          )
            return output;
          const nodeId = NodeId.make(key);
          const completed =
            event.type === "item.completed" ||
            event.payload.status === "completed" ||
            event.payload.status === "failed" ||
            event.payload.status === "declined";
          const status =
            event.payload.status === "failed"
              ? ("failed" as const)
              : event.payload.status === "declined"
                ? ("cancelled" as const)
                : completed
                  ? ("completed" as const)
                  : ("running" as const);
          const node: OrchestrationV2ExecutionNode = {
            id: nodeId,
            threadId: input.threadId,
            runId: owner.runId,
            parentNodeId: owner.rootNodeId,
            rootNodeId: owner.rootNodeId,
            kind: "tool_call",
            status,
            countsForRun: true,
            providerThreadId: providerThread.id,
            providerTurnId,
            nativeItemRef:
              event.itemId === undefined
                ? null
                : { driver, nativeId: event.itemId, strength: "strong" },
            runtimeRequestId: null,
            checkpointScopeId: null,
            startedAt: previous?.startedAt ?? occurredAt,
            completedAt: completed ? occurredAt : null,
          };
          const base = {
            ...baseItem(key, nodeId),
            status,
            completedAt: node.completedAt,
            title: event.payload.title ?? null,
            ...(event.payload.toolSurface === undefined
              ? {}
              : { toolSurface: event.payload.toolSurface }),
            ...(event.payload.toolIcon === undefined ? {} : { toolIcon: event.payload.toolIcon }),
            ...(event.payload.toolSource === undefined
              ? {}
              : { toolSource: event.payload.toolSource }),
          };
          const item: OrchestrationV2TurnItem = {
            ...base,
            type: "dynamic_tool",
            toolName: event.payload.title ?? event.payload.itemType,
            input: event.payload.data ?? null,
            ...(event.payload.detail === undefined ? {} : { output: event.payload.detail }),
          };
          nodes.set(key, node);
          items.set(key, item);
          output.push(
            { type: "node.updated", driver, node },
            { type: "turn_item.updated", driver, turnItem: item },
          );
        }
        if (
          event.type === "content.delta" &&
          (event.payload.streamKind === "command_output" ||
            event.payload.streamKind === "file_change_output")
        ) {
          const key = `${owner.runId}:tool:${event.itemId ?? event.eventId}`;
          const previous = items.get(key);
          if (previous?.type === "dynamic_tool") {
            const item = {
              ...previous,
              output:
                (typeof previous.output === "string" ? previous.output : "") + event.payload.delta,
              updatedAt: occurredAt,
            };
            items.set(key, item);
            output.push({ type: "turn_item.updated", driver, turnItem: item });
          }
        }
        if (
          event.type === "task.started" ||
          event.type === "task.progress" ||
          event.type === "task.updated" ||
          event.type === "task.completed"
        ) {
          const taskId = event.payload.taskId;
          const taskOwner = tasks.get(taskId) ?? owner;
          tasks.set(taskId, taskOwner);
          const key = `${instance.instanceId}:task:${taskId}`;
          const previous = items.get(key);
          const nodeId = NodeId.make(key);
          const status: OrchestrationV2ExecutionNode["status"] =
            event.type === "task.completed"
              ? event.payload.status === "stopped"
                ? "cancelled"
                : event.payload.status
              : event.type === "task.started"
                ? "running"
                : (event.payload.status ?? nodes.get(key)?.status ?? "running");
          const completed =
            status === "completed" ||
            status === "failed" ||
            status === "cancelled" ||
            status === "interrupted";
          const label =
            event.payload.title ??
            (event.type === "task.completed" ? event.payload.summary : event.payload.description) ??
            "Background task";
          const node: OrchestrationV2ExecutionNode = {
            id: nodeId,
            threadId: input.threadId,
            runId: taskOwner.runId,
            parentNodeId: taskOwner.rootNodeId,
            rootNodeId: taskOwner.rootNodeId,
            kind: "subagent",
            status,
            countsForRun: false,
            providerThreadId: providerThread.id,
            providerTurnId,
            nativeItemRef: { driver, nativeId: taskId, strength: "strong" },
            runtimeRequestId: null,
            checkpointScopeId: null,
            startedAt: previous?.startedAt ?? occurredAt,
            completedAt: completed ? occurredAt : null,
          };
          const item: OrchestrationV2TurnItem = {
            ...baseItem(key, nodeId),
            runId: taskOwner.runId,
            nativeItemRef: node.nativeItemRef,
            status: status === "idle" ? "waiting" : status === "rolled_back" ? "cancelled" : status,
            title: label,
            completedAt: node.completedAt,
            type: "subagent",
            subagentId: nodeId,
            origin: "provider_native",
            driver,
            providerInstanceId: instance.instanceId,
            childThreadId: null,
            prompt: previous?.type === "subagent" ? previous.prompt : label,
            ...(event.type === "task.progress" ? { progress: event.payload.description } : {}),
            result: event.type === "task.completed" ? (event.payload.summary ?? null) : null,
          };
          nodes.set(key, node);
          items.set(key, item);
          const subagent: OrchestrationV2Subagent = {
            id: nodeId,
            threadId: input.threadId,
            runId: taskOwner.runId,
            parentNodeId: taskOwner.rootNodeId,
            origin: "provider_native",
            createdBy: "agent",
            driver,
            providerInstanceId: instance.instanceId,
            providerThreadId: providerThread.id,
            childThreadId: null,
            nativeTaskRef: node.nativeItemRef,
            prompt: item.prompt,
            title: label,
            model: event.payload.model ?? null,
            status: status === "rolled_back" ? "cancelled" : status,
            result: item.result,
            startedAt: node.startedAt,
            completedAt: node.completedAt,
            updatedAt: occurredAt,
          };
          if (completed) subagents.delete(key);
          else subagents.set(key, subagent);
          output.push(
            { type: "node.updated", driver, node },
            { type: "turn_item.updated", driver, turnItem: item },
            { type: "subagent.updated", driver, subagent },
          );
          if (completed) tasks.delete(taskId);
        }
        if (event.type === "turn.plan.updated" || event.type === "turn.proposed.completed") {
          const key = `${owner.runId}:plan:${event.type === "turn.plan.updated" ? "todo" : "proposed"}`;
          const nodeId = NodeId.make(key);
          const planId = PlanId.make(key);
          const base = {
            ...baseItem(key, nodeId),
            status: "completed" as const,
            completedAt: occurredAt,
          };
          if (event.type === "turn.plan.updated") {
            const steps = event.payload.plan.map((step, index) => ({
              id: `${index}`,
              text: step.step,
              status: step.status === "inProgress" ? ("running" as const) : step.status,
            }));
            const item: OrchestrationV2TurnItem = {
              ...base,
              type: "todo_list",
              planId,
              steps,
              ...(event.payload.explanation == null
                ? {}
                : { explanation: event.payload.explanation }),
            };
            items.set(key, item);
            output.push(
              { type: "turn_item.updated", driver, turnItem: item },
              {
                type: "plan.updated",
                driver,
                plan: {
                  id: planId,
                  threadId: input.threadId,
                  runId: owner.runId,
                  nodeId,
                  status: "active",
                  kind: "todo_list",
                  steps,
                },
              },
            );
          } else {
            const item: OrchestrationV2TurnItem = {
              ...base,
              type: "proposed_plan",
              planId,
              markdown: event.payload.planMarkdown,
              streaming: false,
            };
            items.set(key, item);
            output.push(
              { type: "turn_item.updated", driver, turnItem: item },
              {
                type: "plan.updated",
                driver,
                plan: {
                  id: planId,
                  threadId: input.threadId,
                  runId: owner.runId,
                  nodeId,
                  status: "active",
                  kind: "proposed_plan",
                  markdown: event.payload.planMarkdown,
                },
              },
            );
          }
        }
        if (event.type === "session.exited") {
          cancelBackgroundTasks("cancelled");
          output.push(stoppedSession);
        }
        if (event.type === "runtime.error") cancelBackgroundTasks("failed");
        return output;
      });
      const events = providers.streamEvents.pipe(
        Stream.filter(
          (event) =>
            event.threadId === input.threadId &&
            (event.providerInstanceId === undefined ||
              event.providerInstanceId === instance.instanceId),
        ),
        Stream.mapEffect(convert),
        Stream.flatMap(Stream.fromIterable),
        Stream.takeUntil(
          (event) =>
            event.type === "provider_session.updated" && event.providerSession.status === "stopped",
        ),
        Stream.mapError(
          (cause) =>
            new ProviderAdapterEventStreamError({
              driver,
              providerSessionId: input.providerSessionId,
              cause,
            }),
        ),
      );
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          const current = (yield* providers.listSessions()).find(
            (candidate) => candidate.threadId === input.threadId,
          );
          if (
            current?.providerInstanceId === instance.instanceId &&
            current.createdAt === session.createdAt
          ) {
            yield* providers.stopSession({ threadId: input.threadId }).pipe(Effect.ignore);
          }
        }),
      );
      return {
        instanceId: instance.instanceId,
        driver,
        providerSessionId: input.providerSessionId,
        providerSession: {
          id: input.providerSessionId,
          driver,
          providerInstanceId: instance.instanceId,
          status: "ready",
          cwd: session.cwd ?? input.runtimePolicy.cwd ?? ".",
          model: session.model ?? input.modelSelection.model,
          capabilities,
          createdAt: now,
          updatedAt: now,
          lastError: null,
        },
        events,
        hasPendingBackgroundWork,
        hasPendingBackgroundWorkForThread: () => hasPendingBackgroundWork,
        ensureThread: (ensure) =>
          Effect.sync(() => {
            providerThread = {
              ...(ensure.existingProviderThread ?? providerThread),
              providerSessionId: input.providerSessionId,
              status: "idle",
            };
            return providerThread;
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterEnsureThreadError({ driver, threadId: input.threadId, cause }),
            ),
          ),
        resumeThread: (resume) =>
          Effect.sync(() => {
            providerThread = {
              ...resume.providerThread,
              providerSessionId: input.providerSessionId,
              status: "idle",
            };
            return providerThread;
          }),
        startTurn: (turn) =>
          Effect.gen(function* () {
            active = turn;
            rootTurnEnded = false;
            lastNativeTurn = undefined;
            messages.clear();
            for (const [key, item] of items)
              if (
                item.type !== "subagent" ||
                item.nativeItemRef?.nativeId == null ||
                !tasks.has(item.nativeItemRef.nativeId)
              )
                items.delete(key);
            for (const [key, node] of nodes)
              if (node.countsForRun || node.completedAt !== null) nodes.delete(key);
            for (const [key, request] of requests)
              if (request.status !== "pending") requests.delete(key);
            while (turnOwners.size > 8) {
              const key = turnOwners.keys().next().value;
              if (key !== undefined) turnOwners.delete(key);
            }
            while (turns.size > 8) {
              const key = turns.keys().next().value;
              if (key !== undefined) turns.delete(key);
            }
            const request = yield* (
              prepared?.take(turn.message.messageId) ?? Effect.succeed(undefined)
            );
            yield* providers.sendTurn(
              request ?? {
                threadId: input.threadId,
                input: turn.message.text,
                attachments: turn.message.attachments,
                modelSelection: turn.modelSelection,
                interactionMode: turn.runtimePolicy.interactionMode,
              },
            );
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterTurnStartError({
                  driver,
                  threadId: input.threadId,
                  providerThreadId: turn.providerThread.id,
                  runId: turn.runId,
                  cause,
                }),
            ),
          ),
        compactThread: (turn) =>
          Effect.gen(function* () {
            active = turn;
            yield* providers.compactThread(
              input.threadId,
              turn.modelSelection,
              turn.message.messageId,
            );
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterTurnStartError({
                  driver,
                  threadId: input.threadId,
                  providerThreadId: turn.providerThread.id,
                  runId: turn.runId,
                  cause,
                }),
            ),
          ),
        steerTurn: (steer) =>
          Effect.gen(function* () {
            const request = yield* (
              prepared?.take(steer.message.messageId) ?? Effect.succeed(undefined)
            );
            yield* providers.sendTurn(
              request ?? {
                threadId: input.threadId,
                input: steer.message.text,
                attachments: steer.message.attachments,
              },
            );
          }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterSteerRunError({
                  driver,
                  providerThreadId: steer.providerThread.id,
                  providerTurnId: steer.providerTurnId,
                  cause,
                }),
            ),
          ),
        interruptTurn: (interrupt) =>
          providers.interruptTurn({ threadId: input.threadId }).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterInterruptError({
                  driver,
                  providerThreadId: interrupt.providerThread.id,
                  providerTurnId: interrupt.providerTurnId,
                  cause,
                }),
            ),
          ),
        respondToRuntimeRequest: (response) =>
          (response.answers !== undefined
            ? providers.respondToUserInput({
                threadId: input.threadId,
                requestId: ApprovalRequestId.make(response.requestId),
                answers: response.answers,
              })
            : providers.respondToRequest({
                threadId: input.threadId,
                requestId: ApprovalRequestId.make(response.requestId),
                decision: response.decision ?? "decline",
              })
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRuntimeRequestResponseError({
                  driver,
                  requestId: response.requestId,
                  cause,
                }),
            ),
          ),
        readThreadSnapshot: () => Effect.succeed(snapshot()),
        rollbackThread: (rollback) => {
          const targetOrdinal =
            rollback.target.type === "thread_start" ? -1 : rollback.target.providerTurn.ordinal;
          const count = rollback.providerThreadTurns.filter(
            (turn) => turn.ordinal > targetOrdinal,
          ).length;
          return (
            count === 0
              ? Effect.void
              : providers.rollbackConversation({ threadId: input.threadId, numTurns: count })
          ).pipe(
            Effect.as(snapshot()),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterRollbackThreadError({
                  driver,
                  providerThreadId: providerThread.id,
                  cause,
                }),
            ),
          );
        },
        forkThread: () =>
          Effect.fail(
            new ProviderAdapterForkThreadError({
              driver,
              providerThreadId: providerThread.id,
              cause: "Ronin uses a portable context handoff for provider forks.",
            }),
          ),
      };
    }),
  };
}

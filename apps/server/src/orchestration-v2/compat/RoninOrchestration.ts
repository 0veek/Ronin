import {
  CommandId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type ProviderSendTurnInput,
} from "@t3tools/contracts";
import {
  type OrchestrationV2DomainEvent,
  OrchestrationV2AppThread,
} from "@t3tools/contracts/orchestration-v2";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { PROCESS_BOUND_EFFECT_TYPES } from "../EffectOutbox.ts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../../serverActivation.ts";
import { EventSinkV2 } from "../EventSink.ts";
import { IdAllocatorV2 } from "../IdAllocator.ts";
import { OrchestratorV2 } from "../Orchestrator.ts";
import { ProjectionStoreV2 } from "../ProjectionStore.ts";
import { ProviderRuntimeRecoveryService } from "../ProviderRuntimeRecoveryService.ts";
import { ProviderSessionManagerV2 } from "../ProviderSessionManager.ts";
import { ThreadManagementService } from "../ThreadManagementService.ts";
import { ThreadCommandExecutor } from "../ThreadCommandExecutor.ts";
import * as EffectWorker from "../EffectWorker.ts";
import { LegacyV1ThreadImporter } from "./LegacyV1ThreadImporter.ts";
import { PreparedTurnRequests } from "./PreparedTurnRequests.ts";
import { RuntimeReceiptBus } from "../../orchestration/Services/RuntimeReceiptBus.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";

export class RoninOrchestrationError extends Schema.TaggedErrorClass<RoninOrchestrationError>()(
  "RoninOrchestrationError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export class RoninOrchestration extends Context.Service<
  RoninOrchestration,
  {
    readonly start: Effect.Effect<void, RoninOrchestrationError, Scope.Scope>;
    readonly startTurn: (input: {
      readonly commandId: CommandId;
      readonly threadId: ThreadId;
      readonly messageId: MessageId;
      readonly request: ProviderSendTurnInput;
    }) => Effect.Effect<void, RoninOrchestrationError>;
    readonly interrupt: (
      threadId: ThreadId,
      commandId: CommandId,
    ) => Effect.Effect<boolean, RoninOrchestrationError>;
    readonly detach: (threadId: ThreadId) => Effect.Effect<void, RoninOrchestrationError>;
    readonly syncThread: (threadId: ThreadId) => Effect.Effect<void, RoninOrchestrationError>;
    readonly ownsTurn: (
      threadId: ThreadId,
      turnId: TurnId,
    ) => Effect.Effect<boolean, RoninOrchestrationError>;
  }
>()("t3/orchestration-v2/compat/RoninOrchestration") {}

const utc = (value: string | null | undefined) =>
  value == null ? null : DateTime.makeUnsafe(value);
const sameThread = Schema.toEquivalence(OrchestrationV2AppThread);
const failure = (operation: string) => (cause: unknown) =>
  new RoninOrchestrationError({ operation, cause });

export const layer = Layer.effect(
  RoninOrchestration,
  Effect.gen(function* () {
    const legacy = yield* OrchestrationEngineService;
    const shells = yield* ProjectionSnapshotQuery;
    const threads = yield* ThreadManagementService;
    const projections = yield* ProjectionStoreV2;
    const orchestrator = yield* OrchestratorV2;
    const sink = yield* EventSinkV2;
    const ids = yield* IdAllocatorV2;
    const importer = yield* LegacyV1ThreadImporter;
    const recovery = yield* ProviderRuntimeRecoveryService;
    const sessions = yield* ProviderSessionManagerV2;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    const prepared = yield* PreparedTurnRequests;
    const receipts = yield* RuntimeReceiptBus;
    const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
    const sql = yield* SqlClient.SqlClient;
    const commands = yield* ThreadCommandExecutor;

    const syncThread = Effect.fn("RoninOrchestration.syncThread")(
      function* (threadId: ThreadId) {
        const shell = yield* shells.getThreadShellById(threadId);
        if (Option.isNone(shell)) return;
        const source = shell.value;
        const current = yield* projections
          .getThread(threadId)
          .pipe(Effect.catchTag("ProjectionStoreThreadNotFoundError", () => Effect.succeed(null)));
        if (current === null) {
          yield* orchestrator.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`v2:ronin:create:${threadId}`),
            threadId,
            projectId: source.projectId,
            title: source.title,
            modelSelection: source.modelSelection,
            runtimeMode: source.runtimeMode,
            interactionMode: source.interactionMode,
            branch: source.branch,
            worktreePath: source.worktreePath,
            createdBy: "user",
            creationSource: "web",
          });
        }
        yield* commands.withLock(
          threadId,
          Effect.gen(function* () {
            const current = yield* projections.getThread(threadId);
            const latest = yield* shells.getThreadShellById(threadId);
            if (Option.isNone(latest)) return;
            const source = latest.value;
            const thread: OrchestrationV2AppThread = {
              ...current,
              title: source.title,
              modelSelection: source.modelSelection,
              providerInstanceId: source.modelSelection.instanceId,
              runtimeMode: source.runtimeMode,
              interactionMode: source.interactionMode,
              branch: source.branch,
              worktreePath: source.worktreePath,
              pullRequests: source.pullRequests,
              linkedPullRequest: source.linkedPullRequest ?? null,
              branchPullRequest: source.branchPullRequest ?? null,
              archivedAt: utc(source.archivedAt),
              settledOverride: source.settledOverride,
              settledAt: utc(source.settledAt),
              unsettledAt: utc(source.unsettledAt),
              snoozedAt: utc(source.snoozedAt),
              snoozedUntil: utc(source.snoozedUntil),
              pinnedAt: utc(source.pinnedAt),
              pinOrderKey: source.pinOrderKey ?? null,
              activeOrderKey: source.activeOrderKey ?? null,
              autoSettleDisabledAt: utc(source.autoSettleDisabledAt),
            };
            if (sameThread(thread, current)) return;
            yield* sink.write({
              events: [
                {
                  id: yield* ids.allocate.event({ threadId }),
                  type: "thread.metadata-updated",
                  threadId,
                  occurredAt: yield* DateTime.now,
                  payload: thread,
                },
              ],
            });
          }),
        );
      },
      Effect.mapError(failure("synchronize thread")),
    );

    const detach = Effect.fn("RoninOrchestration.detach")(
      function* (threadId: ThreadId) {
        const context = yield* projections
          .getThreadProviderContext(threadId)
          .pipe(Effect.catchTag("ProjectionStoreThreadNotFoundError", () => Effect.succeed(null)));
        if (context === null) return;
        yield* prepared.clearThread(threadId);
        for (const session of context.providerSessions) {
          yield* sessions.detach({ threadId, providerSessionId: session.id });
        }
      },
      Effect.mapError(failure("detach provider session")),
    );

    const mirror = Effect.fn("RoninOrchestration.mirror")(function* (event: OrchestrationEvent) {
      switch (event.type) {
        case "thread.created":
        case "thread.meta-updated":
        case "thread.archived":
        case "thread.unarchived":
        case "thread.settled":
        case "thread.unsettled":
        case "thread.snoozed":
        case "thread.unsnoozed":
        case "thread.pinned":
        case "thread.unpinned":
        case "thread.pin-reordered":
        case "thread.auto-settle-set":
        case "thread.runtime-mode-set":
        case "thread.interaction-mode-set":
        case "thread.provider-switched":
          yield* syncThread(event.payload.threadId);
          return;
        case "thread.reverted": {
          yield* detach(event.payload.threadId);
          yield* commands.withLock(
            event.payload.threadId,
            Effect.gen(function* () {
              const projection = yield* projections.getThreadRecords(event.payload.threadId, [
                "runs",
                "nodes",
                "providerThreads",
                "runtimeRequests",
              ]);
              const retained = yield* sql<{
                readonly id: string;
              }>`SELECT message_id AS id FROM projection_thread_messages WHERE thread_id = ${event.payload.threadId}`;
              const retainedIds = new Set(retained.map((message) => message.id));
              const removedRuns = projection.runs.filter(
                (run) => !retainedIds.has(run.userMessageId),
              );
              const removedIds = new Set(removedRuns.map((run) => run.id));
              const now = yield* DateTime.now;
              const events: Array<OrchestrationV2DomainEvent> = [];
              for (const run of removedRuns)
                events.push({
                  id: yield* ids.allocate.event({ threadId: event.payload.threadId }),
                  type: "run.updated",
                  threadId: event.payload.threadId,
                  runId: run.id,
                  occurredAt: now,
                  payload: { ...run, status: "rolled_back", completedAt: now },
                });
              for (const node of projection.nodes) {
                if (node.runId !== null && removedIds.has(node.runId))
                  events.push({
                    id: yield* ids.allocate.event({ threadId: event.payload.threadId }),
                    type: "node.updated",
                    threadId: event.payload.threadId,
                    nodeId: node.id,
                    occurredAt: now,
                    payload: { ...node, status: "rolled_back", completedAt: now },
                  });
              }
              for (const providerThread of projection.providerThreads)
                events.push({
                  id: yield* ids.allocate.event({ threadId: event.payload.threadId }),
                  type: "provider-thread.updated",
                  threadId: event.payload.threadId,
                  occurredAt: now,
                  payload: { ...providerThread, status: "closed", updatedAt: now },
                });
              for (const request of projection.runtimeRequests)
                if (request.status === "pending")
                  events.push({
                    id: yield* ids.allocate.event({ threadId: event.payload.threadId }),
                    type: "runtime-request.updated",
                    threadId: event.payload.threadId,
                    occurredAt: now,
                    payload: { ...request, status: "cancelled", resolvedAt: now },
                  });
              const thread = yield* projections.getThread(event.payload.threadId);
              events.push({
                id: yield* ids.allocate.event({ threadId: thread.id }),
                type: "thread.metadata-updated",
                threadId: thread.id,
                occurredAt: now,
                payload: { ...thread, activeProviderThreadId: null },
              });
              yield* sink.commitCommand({
                commandId: CommandId.make(`v2:ronin:revert:${event.eventId}`),
                threadId: thread.id,
                commandType: "ronin.revert",
                acceptedAt: now,
                events,
                effects: [],
                cancelUnsettledEffects: {
                  effectTypes: PROCESS_BOUND_EFFECT_TYPES,
                  reason: "Conversation reverted through the Ronin client.",
                },
              });
            }),
          );
          yield* syncThread(event.payload.threadId);
          return;
        }
        case "thread.deleted":
          yield* detach(event.payload.threadId);
          if (yield* orchestrator.getThreadShell(event.payload.threadId)) {
            yield* threads.dispatch({
              type: "thread.delete",
              threadId: event.payload.threadId,
              commandId: CommandId.make(`v2:ronin:delete:${event.eventId}`),
            });
          }
          return;
        case "project.deleted": {
          const rows = yield* sql<{
            readonly thread_id: string;
          }>`SELECT thread_id FROM orchestration_v2_projection_threads WHERE project_id = ${event.payload.projectId} AND deleted_at IS NULL`;
          for (const row of rows) {
            const threadId = ThreadId.make(row.thread_id);
            yield* detach(threadId);
            yield* threads.dispatch({
              type: "thread.delete",
              threadId,
              commandId: CommandId.make(`v2:ronin:project-delete:${event.eventId}:${threadId}`),
            });
          }
          return;
        }
      }
    });
    const mirrors = yield* makeDrainableWorker((event: OrchestrationEvent) =>
      mirror(event).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("V2 thread synchronization failed", { eventType: event.type, cause }),
        ),
      ),
    );

    const reflectCheckpoint = Effect.fn("RoninOrchestration.reflectCheckpoint")(function* (
      event: OrchestrationV2DomainEvent,
    ) {
      if (event.type !== "checkpoint.captured" || event.payload.runId === null) return;
      const checkpoint = event.payload;
      const context = yield* projections.getThreadRecords(event.threadId, [
        "runs",
        "providerTurns",
        "checkpointScopes",
      ]);
      const run = context.runs.find((run) => run.id === checkpoint.runId);
      const scope = context.checkpointScopes.find((scope) => scope.id === checkpoint.scopeId);
      const turn = context.providerTurns.findLast((turn) => turn.nodeId === run?.rootNodeId);
      if (
        run === undefined ||
        scope?.legacyTurnOffset === undefined ||
        turn?.nativeTurnRef?.nativeId == null
      )
        return;
      const turnId = TurnId.make(turn.nativeTurnRef.nativeId);
      const count = checkpoint.ordinalWithinScope + scope.legacyTurnOffset;
      const createdAt = DateTime.formatIso(checkpoint.capturedAt);
      const status = checkpoint.status === "stale" ? "missing" : checkpoint.status;
      const messages = yield* sql<{
        readonly message_id: string;
      }>`SELECT message_id FROM projection_thread_messages WHERE thread_id = ${event.threadId} AND turn_id = ${turnId} AND role = 'assistant' ORDER BY rowid DESC LIMIT 1`;
      const assistantMessageId =
        messages[0] === undefined ? undefined : MessageId.make(messages[0].message_id);
      yield* legacy.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.make(`v2:ronin:checkpoint:${checkpoint.id}`),
        threadId: event.threadId,
        turnId,
        completedAt: createdAt,
        checkpointRef: checkpoint.ref,
        status,
        files: checkpoint.files,
        assistantMessageId: assistantMessageId ?? MessageId.make(`assistant:${turnId}`),
        checkpointTurnCount: count,
        createdAt,
      });
      yield* workspaceEntries.refresh(scope.cwd);
      yield* legacy.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`v2:ronin:checkpoint-activity:${checkpoint.id}`),
        threadId: event.threadId,
        createdAt,
        activity: {
          id: EventId.make(`v2:ronin:checkpoint:${checkpoint.id}`),
          tone: "info",
          kind: "checkpoint.captured",
          summary: "Checkpoint captured",
          payload: { turnCount: count, status },
          turnId,
          createdAt,
        },
      });
      yield* receipts.publish({
        type: "checkpoint.diff.finalized",
        threadId: event.threadId,
        turnId,
        checkpointTurnCount: count,
        checkpointRef: checkpoint.ref,
        status,
        createdAt,
      });
      yield* receipts.publish({
        type: "turn.processing.quiesced",
        threadId: event.threadId,
        turnId,
        checkpointTurnCount: count,
        createdAt,
      });
    });

    const reflectEvent = Effect.fn("RoninOrchestration.reflectEvent")(function* (
      event: OrchestrationV2DomainEvent,
    ) {
      yield* reflectCheckpoint(event);
      if (
        event.type !== "run.updated" ||
        (event.payload.status !== "failed" && event.payload.status !== "cancelled")
      )
        return;
      const run = event.payload;
      yield* prepared.take(run.userMessageId);
      const context = yield* projections.getThreadRecords(event.threadId, [
        "providerTurns",
        "turnItems",
      ]);
      if (
        context.providerTurns.some(
          (turn) => turn.nodeId === run.rootNodeId && turn.nativeTurnRef?.nativeId != null,
        )
      )
        return;
      const error = context.turnItems.findLast(
        (item) => item.runId === run.id && item.type === "error",
      );
      const createdAt = DateTime.formatIso(event.occurredAt);
      const detail =
        error?.type === "error"
          ? error.failure.message
          : "The turn ended before the provider started.";
      if (run.status === "failed") {
        const shell = yield* shells.getThreadShellById(event.threadId);
        const pending = yield* sql<{
          readonly pending_message_id: string;
        }>`SELECT pending_message_id FROM projection_turns WHERE thread_id = ${event.threadId} AND turn_id IS NULL AND state = 'pending' ORDER BY requested_at DESC LIMIT 1`;
        if (
          Option.isSome(shell) &&
          pending[0]?.pending_message_id === run.userMessageId &&
          shell.value.session?.activeTurnId == null
        ) {
          const thread = shell.value;
          yield* legacy.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(`v2:ronin:start-failed-session:${run.id}`),
            threadId: event.threadId,
            createdAt,
            session: {
              threadId: thread.id,
              providerName: null,
              providerInstanceId: thread.modelSelection.instanceId,
              runtimeMode: thread.runtimeMode,
              ...thread.session,
              status: thread.session?.status === "stopped" ? "stopped" : "error",
              activeTurnId: null,
              lastError: detail,
              updatedAt: createdAt,
            },
          });
        }
      }
      yield* legacy.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`v2:ronin:start-failed:${run.id}`),
        threadId: event.threadId,
        createdAt,
        activity: {
          id: EventId.make(`v2:ronin:start-failed:${run.id}`),
          tone: "error",
          kind: "provider.turn.start.failed",
          summary:
            run.status === "cancelled"
              ? "Queued message was not sent"
              : "Provider turn start failed",
          payload: { requestId: run.userMessageId, detail },
          turnId: null,
          createdAt,
        },
      });
    });

    return RoninOrchestration.of({
      syncThread,
      detach,
      ownsTurn: (threadId, turnId) =>
        projections.getThreadRecords(threadId, ["runs", "providerTurns"]).pipe(
          Effect.map(
            ({ runs, providerTurns }) =>
              providerTurns.some(
                (turn) =>
                  turn.nativeTurnRef?.nativeId === turnId &&
                  runs.some((run) => run.rootNodeId === turn.nodeId),
              ) ||
              runs.some(
                (run) =>
                  run.status === "starting" &&
                  !providerTurns.some((turn) => turn.nodeId === run.rootNodeId),
              ),
          ),
          Effect.catchTag("ProjectionStoreThreadNotFoundError", () => Effect.succeed(false)),
          Effect.mapError(failure("resolve turn owner")),
        ),
      startTurn: (input) =>
        Effect.gen(function* () {
          yield* syncThread(input.threadId);
          yield* threads.ensureLegacyTranscript(input.threadId);
          const original = yield* shells.getTurnStartMessage(input);
          const context = yield* projections.getThreadProviderContext(input.threadId);
          const canSteer = context.providerSessions.some(
            (session) =>
              session.providerInstanceId ===
                (input.request.modelSelection?.instanceId ?? context.thread.providerInstanceId) &&
              session.capabilities.turns.supportsActiveSteering,
          );
          yield* prepared.put(input.messageId, input.request);
          yield* threads
            .sendToThread({
              projectId: (yield* projections.getThread(input.threadId)).projectId,
              commandId: CommandId.make(`v2:ronin:turn:${input.commandId}`),
              threadId: input.threadId,
              messageId: input.messageId,
              text: Option.isSome(original)
                ? original.value.message.text
                : (input.request.input ?? ""),
              attachments: input.request.attachments ?? [],
              ...(input.request.modelSelection === undefined
                ? {}
                : { modelSelection: input.request.modelSelection }),
              mode: canSteer ? "auto" : "queue",
              createdBy: "user",
              creationSource: "web",
            })
            .pipe(Effect.onError(() => prepared.take(input.messageId)));
        }).pipe(Effect.mapError(failure("start turn"))),
      interrupt: (threadId, commandId) =>
        Effect.gen(function* () {
          const thread = yield* orchestrator.getThreadShell(threadId);
          if (thread === null) return false;
          const result = yield* threads.interruptThread({
            projectId: thread.projectId,
            threadId,
            commandId: CommandId.make(`v2:ronin:interrupt:${commandId}`),
          });
          return result.type === "interrupt_requested";
        }).pipe(Effect.mapError(failure("interrupt turn"))),
      start: Effect.gen(function* () {
        yield* importer.reconcileShells;
        const domainEvents = yield* legacy.subscribeDomainEvents;
        const afterSequence = yield* sink.latestSequence();
        yield* forkParked(Stream.runForEach(domainEvents, mirrors.enqueue));
        yield* forkParked(
          Stream.runForEach(sink.stream({ afterSequence }), ({ event }) =>
            reflectEvent(event).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("V2 compatibility projection failed", { cause }),
              ),
            ),
          ),
        );
        yield* recovery.recover;
        // The current Ronin client has no V2 queue-resume action. Report saved
        // unsent turns as cancelled rather than leave a hidden held queue.
        for (const thread of (yield* orchestrator.getShellSnapshot()).threads) {
          const context = yield* projections.getThreadRecords(thread.id, ["runs"]);
          for (const run of context.runs)
            if (run.status === "queued" && run.queueHeld === true) {
              yield* threads.dispatch({
                type: "queued-run.cancel",
                threadId: thread.id,
                runId: run.id,
                commandId: CommandId.make(`v2:ronin:restart-cancel:${run.id}`),
              });
            }
        }
        yield* orchestrator.recoverDelegatedTasks;
        yield* forkParked(
          EffectWorker.runDaemon.pipe(
            Effect.provideService(EffectWorker.OrchestrationEffectWorkerV2, worker),
          ),
        );
        yield* Effect.addFinalizer(() => sessions.shutdown);
      }).pipe(Effect.mapError(failure("start V2 orchestration"))),
    });
  }),
);

import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  EventId,
  NodeId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { type OrchestrationV2DomainEvent } from "@t3tools/contracts/orchestration-v2";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as ServerConfig from "../../config.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import * as CheckpointStore from "../../checkpointing/CheckpointStore.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as WorkspaceEntries from "../../workspace/WorkspaceEntries.ts";
import * as GitWorkflow from "../../git/GitWorkflowService.ts";
import { OrchestrationLayerLive } from "../../orchestration/runtimeLayer.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../../orchestration/Services/RuntimeReceiptBus.ts";
import { RuntimeReceiptBusTest } from "../../orchestration/Layers/RuntimeReceiptBus.ts";
import { ProviderRuntimeIngestionLive } from "../../orchestration/Layers/ProviderRuntimeIngestion.ts";
import { ProviderRuntimeIngestionService } from "../../orchestration/Services/ProviderRuntimeIngestion.ts";
import { CheckpointReactorLive } from "../../orchestration/Layers/CheckpointReactor.ts";
import { CheckpointReactor } from "../../orchestration/Services/CheckpointReactor.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { PullRequestService } from "../../pullRequest/PullRequestService.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import { OrchestrationEffectWorkerV2 } from "../EffectWorker.ts";
import { EventSinkV2 } from "../EventSink.ts";
import { OrchestratorV2 } from "../Orchestrator.ts";
import { ProviderAdapterRegistryV2 } from "../ProviderAdapterRegistry.ts";
import { layerWithAdapters } from "../runtimeLayer.ts";
import { makeLegacyProviderAdapterV2 } from "./LegacyProviderAdapter.ts";
import { PreparedTurnRequests } from "./PreparedTurnRequests.ts";
import * as RoninOrchestration from "./RoninOrchestration.ts";

const drivers = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "opencode",
  "antigravity",
  "droid",
  "kilo",
  "pi",
] as const;
const decodeEvent = Schema.decodeUnknownSync(ProviderRuntimeEvent);

const testBridge = (
  driverName: (typeof drivers)[number],
  scenario:
    | "automatic-completion"
    | "basic"
    | "steer"
    | "background"
    | "background-exit"
    | "failed-background-stop"
    | "native-wake"
    | "failed-start"
    | "history"
    | "interrupt"
    | "revert"
    | "delete-project" = "basic",
) =>
  Effect.gen(function* () {
    const driver = ProviderDriverKind.make(driverName);
    const instanceId = ProviderInstanceId.make(`${driverName}-personal`);
    const threadId = ThreadId.make(`bridge:${driverName}`);
    const projectId = ProjectId.make("bridge-project");
    const messageId = MessageId.make("bridge-message");
    const turnId = TurnId.make("native-turn");
    const now = "2026-10-04T00:00:00.000Z";
    const modelSelection = { instanceId, model: "test-model" };
    const source = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const sent = yield* Queue.unbounded<ProviderSendTurnInput>();
    const stopped = yield* Queue.unbounded<ThreadId>();
    const interrupted = yield* Queue.unbounded<ThreadId>();
    const checkpoints = new Set<string>();
    const captures: Array<string> = [];
    let starts = 0;
    let sends = 0;
    let session: ProviderSession | undefined = {
      provider: driver,
      providerInstanceId: instanceId,
      threadId,
      status: "ready",
      runtimeMode: "auto-accept-edits",
      cwd: "/tmp",
      model: "test-model",
      createdAt: now,
      updatedAt: now,
    };
    const capabilities = {
      sessionModelSwitch: "in-session" as const,
      supportsConversationRollback: driverName !== "cursor" && driverName !== "grok",
    };

    const providers = Layer.mock(ProviderService)({
      listSessions: () => Effect.succeed(session === undefined ? [] : [session]),
      getContinuationState: () => Effect.succeed(Option.none()),
      startSession: (_threadId, input) =>
        Effect.sync(() => {
          starts++;
          session = {
            provider: driver,
            providerInstanceId: instanceId,
            threadId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd: input.cwd ?? "/tmp",
            model: "test-model",
            createdAt: now,
            updatedAt: now,
          };
          return session;
        }),
      sendTurn: (input) =>
        Queue.offer(sent, input).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              sends++;
              return scenario === "failed-start" ||
                (scenario === "failed-background-stop" && sends === 2)
                ? Effect.fail(
                    new ProviderAdapterRequestError({
                      provider: driver,
                      method: "sendTurn",
                      detail: "Test provider rejected the prompt",
                    }),
                  )
                : Effect.succeed({ threadId, turnId });
            }),
          ),
        ),
      stopSession: ({ threadId }) =>
        Effect.sync(() => {
          session = undefined;
        }).pipe(Effect.andThen(Queue.offer(stopped, threadId)), Effect.asVoid),
      interruptTurn: () => Queue.offer(interrupted, threadId).pipe(Effect.asVoid),
      respondToRequest: () => Effect.void,
      respondToUserInput: () => Effect.void,
      rollbackConversation: () => Effect.void,
      streamEvents: Stream.fromPubSub(source),
    });
    const adapters = Layer.effect(
      ProviderAdapterRegistryV2,
      Effect.gen(function* () {
        const provider = yield* ProviderService;
        const prepared = yield* PreparedTurnRequests;
        const adapter = makeLegacyProviderAdapterV2(
          { driverKind: driver, instanceId, adapter: { capabilities } },
          provider,
          prepared,
        );
        return ProviderAdapterRegistryV2.of({
          get: () => Effect.succeed(adapter),
          list: () => Effect.succeed([instanceId]),
          getMetadata: () =>
            adapter.getCapabilities().pipe(
              Effect.orDie,
              Effect.map((capabilities) => ({
                driver,
                continuationKey: `test:${instanceId}`,
                enabled: true,
                capabilities,
              })),
            ),
        });
      }),
    );
    const dependencies = Layer.mergeAll(
      providers,
      ServerSettings.layerTest({ textGenerationModelSelection: modelSelection }),
      RuntimeReceiptBusTest,
      Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
        resolve: () => Effect.succeed(null),
      }),
      Layer.mock(WorkspaceEntries.WorkspaceEntries)({ refresh: () => Effect.void }),
      Layer.mock(TextGeneration.TextGeneration)({
        generateThreadTitle: () => Effect.succeed({ title: "Preserved title" }),
      }),
      Layer.mock(GitWorkflow.GitWorkflowService)({}),
      Layer.mock(VcsStatusBroadcaster)({
        refreshLocalStatus: () =>
          Effect.succeed({
            isRepo: true,
            hasPrimaryRemote: false,
            isDefaultRef: true,
            refName: "main",
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          }),
        refreshPullRequestStatus: () => Effect.succeed(null),
      }),
      Layer.mock(PullRequestService)({ refreshAfterTurn: () => Effect.void }),
      Layer.mock(CheckpointStore.CheckpointStore)({
        isGitRepository: () => Effect.succeed(true),
        hasCheckpointRef: ({ checkpointRef }) => Effect.succeed(checkpoints.has(checkpointRef)),
        captureCheckpoint: ({ checkpointRef }) =>
          Effect.sync(() => {
            checkpoints.add(checkpointRef);
            captures.push(checkpointRef);
          }),
        diffCheckpoints: () => Effect.succeed("1\t0\tchanged.ts\n"),
      }),
      Layer.mock(McpSessionRegistry.McpSessionRegistry)({
        resolve: () => Effect.succeed(undefined),
        touch: () => Effect.void,
        issue: (request) =>
          Effect.succeed({
            config: {
              ...request,
              environmentId: EnvironmentId.make("test-environment"),
              providerSessionId: "mcp:test",
              endpoint: "http://127.0.0.1/mcp",
              authorizationHeader: "Bearer test-only",
            },
          }),
        revokeThread: () => Effect.void,
        revokeProviderSession: () => Effect.void,
        revokeAll: Effect.void,
      }),
    );
    const runtime = Layer.merge(ProviderRuntimeIngestionLive, CheckpointReactorLive).pipe(
      Layer.provideMerge(
        RoninOrchestration.layer.pipe(Layer.provideMerge(layerWithAdapters(adapters))),
      ),
      Layer.provideMerge(OrchestrationLayerLive),
      Layer.provideMerge(dependencies),
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provide(ServerConfig.layerTest("/tmp", { prefix: "ronin-v2-bridge-" })),
      Layer.provide(NodeServices.layer),
    );
    yield* Effect.gen(function* () {
      const legacy = yield* OrchestrationEngineService;
      const bridge = yield* RoninOrchestration.RoninOrchestration;
      const v2 = yield* OrchestratorV2;
      const shells = yield* ProjectionSnapshotQuery;
      const receipts = yield* RuntimeReceiptBus;
      const sql = yield* SqlClient.SqlClient;
      const sink = yield* EventSinkV2;
      const ingestion = yield* ProviderRuntimeIngestionService;
      const checkpointReactor = yield* CheckpointReactor;
      const awaitEvent = (predicate: (event: OrchestrationV2DomainEvent) => boolean) =>
        sink.stream({ afterSequence: 0 }).pipe(
          Stream.filter(({ event }) => predicate(event)),
          Stream.runHead,
        );
      yield* legacy.dispatch({
        type: "project.create",
        commandId: CommandId.make("project"),
        projectId,
        title: "Ronin project",
        workspaceRoot: "/tmp",
        createdAt: now,
      });
      yield* legacy.dispatch({
        type: "thread.create",
        commandId: CommandId.make("thread"),
        threadId,
        projectId,
        title: "Ronin thread",
        modelSelection,
        runtimeMode: "auto-accept-edits",
        interactionMode: "debug",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });
      yield* sql`UPDATE projection_threads SET comparison_group_id = 'comparison-1', queued_prompt = 'keep this prompt', side_chat_parent_thread_id = 'parent', side_chat_anchor_message_id = 'anchor' WHERE thread_id = ${threadId}`;
      if (scenario === "history") {
        yield* sql`INSERT INTO projection_thread_messages (message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at) VALUES ('old-user', ${threadId}, 'old-turn', 'user', 'Old prompt', 0, ${now}, ${now}), ('old-assistant', ${threadId}, 'old-turn', 'assistant', 'Old answer', 0, ${now}, ${now})`;
        yield* sql`INSERT INTO projection_turns (thread_id, turn_id, pending_message_id, assistant_message_id, state, requested_at, started_at, completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json) VALUES (${threadId}, 'old-turn', 'old-user', 'old-assistant', 'completed', ${now}, ${now}, ${now}, 5, ${checkpointRefForThreadTurn(threadId, 5)}, 'ready', '[]')`;
        checkpoints.add(checkpointRefForThreadTurn(threadId, 5));
      }
      yield* bridge.start;
      yield* ingestion.start();
      yield* checkpointReactor.start();
      const migratedShell = yield* shells.getThreadShellById(threadId);
      assert.isTrue(Option.isSome(migratedShell));
      if (Option.isSome(migratedShell))
        assert.strictEqual(migratedShell.value.queuedPrompt, "keep this prompt");
      yield* legacy.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("turn"),
        threadId,
        runtimeMode: "auto-accept-edits",
        interactionMode: "debug",
        message: { messageId, role: "user", text: "Implement it", attachments: [] },
        createdAt: now,
      });
      const checkpointDone = yield* Deferred.make<void>();
      yield* Stream.runForEach(receipts.streamEventsForTest, (receipt) =>
        receipt.type === "checkpoint.diff.finalized" && receipt.threadId === threadId
          ? Deferred.succeed(checkpointDone, undefined)
          : Effect.void,
      ).pipe(Effect.forkScoped);
      const preparedText = "Ronin skill instructions\nDebug mode instructions\nImplement it";
      const domainEvents = yield* legacy.subscribeDomainEvents;
      yield* bridge.startTurn({
        threadId,
        commandId: CommandId.make("turn"),
        messageId,
        request: {
          threadId,
          input: preparedText,
          attachments: [],
          modelSelection,
          interactionMode: "debug",
        },
      });
      const request = yield* Queue.take(sent);
      assert.strictEqual(request.input, preparedText);
      assert.strictEqual(request.interactionMode, "debug");
      assert.strictEqual(starts, 0, "V2 must reuse the session prepared by Ronin");
      if (scenario === "failed-start") {
        const activity = yield* domainEvents.pipe(
          Stream.filter(
            (event) =>
              event.type === "thread.activity-appended" &&
              event.payload.activity.kind === "provider.turn.start.failed",
          ),
          Stream.runHead,
        );
        assert.isTrue(Option.isSome(activity));
        const projection = yield* v2.getThreadProjection(threadId);
        assert.equal(projection.runs[0]?.status, "failed");
        const current = yield* shells.getThreadDetailById(threadId);
        assert.isTrue(Option.isSome(current));
        assert.equal(
          (yield* sql`SELECT * FROM projection_turns WHERE thread_id = ${threadId} AND turn_id IS NULL AND state = 'pending'`)
            .length,
          0,
        );
        return;
      }
      const base = {
        provider: driver,
        providerInstanceId: instanceId,
        threadId,
        turnId,
        createdAt: now,
      };
      yield* PubSub.publish(
        source,
        decodeEvent({ ...base, eventId: "started", type: "turn.started", payload: {} }),
      );
      yield* awaitEvent(
        (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
      );
      if (scenario === "automatic-completion") {
        const current = yield* v2.getThreadProjection(threadId);
        const run = current.runs.find((candidate) => candidate.status === "running")!;
        const taskId = NodeId.make("automatic-task");
        const completionMessageId = MessageId.make("automatic-result");
        const occurredAt = yield* DateTime.now;
        yield* sink.write({
          events: [
            {
              id: EventId.make("completion-cohort"),
              type: "run.updated",
              threadId,
              runId: run.id,
              occurredAt,
              payload: {
                ...run,
                delegatedCompletion: {
                  disposition: "open",
                  nextGeneration: 2,
                  delivery: { generation: 1, messageId: completionMessageId, taskIds: [taskId] },
                },
              },
            },
            {
              id: EventId.make("completed-task"),
              type: "subagent.updated",
              threadId,
              runId: run.id,
              nodeId: taskId,
              occurredAt,
              payload: {
                id: taskId,
                threadId,
                runId: run.id,
                parentNodeId: run.rootNodeId!,
                origin: "app_owned",
                createdBy: "agent",
                driver,
                providerInstanceId: instanceId,
                providerThreadId: null,
                childThreadId: null,
                nativeTaskRef: null,
                prompt: "Background work",
                title: "Completed background work",
                model: null,
                completionWake: "always",
                completionDelivery: { state: "claimed", observedByRunId: null },
                status: "completed",
                result: "done",
                startedAt: occurredAt,
                completedAt: occurredAt,
                updatedAt: occurredAt,
              },
            },
          ],
        });
        yield* v2.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("deliver-completion"),
          threadId,
          messageId: completionMessageId,
          text: "Background work completed",
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
          createdBy: "agent",
          creationSource: "server",
          delegatedCompletion: { parentRunId: run.id, generation: 1, taskIds: [taskId] },
        });
        const worker = yield* OrchestrationEffectWorkerV2;
        yield* worker.drain();
        const after = yield* v2.getThreadProjection(threadId);
        assert.equal(after.runs.find((candidate) => candidate.id === run.id)?.status, "running");
        assert.equal(
          after.runs.find((candidate) => candidate.userMessageId === completionMessageId)?.status,
          "queued",
        );
        assert.equal(
          yield* Queue.size(sent),
          0,
          "automatic completions must not steer Claude while tools run",
        );
        assert.equal(yield* Queue.size(interrupted), 0);
        return;
      }
      if (scenario === "steer") {
        const followup = MessageId.make("followup");
        yield* legacy.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("followup"),
          threadId,
          runtimeMode: "auto-accept-edits",
          interactionMode: "debug",
          message: { messageId: followup, role: "user", text: "Keep going", attachments: [] },
          createdAt: now,
        });
        yield* bridge.startTurn({
          threadId,
          commandId: CommandId.make("followup"),
          messageId: followup,
          request: {
            threadId,
            input: "Ronin skill instructions\nKeep going",
            interactionMode: "debug",
          },
        });
        assert.equal((yield* Queue.take(sent)).input, "Ronin skill instructions\nKeep going");
      }
      yield* PubSub.publish(
        source,
        decodeEvent({
          ...base,
          eventId: "approval",
          requestId: "approve-1",
          type: "request.opened",
          payload: { requestType: "command_execution_approval", detail: "Run the command?" },
        }),
      );
      yield* awaitEvent(
        (event) =>
          event.type === "runtime-request.updated" &&
          event.payload.id === "approve-1" &&
          event.payload.status === "pending",
      );
      yield* PubSub.publish(
        source,
        decodeEvent({
          ...base,
          eventId: "approval-done",
          requestId: "approve-1",
          type: "request.resolved",
          payload: { requestType: "command_execution_approval", decision: "accept" },
        }),
      );
      yield* PubSub.publish(
        source,
        decodeEvent({
          ...base,
          eventId: "question",
          requestId: "question-1",
          type: "user-input.requested",
          payload: {
            questions: [
              {
                id: "q",
                header: "Mode",
                question: "Choose a mode",
                options: [{ label: "Default", description: "" }],
                multiSelect: false,
              },
            ],
          },
        }),
      );
      yield* awaitEvent(
        (event) =>
          event.type === "runtime-request.updated" &&
          event.payload.id === "question-1" &&
          event.payload.status === "pending",
      );
      yield* PubSub.publish(
        source,
        decodeEvent({
          ...base,
          eventId: "question-done",
          requestId: "question-1",
          type: "user-input.resolved",
          payload: { answers: { q: ["Default"] } },
        }),
      );
      if (
        scenario === "background" ||
        scenario === "background-exit" ||
        scenario === "failed-background-stop" ||
        scenario === "native-wake"
      ) {
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...base,
            eventId: "task",
            type: "task.started",
            payload: { taskId: "task-1", title: "Ronin background task" },
          }),
        );
        yield* awaitEvent(
          (event) => event.type === "subagent.updated" && event.payload.status === "running",
        );
      }
      yield* PubSub.publish(
        source,
        decodeEvent({
          ...base,
          eventId: "delta",
          itemId: "assistant",
          type: "content.delta",
          payload: { streamKind: "assistant_text", delta: "Done" },
        }),
      );
      if (scenario === "interrupt") {
        assert.isTrue(yield* bridge.interrupt(threadId, CommandId.make("interrupt")));
        assert.equal(yield* Queue.take(interrupted), threadId);
      }
      yield* PubSub.publish(
        source,
        decodeEvent({
          ...base,
          eventId: "completed",
          type: "turn.completed",
          payload: { state: scenario === "interrupt" ? "interrupted" : "completed" },
        }),
      );
      yield* Deferred.await(checkpointDone);
      yield* checkpointReactor.drain;
      assert.equal(
        captures.filter(
          (ref) => ref === checkpointRefForThreadTurn(threadId, scenario === "history" ? 6 : 1),
        ).length,
        1,
        "V2 and the existing checkpoint reactor must capture a turn only once",
      );
      const projection = yield* v2.getThreadProjection(threadId);
      assert.strictEqual(
        projection.runs.at(-1)?.status,
        scenario === "interrupt" ? "interrupted" : "completed",
      );
      assert.strictEqual(
        projection.messages.findLast((message) => message.role === "assistant")?.text,
        "Done",
      );
      assert.equal(
        projection.messages.find((message) => message.id === messageId)?.text,
        "Implement it",
        "V2 history stores the original prompt separately from injected instructions",
      );
      assert.isTrue(projection.runtimeRequests.every((request) => request.status === "resolved"));
      assert.strictEqual(projection.thread.interactionMode, "debug");
      if (
        scenario === "background" ||
        scenario === "background-exit" ||
        scenario === "failed-background-stop" ||
        scenario === "native-wake"
      ) {
        assert.equal(
          projection.subagents[0]?.status,
          "running",
          "Background work can outlive its root turn",
        );
        if (scenario === "failed-background-stop") {
          yield* bridge.startTurn({
            threadId,
            commandId: CommandId.make("failed-follow-up"),
            messageId: MessageId.make("failed-follow-up-message"),
            request: { threadId, input: "Follow up", attachments: [], modelSelection },
          });
          yield* Queue.take(sent);
          yield* domainEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "thread.activity-appended" &&
                event.payload.activity.kind === "provider.turn.start.failed",
            ),
            Stream.runHead,
          );
          const worker = yield* OrchestrationEffectWorkerV2;
          yield* worker.drain();
          const failed = yield* v2.getThreadProjection(threadId);
          const latestRun = failed.runs.at(-1)!;
          assert.equal(latestRun.status, "failed");
          assert.equal(
            failed.providerTurns.length,
            1,
            "A rejected follow-up must not create a native turn",
          );
          yield* v2.dispatch({
            type: "run.interrupt",
            commandId: CommandId.make("stop-earlier-background"),
            threadId,
            runId: latestRun.id,
          });
          assert.equal(yield* Queue.take(interrupted), threadId);
          yield* worker.drain();
          const stopped = yield* v2.getThreadProjection(threadId);
          assert.equal(
            stopped.turnItems.find((item) => item.type === "subagent")?.status,
            "interrupted",
            "Stop clears background work owned by the earlier accepted turn",
          );
          return;
        }
        if (scenario === "native-wake") {
          const wake = { ...base, turnId: TurnId.make("native-wake") };
          yield* PubSub.publish(
            source,
            decodeEvent({ ...wake, eventId: "wake-start", type: "turn.started", payload: {} }),
          );
          yield* domainEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "thread.session-set" &&
                event.payload.session.activeTurnId === wake.turnId &&
                event.payload.session.status === "running",
            ),
            Stream.runHead,
          );
          yield* PubSub.publish(
            source,
            decodeEvent({
              ...wake,
              eventId: "wake-text",
              itemId: "wake-assistant",
              type: "content.delta",
              payload: { streamKind: "assistant_text", delta: "Background notification" },
            }),
          );
          yield* PubSub.publish(
            source,
            decodeEvent({
              ...wake,
              eventId: "wake-end",
              type: "turn.completed",
              payload: { state: "completed" },
            }),
          );
          yield* domainEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "thread.message-sent" &&
                event.payload.turnId === wake.turnId &&
                !event.payload.streaming,
            ),
            Stream.runHead,
          );
          assert.isFalse(yield* bridge.ownsTurn(threadId, wake.turnId));
          assert.equal((yield* v2.getThreadProjection(threadId)).providerTurns.length, 1);
        }
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...base,
            eventId: "task-end",
            type: scenario !== "background-exit" ? "task.completed" : "session.exited",
            payload:
              scenario !== "background-exit"
                ? { taskId: "task-1", status: "completed", summary: "Background result" }
                : { reason: "Provider exited" },
          }),
        );
        yield* awaitEvent(
          (event) =>
            event.type === "subagent.updated" &&
            event.payload.status === (scenario !== "background-exit" ? "completed" : "cancelled"),
        );
        const completed = yield* v2.getThreadProjection(threadId);
        assert.equal(
          completed.subagents[0]?.status,
          scenario !== "background-exit" ? "completed" : "cancelled",
        );
      }
      yield* ingestion.drain;
      yield* checkpointReactor.drain;
      const shell = yield* shells.getThreadDetailById(threadId);
      assert.isTrue(Option.isSome(shell));
      if (Option.isSome(shell)) {
        assert.strictEqual(shell.value.comparisonGroupId, "comparison-1");
        assert.isNull(
          shell.value.queuedPrompt,
          "Ronin consumes its queued prompt when the turn starts",
        );
        assert.strictEqual(shell.value.sideChat?.parentThreadId, "parent");
        assert.strictEqual(
          shell.value.checkpoints.find(
            (checkpoint) =>
              checkpoint.turnId === (scenario === "native-wake" ? "native-wake" : turnId),
          )?.checkpointRef,
          checkpointRefForThreadTurn(
            threadId,
            scenario === "history" ? 6 : scenario === "native-wake" ? 2 : 1,
          ),
        );
        assert.equal(
          shell.value.messages.findLast(
            (message) => message.role === "assistant" && message.turnId === turnId,
          )?.text,
          "Done",
        );
      }
      if (scenario === "revert") {
        yield* legacy.dispatch({
          type: "thread.revert.complete",
          commandId: CommandId.make("revert"),
          threadId,
          turnCount: 0,
          createdAt: "2026-10-04T00:00:01.000Z",
        });
        checkpoints.delete(checkpointRefForThreadTurn(threadId, 1));
        yield* awaitEvent(
          (event) => event.type === "run.updated" && event.payload.status === "rolled_back",
        );
        const nextMessage = MessageId.make("after-restore");
        const nextTurn = TurnId.make("after-restore-turn");
        const nextTime = "2026-10-04T00:00:02.000Z";
        yield* legacy.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("after-restore"),
          threadId,
          runtimeMode: "auto-accept-edits",
          interactionMode: "debug",
          message: {
            messageId: nextMessage,
            role: "user",
            text: "Continue after restore",
            attachments: [],
          },
          createdAt: nextTime,
        });
        const nextCheckpoint = yield* Deferred.make<void>();
        yield* Stream.runForEach(receipts.streamEventsForTest, (receipt) =>
          receipt.type === "checkpoint.diff.finalized" && receipt.turnId === nextTurn
            ? Deferred.succeed(nextCheckpoint, undefined)
            : Effect.void,
        ).pipe(Effect.forkScoped);
        yield* bridge.startTurn({
          threadId,
          commandId: CommandId.make("after-restore"),
          messageId: nextMessage,
          request: {
            threadId,
            input: "Continue after restore",
            modelSelection,
            interactionMode: "debug",
          },
        });
        assert.equal((yield* Queue.take(sent)).input, "Continue after restore");
        const nextBase = { ...base, turnId: nextTurn, createdAt: nextTime };
        yield* PubSub.publish(
          source,
          decodeEvent({ ...nextBase, eventId: "restore-start", type: "turn.started", payload: {} }),
        );
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...nextBase,
            eventId: "restore-text",
            itemId: "restore-assistant",
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "After restore" },
          }),
        );
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...nextBase,
            eventId: "restore-done",
            type: "turn.completed",
            payload: { state: "completed" },
          }),
        );
        yield* Deferred.await(nextCheckpoint);
        const restored = yield* v2.getThreadProjection(threadId);
        assert.deepEqual(
          restored.runs.map((run) => run.status),
          ["rolled_back", "completed"],
        );
        const current = yield* shells.getThreadDetailById(threadId);
        assert.isTrue(Option.isSome(current));
        if (Option.isSome(current)) {
          assert.equal(current.value.checkpoints[0]?.checkpointTurnCount, 1);
          assert.isFalse(current.value.messages.some((message) => message.id === messageId));
        }
      }
      if (scenario === "delete-project") {
        yield* legacy.dispatch({
          type: "project.delete",
          commandId: CommandId.make("delete-project"),
          projectId,
          force: true,
        });
        yield* awaitEvent((event) => event.type === "thread.deleted");
        assert.isNull(yield* v2.getThreadShell(threadId));
        assert.isTrue(Option.isNone(yield* shells.getThreadShellById(threadId)));
      }
      const logged = yield* sql<{
        readonly application_event_version: number;
      }>`SELECT DISTINCT application_event_version FROM orchestration_events ORDER BY application_event_version`;
      assert.deepEqual(
        logged.map((row) => row.application_event_version),
        [1, 2],
      );
      yield* bridge.detach(threadId);
      assert.strictEqual(yield* Queue.take(stopped), threadId);
    }).pipe(Effect.provide(runtime));
  }).pipe(Effect.scoped);

for (const driver of drivers)
  it.effect(`runs ${driver} through V2 while retaining Ronin's client and prepared prompt`, () =>
    testBridge(driver),
  );
it.effect("retains prepared skill instructions when steering an active Claude turn", () =>
  testBridge("claudeAgent", "steer"),
);
it.effect("continues ingesting background tasks after checkpointing the root turn", () =>
  testBridge("claudeAgent", "background"),
);
it.effect("cancels background tasks when their provider exits", () =>
  testBridge("claudeAgent", "background-exit"),
);
it.effect(
  "Stop reaches earlier background work after a follow-up fails before provider start",
  () => testBridge("claudeAgent", "failed-background-stop"),
);
it.effect("retains native background wake turns and their Ronin checkpoint ownership", () =>
  testBridge("claudeAgent", "native-wake"),
);
it.effect("reports a V2 start failure and clears Ronin's pending turn", () =>
  testBridge("codex", "failed-start"),
);
it.effect("retains existing transcripts and checkpoint numbering", () =>
  testBridge("codex", "history"),
);
it.effect("interrupts a V2 turn through Ronin and captures its checkpoint", () =>
  testBridge("codex", "interrupt"),
);
it.effect("restores the current Ronin conversation and restarts checkpoint numbering", () =>
  testBridge("codex", "revert"),
);
it.effect("deletes V2 sessions and threads when a Ronin project is deleted", () =>
  testBridge("codex", "delete-project"),
);

it.effect(
  "queues automatic completion messages while Claude is running without interrupting tools",
  () => testBridge("claudeAgent", "automatic-completion"),
);

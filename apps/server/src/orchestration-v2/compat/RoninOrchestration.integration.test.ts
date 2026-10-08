import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import {
  CommandId,
  EnvironmentId,
  EventId,
  NodeId,
  MessageId,
  RunAttemptId,
  RunId,
  ProviderThreadId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  ThreadId,
  TurnId,
  TurnItemId,
  SecretRef,
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
import * as TestClock from "effect/testing/TestClock";
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
import { ProviderSessionManagerV2 } from "../ProviderSessionManager.ts";
import { EventSinkV2 } from "../EventSink.ts";
import { OrchestratorV2 } from "../Orchestrator.ts";
import { ProviderAdapterRegistryV2 } from "../ProviderAdapterRegistry.ts";
import { layerWithAdapters } from "../runtimeLayer.ts";
import { makeLegacyProviderAdapterV2 } from "./LegacyProviderAdapter.ts";
import { PreparedTurnRequests } from "./PreparedTurnRequests.ts";
import * as RoninOrchestration from "./RoninOrchestration.ts";
import { SecretsToolkit } from "../../mcp/toolkits/secrets/tools.ts";
import { SecretsToolkitHandlersLive } from "../../mcp/toolkits/secrets/handlers.ts";
import { SecretRequests } from "../../secrets/SecretRequests.ts";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { HtmlRenderToolkit } from "../../mcp/toolkits/html/tools.ts";
import { HtmlRenderToolkitHandlersLive } from "../../mcp/toolkits/html/handlers.ts";
import { HtmlRender } from "../../htmlRender/HtmlRender.ts";
import { createAttachmentId } from "../../attachmentStore.ts";
import { ProjectionStoreV2 } from "../ProjectionStore.ts";
import * as Fiber from "effect/Fiber";

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
const encodeJsonText = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const testBridge = (
  driverName: (typeof drivers)[number],
  scenario:
    | "queue-follow-up"
    | "automatic-completion"
    | "goal"
    | "goal-stop"
    | "goal-timeout"
    | "goal-control"
    | "secret"
    | "secret-stop"
    | "secret-timeout"
    | "html"
    | "basic"
    | "steer"
    | "background"
    | "background-exit"
    | "failed-background-stop"
    | "queued-background-stop"
    | "native-wake"
    | "failed-start"
    | "history"
    | "stalled-return"
    | "stalled-terminal"
    | "stalled-missing"
    | "stalled-missing-terminal"
    | "stalled-superseded"
    | "stalled-restart"
    | "stalled-starting-background"
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
    const turnId = TurnId.make(
      scenario === "goal-control" ? "goal-command:test-control" : "native-turn",
    );
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
      if (scenario === "queue-follow-up") {
        yield* bridge.startTurn({
          threadId,
          commandId: CommandId.make("queued-follow-up"),
          messageId: MessageId.make("queued-follow-up"),
          dispatchMode: "queue",
          request: { threadId, input: "After compaction", attachments: [], modelSelection },
        });
        yield* (yield* OrchestrationEffectWorkerV2).drain();
        assert.equal(sends, 1);
        assert.equal((yield* v2.getThreadProjection(threadId)).runs.at(-1)?.status, "queued");
        yield* PubSub.publish(
          source,
          decodeEvent({ ...base, eventId: "compact-started", type: "turn.started", payload: {} }),
        );
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...base,
            eventId: "compact-done",
            type: "turn.completed",
            payload: { state: "completed" },
          }),
        );
        assert.equal((yield* Queue.take(sent)).input, "After compaction");
        assert.equal(sends, 2);
        return;
      }
      yield* PubSub.publish(
        source,
        decodeEvent({
          ...base,
          eventId: "started",
          type: "turn.started",
          payload: scenario === "goal-control" ? { native: false } : {},
        }),
      );
      yield* awaitEvent(
        (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
      );
      if (scenario === "html") {
        const reference = {
          attachmentId: createAttachmentId(threadId, "html")!,
          title: "Revenue",
          height: 420,
          fitContent: true,
        };
        const renderer = Layer.mock(HtmlRender)({ publish: () => Effect.succeed(reference) });
        const toolkit = yield* HtmlRenderToolkit.pipe(
          Effect.provide(HtmlRenderToolkitHandlersLive),
        );
        const response = yield* toolkit
          .handle("html_render", {
            html: "<p>Private page bytes</p>",
            title: "Revenue",
          })
          .pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.provide(renderer),
            Effect.provideService(McpInvocationContext, {
              environmentId: EnvironmentId.make("test-environment"),
              threadId,
              providerSessionId: "test-session",
              providerInstanceId: instanceId,
              capabilities: new Set(["html"] as const),
              issuedAt: 0,
            }),
          );
        assert.deepEqual(response.at(-1)?.result, {
          htmlRender: reference,
          message:
            "Shown to the reader above your reply. Reply with only what the page does not already say.",
        });
        const card = yield* domainEvents.pipe(
          Stream.filter(
            (event) =>
              event.type === "thread.activity-appended" &&
              event.payload.activity.kind === "html-render.published",
          ),
          Stream.runHead,
        );
        assert.isTrue(Option.isSome(card));
        const projection = yield* v2.getThreadProjection(threadId);
        const rendered = projection.turnItems.find(
          (item) => item.type === "dynamic_tool" && item.toolName === "html_render",
        );
        assert.isTrue(rendered?.type === "dynamic_tool");
        if (rendered?.type === "dynamic_tool") {
          assert.equal(rendered.input, null);
          assert.deepEqual(rendered.output, { htmlRender: reference });
        }
        const store = yield* ProjectionStoreV2;
        assert.deepEqual(yield* store.getThreadAttachmentIds(threadId), [reference.attachmentId]);
        const current = yield* shells.getThreadDetailById(threadId);
        assert.isTrue(Option.isSome(current));
        if (Option.isSome(current)) {
          const cards = current.value.activities.filter(
            (item) => item.kind === "html-render.published",
          );
          assert.equal(cards.length, 1);
          assert.deepEqual(cards[0]?.payload, { htmlRender: reference });
          assert.isFalse((yield* encodeJsonText(cards)).includes("Private page bytes"));
        }
        const run = projection.runs.find((run) => run.status === "running")!;
        const denied = yield* v2
          .dispatch({
            type: "html_render.record",
            commandId: CommandId.make("wrong-html-owner"),
            threadId,
            runId: run.id,
            nodeId: run.rootNodeId!,
            providerInstanceId: ProviderInstanceId.make("another-provider"),
            turnItemId: TurnItemId.make("unowned-page"),
            htmlRender: reference,
          })
          .pipe(Effect.flip);
        assert.equal(denied._tag, "OrchestratorDispatchError");
        yield* v2.dispatch({
          type: "run.interrupt",
          commandId: CommandId.make("stop-html"),
          threadId,
          runId: run.id,
        });
        const stopped = yield* v2
          .dispatch({
            type: "html_render.record",
            commandId: CommandId.make("stopped-html-owner"),
            threadId,
            runId: run.id,
            nodeId: run.rootNodeId!,
            providerInstanceId: instanceId,
            turnItemId: TurnItemId.make("stopped-page"),
            htmlRender: reference,
          })
          .pipe(Effect.flip);
        assert.equal(stopped._tag, "OrchestratorDispatchError");
        return;
      }
      if (scenario === "secret" || scenario === "secret-stop" || scenario === "secret-timeout") {
        const current = yield* v2.getThreadProjection(threadId);
        const run = current.runs.find((candidate) => candidate.status === "running")!;
        const turnItemId = TurnItemId.make(
          `turn-item:secret-request:${encodeURIComponent(threadId)}:private-card`,
        );
        const secretRef = SecretRef.make("secret-ref:0123456789abcdef0123456789abcdef");
        const secretStore = Layer.mock(SecretRequests)({
          savedRef: () => Effect.succeed(Option.some(secretRef)),
        });
        const toolkit = yield* SecretsToolkit.pipe(
          Effect.provide(
            SecretsToolkitHandlersLive.pipe(
              Layer.provide(secretStore),
              Layer.provide(NodeCrypto.layer),
            ),
          ),
        );
        const response = yield* toolkit
          .handle("request_secret", {
            label: "Signing secret",
            reason: "Authenticate webhook deliveries",
            clientRequestId: "private-card",
            timeoutMs: 1000,
          })
          .pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.provide(secretStore),
            Effect.provideService(McpInvocationContext, {
              environmentId: EnvironmentId.make("test-environment"),
              threadId,
              providerSessionId: "test-session",
              providerInstanceId: instanceId,
              capabilities: new Set(["secrets"] as const),
              issuedAt: 0,
            }),
            Effect.forkChild,
          );
        const awaitSecretActivity = (status: string) =>
          domainEvents.pipe(
            Stream.filter(
              (event) =>
                event.type === "thread.activity-appended" &&
                event.payload.activity.kind === "secret-request.updated" &&
                (event.payload.activity.payload as { secretStatus?: string }).secretStatus ===
                  status,
            ),
            Stream.runHead,
          );
        yield* awaitSecretActivity("pending");
        const waiting = yield* shells.getThreadShellById(threadId);
        assert.isTrue(Option.isSome(waiting) && waiting.value.hasPendingUserInput);
        const v2Waiting = yield* v2.getThreadShell(threadId);
        assert.equal(v2Waiting?.pendingRuntimeRequest?.kind, "user_input");
        if (scenario !== "secret") {
          if (scenario === "secret-timeout") {
            yield* TestClock.adjust("1 second");
          } else {
            yield* bridge.interrupt(threadId, CommandId.make("stop-private-request"));
            yield* Queue.take(interrupted);
            yield* PubSub.publish(
              source,
              decodeEvent({
                ...base,
                eventId: "secret-stop-completed",
                type: "turn.completed",
                payload: { state: "interrupted" },
              }),
            );
          }
          yield* awaitSecretActivity("cancelled");
          const result = yield* Fiber.join(response);
          assert.deepEqual(result.at(-1)?.result, {
            status: scenario === "secret-timeout" ? "timed_out" : "cancelled",
          });
          const closed = yield* shells.getThreadShellById(threadId);
          assert.isTrue(Option.isSome(closed) && !closed.value.hasPendingUserInput);
          return;
        }
        yield* v2.dispatch({
          type: "secret_request.record",
          commandId: CommandId.make("secret:answer"),
          threadId,
          runId: run.id,
          nodeId: run.rootNodeId!,
          turnItemId,
          label: "Signing secret",
          reason: "Authenticate webhook deliveries",
          secretStatus: "saved",
        });
        yield* awaitSecretActivity("saved");
        const results = yield* Fiber.join(response);
        assert.deepEqual(results.at(-1)?.result, { status: "saved", secretRef });
        const answered = yield* shells.getThreadDetailById(threadId);
        assert.isTrue(Option.isSome(answered));
        const cards = Option.getOrThrow(answered).activities.filter(
          (activity) => activity.kind === "secret-request.updated",
        );
        assert.equal(cards.length, 1, "status updates replace the same card");
        assert.equal((cards[0]!.payload as { secretStatus: string }).secretStatus, "saved");
        const settled = yield* shells.getThreadShellById(threadId);
        assert.isTrue(Option.isSome(settled) && !settled.value.hasPendingUserInput);
        assert.equal(
          yield* Queue.size(sent),
          0,
          "answering a private card must not submit a provider prompt",
        );
        return;
      }
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
      if (scenario === "goal" || scenario === "goal-stop" || scenario === "goal-timeout") {
        const goal = {
          objective: "Finish the native goal",
          status: "active" as const,
          tokensUsed: 500,
        };
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...base,
            eventId: "goal-active",
            type: "thread.goal.updated",
            payload: { goal },
          }),
        );
        yield* awaitEvent(
          (event) =>
            event.type === "provider-thread.updated" && event.payload.goal?.status === "active",
        );
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...base,
            eventId: "goal-first-output",
            itemId: "goal-first-output",
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "First goal step finished" },
          }),
        );
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...base,
            eventId: "first-done",
            type: "turn.completed",
            payload: { state: "completed" },
          }),
        );
        // A later provider receipt proves the completion and its timer were consumed.
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...base,
            eventId: "goal-progress",
            type: "thread.goal.updated",
            payload: { goal: { ...goal, tokensUsed: 501 } },
          }),
        );
        yield* awaitEvent(
          (event) =>
            event.type === "provider-thread.updated" && event.payload.goal?.tokensUsed === 501,
        );
        yield* ingestion.drain;
        const betweenTurns = yield* shells.getThreadShellById(threadId);
        assert.isTrue(Option.isSome(betweenTurns));
        if (Option.isSome(betweenTurns))
          assert.equal(betweenTurns.value.session?.status, "running");
        if (scenario !== "goal") {
          if (scenario === "goal-stop") {
            assert.isTrue(yield* bridge.interrupt(threadId, CommandId.make("stop-goal")));
            assert.equal(yield* Queue.take(interrupted), threadId);
          } else {
            yield* TestClock.adjust("5 seconds");
          }
          const finalStatus = scenario === "goal-stop" ? "interrupted" : "completed";
          yield* awaitEvent(
            (event) => event.type === "run.updated" && event.payload.status === finalStatus,
          );
          const settled = yield* v2.getThreadProjection(threadId);
          assert.equal(settled.runs[0]?.status, finalStatus);
          if (scenario === "goal-timeout") {
            yield* PubSub.publish(
              source,
              decodeEvent({
                ...base,
                turnId: "unowned-goal-turn",
                eventId: "late-goal-turn",
                type: "turn.started",
                payload: {},
              }),
            );
            assert.equal(
              yield* Queue.take(interrupted),
              threadId,
              "a late goal continuation must not run invisibly",
            );
          }
          return;
        }
        const nextBase = { ...base, turnId: TurnId.make("native-goal-continuation") };
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...nextBase,
            eventId: "second-started",
            type: "turn.started",
            payload: {},
          }),
        );
        yield* awaitEvent(
          (event) =>
            event.type === "provider-turn.updated" &&
            event.payload.nativeTurnRef?.nativeId === nextBase.turnId,
        );
        const running = yield* v2.getThreadProjection(threadId);
        assert.equal(running.runs.length, 1);
        assert.equal(running.runs[0]?.status, "running");
        const first = running.providerTurns.find(
          (turn) => turn.nativeTurnRef?.nativeId === turnId,
        )!;
        const second = running.providerTurns.find(
          (turn) => turn.nativeTurnRef?.nativeId === nextBase.turnId,
        )!;
        assert.equal(first.status, "completed");
        assert.equal(second.status, "running");
        assert.isAbove(second.ordinal, first.ordinal);
        assert.equal(second.runAttemptId, first.runAttemptId);
        assert.equal(
          running.messages.find((message) => message.text === "First goal step finished")
            ?.streaming,
          false,
        );
        yield* ingestion.drain;
        const activeShell = yield* shells.getThreadShellById(threadId);
        assert.isTrue(Option.isSome(activeShell));
        if (Option.isSome(activeShell))
          assert.deepEqual(activeShell.value.session?.goal, { ...goal, tokensUsed: 501 });
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...nextBase,
            eventId: "goal-complete",
            type: "thread.goal.updated",
            payload: { goal: { ...goal, status: "complete" } },
          }),
        );
        yield* PubSub.publish(
          source,
          decodeEvent({
            ...nextBase,
            eventId: "second-done",
            type: "turn.completed",
            payload: { state: "completed" },
          }),
        );
        yield* awaitEvent(
          (event) => event.type === "run.updated" && event.payload.status === "completed",
        );
        yield* ingestion.drain;
        const done = yield* v2.getThreadProjection(threadId);
        assert.equal(done.runs.length, 1);
        assert.equal(done.runs[0]?.status, "completed");
        const finishedShell = yield* shells.getThreadShellById(threadId);
        assert.isTrue(Option.isSome(finishedShell));
        if (Option.isSome(finishedShell))
          assert.equal(finishedShell.value.session?.goal?.status, "complete");
        yield* Deferred.await(checkpointDone);
        yield* checkpointReactor.drain;
        assert.equal(
          captures.filter((ref) => ref === checkpointRefForThreadTurn(threadId, 1)).length,
          1,
        );
        assert.equal(yield* bridge.nativeRollbackCount(threadId, [nextBase.turnId]), 2);
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
      if (scenario.startsWith("stalled-")) {
        const before = yield* v2.getThreadProjection(threadId);
        const run = before.runs.at(-1)!;
        const attempt = before.attempts.find((row) => row.id === run.activeAttemptId)!;
        const node = before.nodes.find((row) => row.id === run.rootNodeId)!;
        const turn = before.providerTurns.at(-1)!;
        const at = yield* DateTime.now;
        if (scenario === "stalled-starting-background") {
          const startingRunId = RunId.make("starting-after-switch");
          const startingNodeId = NodeId.make("starting-after-switch-root");
          const startingAttemptId = RunAttemptId.make("starting-after-switch-attempt");
          const startingProviderId = ProviderThreadId.make("starting-after-switch-provider");
          const oldProvider = before.providerThreads.find(
            (row) => row.id === turn.providerThreadId,
          )!;
          yield* sink.write({
            events: [
              {
                id: EventId.make("old-run-completed"),
                type: "run.updated",
                threadId,
                occurredAt: at,
                payload: { ...run, status: "completed", completedAt: at },
              },
              {
                id: EventId.make("old-turn-completed"),
                type: "provider-turn.updated",
                threadId,
                occurredAt: at,
                payload: { ...turn, status: "completed", completedAt: at },
              },
              {
                id: EventId.make("new-provider"),
                type: "provider-thread.updated",
                threadId,
                occurredAt: at,
                payload: {
                  ...oldProvider,
                  id: startingProviderId,
                  providerSessionId: null,
                  status: "idle",
                  lastRunOrdinal: run.ordinal + 1,
                },
              },
              {
                id: EventId.make("new-root"),
                type: "node.updated",
                threadId,
                occurredAt: at,
                payload: {
                  ...node,
                  id: startingNodeId,
                  runId: startingRunId,
                  providerThreadId: startingProviderId,
                  status: "pending",
                },
              },
              {
                id: EventId.make("new-attempt"),
                type: "run-attempt.updated",
                threadId,
                occurredAt: at,
                payload: {
                  ...attempt,
                  id: startingAttemptId,
                  runId: startingRunId,
                  status: "pending",
                },
              },
              {
                id: EventId.make("new-run-starting"),
                type: "run.updated",
                threadId,
                occurredAt: at,
                payload: {
                  ...run,
                  id: startingRunId,
                  rootNodeId: startingNodeId,
                  activeAttemptId: startingAttemptId,
                  providerThreadId: startingProviderId,
                  ordinal: run.ordinal + 1,
                  status: "starting",
                },
              },
              {
                id: EventId.make("old-background"),
                type: "turn-item.updated",
                threadId,
                occurredAt: at,
                payload: {
                  id: TurnItemId.make("old-background"),
                  threadId,
                  runId: run.id,
                  nodeId: node.id,
                  providerThreadId: turn.providerThreadId,
                  providerTurnId: turn.id,
                  nativeItemRef: null,
                  parentItemId: null,
                  ordinal: 100,
                  status: "running",
                  title: "Old provider server",
                  startedAt: at,
                  completedAt: null,
                  updatedAt: at,
                  type: "dynamic_tool",
                  toolName: "background-server",
                  input: null,
                },
              },
            ],
          });
          yield* v2.dispatch({
            type: "run.interrupt",
            commandId: CommandId.make("stop-new-starting"),
            threadId,
            runId: startingRunId,
            holdQueue: true,
          });
          yield* (yield* OrchestrationEffectWorkerV2).drain();
          assert.equal(yield* Queue.take(interrupted), threadId);
          const stopped = yield* v2.getThreadProjection(threadId);
          assert.equal(stopped.runs.find((row) => row.id === startingRunId)?.status, "interrupted");
          assert.equal(stopped.runs.find((row) => row.id === run.id)?.status, "completed");
          assert.equal(
            stopped.turnItems.find((row) => row.id === "old-background")?.status,
            "interrupted",
          );
          assert.equal(sends, 1);
          return;
        }
        if (scenario.startsWith("stalled-missing")) {
          yield* (yield* ProviderSessionManagerV2).release({
            providerSessionId: before.providerThreads.find(
              (row) => row.id === turn.providerThreadId,
            )!.providerSessionId!,
            reason: "runtime_error",
          });
          yield* awaitEvent(
            (event) => event.type === "run.updated" && event.payload.status === "failed",
          );
          // Reproduce terminal writes lost after the process died.
          yield* sink.write({
            events: [
              {
                id: EventId.make("stale-run"),
                type: "run.updated",
                threadId,
                occurredAt: at,
                payload: run,
              },
              {
                id: EventId.make("stale-attempt"),
                type: "run-attempt.updated",
                threadId,
                occurredAt: at,
                payload: attempt,
              },
              {
                id: EventId.make("stale-node"),
                type: "node.updated",
                threadId,
                occurredAt: at,
                payload: node,
              },
            ],
          });
        }
        const terminal = scenario.endsWith("terminal");
        const partialId = MessageId.make("stalled-partial");
        yield* sink.write({
          events: [
            ...(terminal
              ? [
                  {
                    id: EventId.make("native-terminal"),
                    type: "provider-turn.updated" as const,
                    threadId,
                    occurredAt: at,
                    payload: { ...turn, status: "completed" as const, completedAt: at },
                  },
                ]
              : []),
            {
              id: EventId.make("partial-message"),
              type: "message.updated",
              threadId,
              runId: run.id,
              occurredAt: at,
              payload: {
                id: partialId,
                threadId,
                runId: run.id,
                nodeId: node.id,
                role: "assistant",
                text: "Partial output",
                attachments: [],
                streaming: true,
                createdBy: "agent",
                creationSource: "provider",
                createdAt: at,
                updatedAt: at,
              },
            },
            {
              id: EventId.make("partial-item"),
              type: "turn-item.updated",
              threadId,
              runId: run.id,
              occurredAt: at,
              payload: {
                id: TurnItemId.make("stalled-output"),
                threadId,
                runId: run.id,
                nodeId: node.id,
                providerThreadId: turn.providerThreadId,
                providerTurnId: turn.id,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: 100,
                status: "running",
                title: null,
                startedAt: at,
                completedAt: null,
                updatedAt: at,
                type: "assistant_message",
                messageId: partialId,
                text: "Partial output",
                streaming: true,
              },
            },
          ],
        });
        const superseded = scenario === "stalled-superseded";
        if (superseded) {
          yield* sink.write({
            events: [
              {
                id: EventId.make("superseding-attempt"),
                type: "run.updated",
                threadId,
                occurredAt: at,
                payload: { ...run, activeAttemptId: RunAttemptId.make("new-attempt") },
              },
            ],
          });
        }
        yield* v2.dispatch(
          superseded
            ? {
                type: "thread.background-work.settle",
                commandId: CommandId.make("stale-stop-settle"),
                threadId,
                providerThreadId: turn.providerThreadId,
                providerTurnId: turn.id,
              }
            : {
                type: "run.interrupt",
                commandId: CommandId.make("stop-stalled"),
                threadId,
                runId: run.id,
              },
        );
        yield* (yield* OrchestrationEffectWorkerV2).drain();
        if (superseded) {
          const late = yield* sink.writeIfRunCurrent({
            threadId,
            runId: run.id,
            activeAttemptId: attempt.id,
            expectedStatus: run.status,
            events: [
              {
                id: EventId.make("late-terminal"),
                type: "run.updated",
                threadId,
                occurredAt: at,
                payload: { ...run, status: "completed" },
              },
            ],
            effects: [
              {
                id: "late-checkpoint",
                commandId: CommandId.make("late-checkpoint"),
                threadId,
                request: {
                  type: "checkpoint.capture",
                  runId: run.id,
                  scopeId: before.checkpointScopes[0]!.id,
                },
              },
            ],
          });
          assert.isFalse(late.committed);
          assert.deepEqual(late.storedEvents, []);
          const rows =
            yield* sql`SELECT effect_id FROM orchestration_v2_effect_outbox WHERE effect_id = 'late-checkpoint'`;
          assert.equal(rows.length, 0);
        }
        const after = yield* v2.getThreadProjection(threadId);
        assert.equal(after.runs.at(-1)?.status, superseded ? run.status : "interrupted");
        assert.equal(
          after.attempts.find((row) => row.id === attempt.id)?.status,
          superseded ? attempt.status : "interrupted",
        );
        assert.equal(
          after.providerTurns.find((row) => row.id === turn.id)?.status,
          terminal ? "completed" : superseded ? turn.status : "interrupted",
        );
        assert.equal(
          after.nodes.find((row) => row.id === node.id)?.status,
          superseded ? node.status : "interrupted",
        );
        assert.equal(after.messages.find((row) => row.id === partialId)?.streaming, superseded);
        assert.equal(after.messages.find((row) => row.id === partialId)?.text, "Partial output");
        assert.equal(
          after.runtimeRequests.find((row) => row.id === "question-1")?.status,
          superseded ? "pending" : "cancelled",
        );
        assert.equal(
          after.turnItems.filter((row) => row.type === "run_interrupt_result").length,
          superseded ? 0 : 1,
        );
        if (scenario === "stalled-restart") {
          yield* sink.write({
            events: [
              {
                id: EventId.make("restart-cut-run"),
                type: "run.updated",
                threadId,
                occurredAt: at,
                payload: { ...run, status: "cancelled", completedAt: at },
              },
            ],
          });
          yield* v2.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("late-restart-continuation"),
            threadId,
            messageId: MessageId.make("late-restart-message"),
            text: "Continue where you left off.",
            attachments: [],
            createdBy: "agent",
            creationSource: "server",
            dispatchMode: { type: "start_immediately" },
            restartContinuationOfRunId: run.id,
          });
          yield* (yield* OrchestrationEffectWorkerV2).drain();
          assert.equal((yield* v2.getThreadProjection(threadId)).runs.length, before.runs.length);
          assert.equal(sends, 1);
        }
        return;
      }
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
        scenario === "queued-background-stop" ||
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
          payload: {
            streamKind: "assistant_text",
            delta: scenario === "basic" ? "Done\n\n" : "Done",
          },
        }),
      );
      if (scenario === "basic") {
        yield* awaitEvent(
          (event) =>
            event.type === "turn-item.updated" &&
            event.payload.type === "assistant_message" &&
            event.payload.text === "Done\n\n",
        );
        assert.isFalse(
          (yield* v2.getThreadProjection(threadId)).messages.some(
            (message) => message.role === "assistant" && message.streaming,
          ),
        );
      }
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
          payload: {
            state: scenario === "interrupt" ? "interrupted" : "completed",
            ...(scenario === "goal-control" ? { native: false } : {}),
          },
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
      if (scenario === "goal-control") {
        assert.equal(projection.providerTurns[0]?.nativeTurnRef, null);
        assert.equal(yield* bridge.nativeRollbackCount(threadId, [turnId]), 0);
      }
      assert.strictEqual(
        projection.runs.at(-1)?.status,
        scenario === "interrupt" ? "interrupted" : "completed",
      );
      assert.strictEqual(
        projection.messages.findLast((message) => message.role === "assistant")?.text,
        scenario === "basic" ? "Done\n\n" : "Done",
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
        scenario === "queued-background-stop" ||
        scenario === "native-wake"
      ) {
        assert.equal(
          projection.subagents[0]?.status,
          "running",
          "Background work can outlive its root turn",
        );
        if (scenario === "queued-background-stop") {
          const owner = projection.runs.at(-1)!;
          const sink = yield* EventSinkV2;
          yield* sink.write({
            events: [
              {
                id: EventId.make("background-checkpoint-pending"),
                type: "run.updated",
                threadId,
                runId: owner.id,
                occurredAt: yield* DateTime.now,
                payload: { ...owner, status: "waiting", completedAt: null },
              },
            ],
          });
          yield* v2.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make("queue-background-follow-up"),
            threadId,
            messageId: MessageId.make("queued-background-message"),
            text: "Continue after the background work",
            attachments: [],
            dispatchMode: { type: "queue_after_active" },
            createdBy: "user",
            creationSource: "web",
          });
          assert.equal((yield* v2.getThreadProjection(threadId)).runs.at(-1)?.status, "queued");
          yield* v2.dispatch({
            type: "run.interrupt",
            commandId: CommandId.make("stop-with-background-queue"),
            threadId,
            runId: owner.id,
            holdQueue: true,
          });
          assert.equal(yield* Queue.take(interrupted), threadId);
          const worker = yield* OrchestrationEffectWorkerV2;
          yield* worker.drain();
          const after = yield* v2.getThreadProjection(threadId);
          assert.equal(after.runs.at(-1)?.status, "queued");
          assert.equal(after.runs.at(-1)?.queueHeld, true);
          assert.equal(
            after.turnItems.find((item) => item.type === "subagent")?.status,
            "interrupted",
          );
          assert.equal(sends, 1);
          return;
        }
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
          scenario === "basic" ? "Done\n\n" : "Done",
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
for (const driver of drivers)
  it.effect(`publishes an inline page through ${driver} with ownership and Stop checks`, () =>
    testBridge(driver, "html"),
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
it.effect("Stop holds a later queued message and still reaches native background work", () =>
  testBridge("claudeAgent", "queued-background-stop"),
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
it.effect(
  "keeps repeated native goal turns in one run and projects progress to Ronin's client",
  () => testBridge("codex", "goal"),
);
it.effect("Stop ends a goal while it waits between native turns", () =>
  testBridge("codex", "goal-stop"),
);
it.effect("settles a declined goal continuation and stops a late unowned native turn", () =>
  testBridge("codex", "goal-timeout"),
);
it.effect("checkpoints local goal controls without consuming native rollback turns", () =>
  testBridge("codex", "goal-control"),
);
it.effect("shows and answers a private secret card through Ronin without a provider prompt", () =>
  testBridge("codex", "secret"),
);
it.effect("Stop closes the private secret card and settles its MCP wait", () =>
  testBridge("codex", "secret-stop"),
);
it.effect("a private secret card timeout clears its needs-input badge", () =>
  testBridge("codex", "secret-timeout"),
);

it.effect.each([
  "stalled-return",
  "stalled-terminal",
  "stalled-missing",
  "stalled-missing-terminal",
  "stalled-superseded",
  "stalled-restart",
  "stalled-starting-background",
] as const)("Stop repairs %s through Ronin without changing a newer attempt", (scenario) =>
  testBridge("codex", scenario),
);

it.effect("queues a follow-up until the current turn ends even on a steering provider", () =>
  testBridge("codex", "queue-follow-up"),
);

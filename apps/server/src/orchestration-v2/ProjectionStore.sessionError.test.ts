import { assert, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderDriverKind,
  RunId,
  NodeId,
  MessageId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import { legacyProviderCapabilities } from "./compat/LegacyProviderCapabilities.ts";
const providerInstanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "test" };
const CodexProviderCapabilitiesV2 = legacyProviderCapabilities(driver, {
  sessionModelSwitch: "in-session",
});
function traceSqlStatements() {
  const statements: string[] = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        const query = span.attributes.get("db.query.text");
        if (typeof query === "string") statements.push(query);
      };
      return span;
    },
  });
  return { statements, tracer };
}
it.effect("looks up a thread's last provider error through its own session bindings", () =>
  Effect.gen(function* () {
    const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const later = DateTime.add(now, { minutes: 1 });
    const projectId = ProjectId.make("project:projection-session-error-lookup");
    const attachErroredSession = Effect.fnUntraced(function* (
      name: string,
      lastError: string,
      updatedAt: DateTime.Utc,
    ) {
      const threadId = ThreadId.make(`thread:projection-session-error-lookup:${name}`);
      yield* projectionStore.apply({
        id: EventId.make(`event:projection-session-error-lookup:${name}:thread`),
        type: "thread.created",
        threadId,
        occurredAt: now,
        payload: {
          createdBy: "user",
          creationSource: "web",
          id: threadId,
          projectId,
          title: name,
          providerInstanceId,
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        },
      });
      yield* projectionStore.apply({
        id: EventId.make(`event:projection-session-error-lookup:${name}:session`),
        type: "provider-session.attached",
        threadId,
        driver,
        providerInstanceId,
        occurredAt: updatedAt,
        payload: {
          id: ProviderSessionId.make(`provider-session:projection-session-error-lookup:${name}`),
          driver,
          providerInstanceId,
          status: "error",
          cwd: "/workspace",
          model: modelSelection.model,
          capabilities: CodexProviderCapabilitiesV2,
          createdAt: updatedAt,
          updatedAt,
          lastError,
        },
      });
      return threadId;
    });

    const failure = {
      class: "usage_limit" as const,
      message: "Plan limit reached.",
      resetAt: "2099-01-01T00:00:00.000Z",
      code: "usageLimitExceeded",
      retryable: null,
    };
    const threadId = yield* attachErroredSession("own", failure.message, now);
    // The own session repeats the root turn's limit, so the thread stays a
    // recovery candidate only while the lookup reads that session.
    const runId = RunId.make("run:projection-session-error-lookup:own");
    const rootNodeId = NodeId.make("node:projection-session-error-lookup:own");
    yield* projectionStore.apply({
      id: EventId.make("event:projection-session-error-lookup:own:run"),
      type: "run.created",
      threadId,
      runId,
      nodeId: rootNodeId,
      driver,
      providerInstanceId,
      occurredAt: now,
      payload: {
        id: runId,
        threadId,
        ordinal: 1,
        providerInstanceId,
        modelSelection,
        providerThreadId: null,
        userMessageId: MessageId.make("message:projection-session-error-lookup:own"),
        rootNodeId,
        activeAttemptId: null,
        status: "failed",
        requestedAt: now,
        startedAt: now,
        completedAt: now,
        checkpointId: null,
        contextHandoffId: null,
      },
    });
    yield* projectionStore.apply({
      id: EventId.make("event:projection-session-error-lookup:own:error"),
      type: "turn-item.updated",
      threadId,
      occurredAt: now,
      payload: {
        id: TurnItemId.make("projection-session-error-lookup:own:error"),
        threadId,
        runId,
        nodeId: rootNodeId,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 1,
        status: "failed",
        title: "Usage limit reached",
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        type: "error",
        failure,
      },
    });
    // Every thread on the provider instance has its own session, and these
    // are newer. They must neither leak into the thread nor be walked for it.
    for (let index = 0; index < 24; index++) {
      yield* attachErroredSession(`other-${index}`, "other session failed", later);
    }

    const { statements, tracer } = traceSqlStatements();
    const shell = yield* projectionStore.getShellSnapshot().pipe(Effect.withTracer(tracer));
    assert.equal(
      shell.threads.find((thread) => thread.id === threadId)?.lastError,
      failure.message,
    );
    const candidates = yield* projectionStore
      .getLimitRecoveryCandidates({ now, autoResume: true, snooze: false })
      .pipe(Effect.withTracer(tracer));
    // Another thread's newer error would replace the limit and drop the candidate.
    const candidate = candidates.find((row) => row.id === threadId);
    assert.isDefined(candidate);
    assert.include(candidate, {
      status: "failed",
      lastErrorClass: "usage_limit",
      usageLimitResetAt: failure.resetAt,
      latestRunId: runId,
    });

    // One provider instance usually holds most sessions. Driving the lookup
    // from sessions walks all of them for every thread in the snapshot.
    for (const marker of ["AS blocking_failure_payload_json", "AS failure_payload_json"]) {
      const statement = statements.find((query) => query.includes(marker));
      assert.isDefined(statement, marker);
      const plan = (yield* sql.unsafe<{ readonly detail: string }>(
        `EXPLAIN QUERY PLAN ${statement}`,
      )).map((row) => row.detail);
      const bindingLookup = plan.findIndex((detail) => detail.startsWith("SEARCH binding "));
      const sessionLookup = plan.findIndex((detail) => detail.startsWith("SEARCH session "));
      assert.isAtLeast(bindingLookup, 0, marker);
      assert.include(
        plan[bindingLookup],
        "orchestration_v2_projection_provider_session_bindings_thread_idx (thread_id=?)",
      );
      assert.isAbove(sessionLookup, bindingLookup, marker);
      assert.include(plan[sessionLookup], "(provider_session_id=?)");
    }
  }).pipe(Effect.provide(ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)))),
);

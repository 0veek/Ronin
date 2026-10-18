import { assert, it } from "@effect/vitest";
import { EventId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { OrchestrationV2ThreadShellSnapshot } from "@t3tools/contracts/orchestration-v2";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "test" };
it.layer(ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory)))(
  "shell read/decode",
  (it) => {
    it.effect("reads the shell snapshot first and decodes it in a separate step", () =>
      Effect.gen(function* () {
        const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
        const sql = yield* SqlClient.SqlClient;
        const now = yield* DateTime.now;
        const createThread = (threadId: ThreadId) =>
          projectionStore.apply({
            id: EventId.make(`event:${threadId}:created`),
            type: "thread.created",
            threadId,
            occurredAt: now,
            payload: {
              createdBy: "user",
              creationSource: "web",
              id: threadId,
              projectId: ProjectId.make("project:shell-read"),
              title: "Shell read",
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
        const readThreadId = ThreadId.make("thread:shell-read:before");
        const laterThreadId = ThreadId.make("thread:shell-read:after");
        const shellIds = (snapshot: OrchestrationV2ThreadShellSnapshot) =>
          snapshot.threads
            .map((thread) => thread.id)
            .filter((id) => id === readThreadId || id === laterThreadId);

        yield* createThread(readThreadId);
        const decode = yield* sql.withTransaction(projectionStore.readShellSnapshot());
        // Commits between the read and the decode, as another request can while
        // the HTTP and WebSocket loaders decode outside their transaction.
        yield* createThread(laterThreadId);

        assert.deepEqual(shellIds(yield* decode), [readThreadId]);
        assert.sameMembers(shellIds(yield* projectionStore.getShellSnapshot()), [
          readThreadId,
          laterThreadId,
        ]);

        // No decoding under the read transaction: a payload that cannot decode
        // fails the returned step, not the read.
        const [stored] = yield* sql<{ readonly payload_json: string }>`
        SELECT payload_json FROM orchestration_v2_projection_threads
        WHERE thread_id = ${laterThreadId}
      `;
        const setPayload = (payload: string) =>
          sql`UPDATE orchestration_v2_projection_threads SET payload_json = ${payload}
          WHERE thread_id = ${laterThreadId}`;
        yield* setPayload("{}");
        const failure = yield* sql
          .withTransaction(projectionStore.readShellSnapshot())
          .pipe(
            Effect.flatMap(Effect.flip),
            Effect.ensuring(Effect.orDie(setPayload(stored!.payload_json))),
          );
        assert.strictEqual(failure._tag, "ProjectionStoreReadError");
      }),
    );
  },
);

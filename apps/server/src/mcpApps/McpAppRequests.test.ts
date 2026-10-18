import { assert, describe, it } from "@effect/vitest";
import { EventId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionThreadActivityRepositoryLive } from "../persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadRepositoryLive } from "../persistence/Layers/ProjectionThreads.ts";
import { ProjectionThreadActivityRepository } from "../persistence/Services/ProjectionThreadActivities.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { ProviderSessionNotFoundError } from "../provider/Errors.ts";
import { makeMcpAppRequests } from "./McpAppRequests.ts";
import { makeMcpAppModelContext } from "./McpAppModelContext.ts";
import type { McpAppProviderRequest } from "./McpAppProvider.ts";

const threadId = ThreadId.make("app-thread");
const itemId = EventId.make("app-call");
const target = { threadId, itemId };
const app = {
  attachmentId: "app-thread-document-html",
  server: "weather",
  tool: "show",
  resourceUri: "ui://weather/app",
  nativeThreadId: "native-thread",
  providerInstanceId: "codex",
};
const result = { content: [{ type: "text", text: "original result" }] };
const layer = Layer.mergeAll(
  ProjectionThreadActivityRepositoryLive,
  ProjectionThreadRepositoryLive,
).pipe(Layer.provideMerge(SqlitePersistenceMemory));

const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projection_threads
    (thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode, created_at, updated_at)
    VALUES (${threadId}, 'project', 'App', '{"instanceId":"codex","model":"gpt-6"}',
      'full-access', 'default', '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z')`;
  const activities = yield* ProjectionThreadActivityRepository;
  yield* activities.upsert({
    activityId: itemId,
    threadId,
    turnId: null,
    tone: "tool",
    kind: "tool.completed",
    summary: "Weather",
    createdAt: "2026-10-07T00:00:00Z",
    payload: {
      data: {
        mcpApp: app,
        item: {
          type: "mcpToolCall",
          server: app.server,
          tool: app.tool,
          arguments: { city: "Pune" },
          result: { ...result, isError: null },
        },
      },
    },
  });
});

describe("McpAppRequests with the retained activity store", () => {
  it.effect("routes app requests only to their recorded server and refuses hidden tools", () =>
    Effect.gen(function* () {
      yield* seed;
      const calls: McpAppProviderRequest[] = [];
      const requests = yield* makeMcpAppRequests().pipe(
        Effect.provide(
          Layer.mock(ProviderService)({
            mcpAppRequest: (id, input) =>
              Effect.sync(() => {
                assert.equal(id, threadId);
                calls.push(input);
                return input.operation === "listTools"
                  ? {
                      data: [
                        {
                          name: "weather",
                          tools: {
                            refresh: { name: "refresh", annotations: { readOnlyHint: true } },
                            hidden: { name: "hidden", _meta: { ui: { visibility: ["model"] } } },
                          },
                        },
                      ],
                    }
                  : { ...result, isError: null };
              }),
          }),
        ),
      );
      assert.deepEqual(yield* requests.getCall(target), { arguments: { city: "Pune" }, result });
      assert.isTrue((yield* requests.toolInfo({ ...target, name: "refresh" })).readOnly);
      assert.deepEqual(
        yield* requests.callTool({ ...target, name: "refresh", arguments: { next: true } }),
        result,
      );
      assert.deepEqual(calls.at(-1), {
        operation: "callTool",
        nativeThreadId: "native-thread",
        providerInstanceId: "codex",
        server: "weather",
        tool: "refresh",
        arguments: { next: true },
      });
      const before = calls.filter((entry) => entry.operation === "callTool").length;
      for (const name of ["hidden", "unknown"]) {
        const failure = yield* requests
          .callTool({ ...target, name, arguments: {} })
          .pipe(Effect.flip);
        assert.equal(failure.reason, "tool-not-callable");
      }
      assert.equal(calls.filter((entry) => entry.operation === "callTool").length, before);
      const other = yield* requests
        .getCall({ ...target, threadId: ThreadId.make("unrelated") })
        .pipe(Effect.flip);
      assert.equal(other.reason, "not-an-app");
    }).pipe(Effect.provide(Layer.fresh(layer))),
  );

  it.effect("keeps a stopped app viewable and stores only its latest bounded context", () =>
    Effect.gen(function* () {
      yield* seed;
      let calls = 0;
      const requests = yield* makeMcpAppRequests().pipe(
        Effect.provide(
          Layer.mock(ProviderService)({
            mcpAppRequest: () => {
              calls++;
              return Effect.fail(new ProviderSessionNotFoundError({ threadId }));
            },
          }),
        ),
      );
      assert.deepEqual((yield* requests.getCall(target)).result, result);
      assert.equal(calls, 0);
      const base = { ...target, conversationThreadId: threadId };
      yield* requests.updateModelContext({
        ...base,
        content: [{ type: "text", text: "First filter" }],
      });
      yield* requests.updateModelContext({
        ...base,
        content: [{ type: "text", text: "  Latest filter  " }],
        structuredContent: { city: "Pune" },
      });
      const context = yield* makeMcpAppModelContext();
      assert.deepEqual(yield* context.forThread(threadId), [
        { key: "mcp_app_app-call", text: '  Latest filter  \n{"city":"Pune"}' },
      ]);
      const tooLarge = yield* requests
        .updateModelContext({ ...base, content: [{ type: "text", text: "表".repeat(6000) }] })
        .pipe(Effect.flip);
      assert.equal(tooLarge.reason, "request-failed");
      assert.equal(
        (yield* requests
          .updateModelContext({ ...base, content: [{ type: "image", data: "x" }] })
          .pipe(Effect.flip)).reason,
        "unsupported-content",
      );
      assert.equal(
        (yield* requests
          .updateModelContext({ ...base, conversationThreadId: ThreadId.make("other") })
          .pipe(Effect.flip)).reason,
        "not-an-app",
      );
      yield* requests.updateModelContext(base);
      assert.deepEqual(yield* context.forThread(threadId), []);
      yield* requests.updateModelContext({
        ...base,
        content: [{ type: "text", text: "Removed with its call" }],
      });
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DELETE FROM projection_thread_activities WHERE activity_id = ${itemId}`;
      assert.deepEqual(yield* context.forThread(threadId), []);
      assert.deepEqual(yield* sql`SELECT * FROM mcp_app_model_context`, []);
      assert.equal(calls, 0);
    }).pipe(Effect.provide(Layer.fresh(layer))),
  );
});

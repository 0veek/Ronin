import {
  McpAppRequestError,
  McpAppCallToolResult,
  McpAppReadResourceResult,
  type McpAppGetCallInput,
  type McpAppCallToolInput,
  type McpAppToolInfoInput,
  type McpAppReadResourceInput,
  type McpAppUpdateModelContextInput,
} from "@t3tools/contracts";
import { mcpAppToolCallableByApp, readMcpAppReference } from "@t3tools/shared/mcpApp";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { ProjectionThreadActivityRepository } from "../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { makeMcpAppModelContext, MCP_APP_MODEL_CONTEXT_MAX_BYTES } from "./McpAppModelContext.ts";
import type { McpAppProviderRequest } from "./McpAppProvider.ts";

const ToolsResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      tools: Schema.Record(
        Schema.String,
        Schema.Struct({
          name: Schema.String,
          _meta: Schema.optionalKey(Schema.Unknown),
          annotations: Schema.optionalKey(Schema.Unknown),
          title: Schema.optionalKey(Schema.String),
          description: Schema.optionalKey(Schema.String),
          inputSchema: Schema.optionalKey(Schema.Unknown),
        }),
      ),
    }),
  ),
});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isMcpAppRequestError = Schema.is(McpAppRequestError);
// Codex represents MCP's absent optional flag as null in native responses.
const decodeCallToolResult = (value: unknown) => {
  if (Predicate.isObject(value) && value.isError === null) {
    const result = { ...value };
    delete result.isError;
    return Schema.decodeUnknownEffect(McpAppCallToolResult)(result);
  }
  return Schema.decodeUnknownEffect(McpAppCallToolResult)(value);
};

/** Stored activity identity selects the server; clients cannot nominate another connection. */
export const makeMcpAppRequests = Effect.fn("makeMcpAppRequests")(function* () {
  const activities = yield* ProjectionThreadActivityRepository;
  const threads = yield* ProjectionThreadRepository;
  const provider = yield* ProviderService;
  const context = yield* makeMcpAppModelContext();
  const fail = (input: McpAppGetCallInput, reason: McpAppRequestError["reason"], cause?: unknown) =>
    new McpAppRequestError({
      threadId: input.threadId,
      reason,
      ...(cause === undefined ? {} : { cause }),
    });
  const resolve = Effect.fn("McpAppRequests.resolve")(function* (input: McpAppGetCallInput) {
    const activity = yield* activities
      .getById(input.itemId)
      .pipe(Effect.mapError((cause) => fail(input, "request-failed", cause)));
    const thread = yield* threads
      .getById({ threadId: input.threadId })
      .pipe(Effect.mapError((cause) => fail(input, "request-failed", cause)));
    if (
      Option.isNone(activity) ||
      activity.value.threadId !== input.threadId ||
      activity.value.kind !== "tool.completed" ||
      Option.isNone(thread) ||
      thread.value.deletedAt !== null
    ) {
      return yield* fail(input, "not-an-app");
    }
    const payload = activity.value.payload;
    const data =
      Predicate.isObject(payload) && Predicate.isObject(payload.data) ? payload.data : undefined;
    const app = data ? readMcpAppReference(data.mcpApp) : undefined;
    const item = Predicate.isObject(data?.item) ? data.item : undefined;
    if (
      !app ||
      item?.server !== app.server ||
      item?.tool !== app.tool ||
      !app.nativeThreadId ||
      !app.providerInstanceId
    ) {
      return yield* fail(input, "not-an-app");
    }
    return {
      app,
      item,
      nativeThreadId: app.nativeThreadId,
      providerInstanceId: app.providerInstanceId,
    };
  });
  const request = (
    input: McpAppGetCallInput,
    target: Awaited<Effect.Success<ReturnType<typeof resolve>>>,
    operation:
      | Omit<
          Extract<McpAppProviderRequest, { operation: "callTool" }>,
          "nativeThreadId" | "providerInstanceId" | "server"
        >
      | Omit<
          Extract<McpAppProviderRequest, { operation: "readResource" }>,
          "nativeThreadId" | "providerInstanceId" | "server"
        >
      | { readonly operation: "listTools" },
  ) =>
    provider
      .mcpAppRequest(input.threadId, {
        nativeThreadId: target.nativeThreadId,
        providerInstanceId: target.providerInstanceId,
        server: target.app.server,
        ...operation,
      })
      .pipe(
        Effect.mapError((cause) =>
          fail(
            input,
            cause._tag === "ProviderOperationUnsupportedError"
              ? "provider-unsupported"
              : cause._tag === "ProviderSessionNotFoundError"
                ? "session-stopped"
                : "request-failed",
            cause,
          ),
        ),
      );
  const tool = Effect.fn("McpAppRequests.tool")(function* (input: McpAppToolInfoInput) {
    const target = yield* resolve(input);
    const response = yield* request(input, target, { operation: "listTools" }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ToolsResponse)),
      Effect.mapError((cause) => fail(input, "request-failed", cause)),
    );
    return {
      target,
      definition: Object.values(
        response.data.find((entry) => entry.name === target.app.server)?.tools ?? {},
      ).find((entry) => entry.name === input.name),
    };
  });
  return {
    getCall: Effect.fn("McpAppRequests.getCall")(function* (input: McpAppGetCallInput) {
      const { item } = yield* resolve(input);
      const result = yield* decodeCallToolResult(item.result).pipe(
        Effect.mapError((cause) => fail(input, "request-failed", cause)),
      );
      return { arguments: item.arguments ?? {}, result };
    }),
    toolInfo: Effect.fn("McpAppRequests.toolInfo")(function* (input: McpAppToolInfoInput) {
      const { definition } = yield* tool(input);
      const annotations = Predicate.isObject(definition?.annotations)
        ? definition.annotations
        : undefined;
      return {
        callable: definition !== undefined && mcpAppToolCallableByApp(definition._meta),
        readOnly: annotations?.readOnlyHint === true,
        ...(typeof annotations?.title === "string" ? { title: annotations.title } : {}),
        ...(definition === undefined ? {} : { tool: definition }),
      };
    }),
    callTool: Effect.fn("McpAppRequests.callTool")(function* (input: McpAppCallToolInput) {
      const { target, definition } = yield* tool(input);
      if (!definition || !mcpAppToolCallableByApp(definition._meta))
        return yield* fail(input, "tool-not-callable");
      return yield* request(input, target, {
        operation: "callTool",
        tool: input.name,
        arguments: input.arguments,
      }).pipe(
        Effect.flatMap(decodeCallToolResult),
        Effect.mapError((cause) =>
          isMcpAppRequestError(cause) ? cause : fail(input, "request-failed", cause),
        ),
      );
    }),
    readResource: Effect.fn("McpAppRequests.readResource")(function* (
      input: McpAppReadResourceInput,
    ) {
      const target = yield* resolve(input);
      return yield* request(input, target, { operation: "readResource", uri: input.uri }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(McpAppReadResourceResult)),
        Effect.mapError((cause) =>
          isMcpAppRequestError(cause) ? cause : fail(input, "request-failed", cause),
        ),
      );
    }),
    updateModelContext: Effect.fn("McpAppRequests.updateModelContext")(function* (
      input: McpAppUpdateModelContextInput,
    ) {
      yield* resolve(input);
      // Retained forks do not inherit work-log activities. An app can inform only its own conversation.
      if (input.conversationThreadId !== input.threadId) return yield* fail(input, "not-an-app");
      const texts: string[] = [];
      for (const block of input.content ?? []) {
        if (!Predicate.isObject(block) || block.type !== "text" || typeof block.text !== "string") {
          return yield* fail(input, "unsupported-content");
        }
        texts.push(block.text);
      }
      if (input.structuredContent !== undefined) texts.push(encodeJson(input.structuredContent));
      const text = texts.join("\n");
      if (new TextEncoder().encode(text).byteLength > MCP_APP_MODEL_CONTEXT_MAX_BYTES) {
        return yield* fail(input, "request-failed", new Error("Model context is too large."));
      }
      yield* context
        .set({ threadId: input.threadId, activityId: input.itemId, text })
        .pipe(Effect.mapError((cause) => fail(input, "request-failed", cause)));
    }),
  };
});

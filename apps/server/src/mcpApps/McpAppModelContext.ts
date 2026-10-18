import type { EventId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const MCP_APP_MODEL_CONTEXT_MAX_BYTES = 16 * 1024;

/** Each app replaces its note. Deleted or rolled-back activities stop informing the agent. */
export const makeMcpAppModelContext = Effect.fn("makeMcpAppModelContext")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const set = Effect.fn("McpAppModelContext.set")(function* (input: {
    readonly threadId: ThreadId;
    readonly activityId: EventId;
    readonly text: string;
  }) {
    if (input.text.trim() === "") {
      yield* sql`DELETE FROM mcp_app_model_context
        WHERE thread_id = ${input.threadId} AND activity_id = ${input.activityId}`;
      return;
    }
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* sql`INSERT INTO mcp_app_model_context (thread_id, activity_id, text, updated_at)
      VALUES (${input.threadId}, ${input.activityId}, ${input.text}, ${now})
      ON CONFLICT(thread_id, activity_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`;
  });
  const forThread = Effect.fn("McpAppModelContext.forThread")(function* (threadId: ThreadId) {
    const entries = yield* sql<{ readonly activityId: string; readonly text: string }>`
      SELECT context.activity_id AS "activityId", context.text
      FROM mcp_app_model_context AS context
      JOIN projection_thread_activities AS activity ON activity.activity_id = context.activity_id
      JOIN projection_threads AS thread ON thread.thread_id = context.thread_id
      WHERE context.thread_id = ${threadId} AND activity.thread_id = ${threadId}
        AND thread.deleted_at IS NULL
      ORDER BY context.updated_at, context.activity_id
    `;
    return entries.map((entry) => ({
      key: `mcp_app_${entry.activityId.replace(/[^\w.-]/g, "_")}`,
      text: entry.text,
    }));
  });
  return { set, forThread };
});

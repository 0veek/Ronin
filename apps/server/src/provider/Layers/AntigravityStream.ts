/**
 * Reader for `agy --output-format stream-json`, the NDJSON protocol Ronin runs
 * Antigravity turns over.
 *
 * The CLI emits one JSON object per line: an `init` carrying the conversation
 * id, `step_update`s for assistant text and tool calls, and a final `result`
 * with the status and token usage. Text arrives as true deltas — concatenating
 * every `text_delta` in order reproduces `result.response` exactly — so they
 * can be forwarded straight to the thread as they land.
 *
 * The conversation id is the reason this protocol is worth parsing at all:
 * plain text mode never reveals it, and without it every turn has to start a
 * new conversation with `--new-project` and no memory of the last one.
 *
 * @module AntigravityStream
 */
import type { CanonicalItemType } from "@t3tools/contracts";

export interface AntigravityUsage {
  readonly usedTokens: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
}

export type AntigravityStreamEvent =
  | { readonly kind: "init"; readonly conversationId: string }
  | { readonly kind: "text"; readonly delta: string }
  | {
      readonly kind: "tool";
      readonly stepIndex: number;
      readonly completed: boolean;
      /** Only set once the step closes. */
      readonly status?: "completed" | "failed" | "declined";
      readonly toolName: string;
      readonly itemType: CanonicalItemType;
      readonly title: string;
      readonly detail?: string;
      readonly data: Record<string, unknown>;
    }
  | {
      readonly kind: "result";
      readonly conversationId?: string;
      readonly succeeded: boolean;
      /**
       * Whether the run still produced an answer. `status` reports the worst
       * thing that happened anywhere in the trajectory, so a tool error the
       * agent recovered from lands here as ERROR beside a finished reply.
       */
      readonly answered: boolean;
      readonly message?: string;
      readonly usage?: AntigravityUsage;
    };

/**
 * Antigravity's tool names, grouped into the item types Ronin's timeline
 * renders. Anything unlisted still shows up, just as a generic tool call.
 */
const TOOL_ITEM_TYPES: Readonly<Record<string, CanonicalItemType>> = {
  run_command: "command_execution",
  command_status: "command_execution",
  send_command_input: "command_execution",
  write_to_file: "file_change",
  replace_file_content: "file_change",
  multi_replace_file_content: "file_change",
  sed_file: "file_change",
  notebook_edit: "file_change",
  search_web: "web_search",
  read_url_content: "web_search",
  call_mcp_tool: "mcp_tool_call",
  invoke_subagent: "collab_agent_tool_call",
  browser_subagent: "collab_agent_tool_call",
  generate_image: "image_view",
  capture_browser_screenshot: "image_view",
};

const ITEM_TITLES: Readonly<Record<string, string>> = {
  command_execution: "Command run",
  file_change: "File change",
  mcp_tool_call: "MCP tool call",
  collab_agent_tool_call: "Subagent task",
  web_search: "Web search",
  image_view: "Image view",
};

/** Parameter keys Antigravity uses for the one value worth putting in a title row. */
const DETAIL_KEYS = [
  "CommandLine",
  "AbsolutePath",
  "TargetFile",
  "FilePath",
  "Path",
  "Query",
  "SearchQuery",
  "Url",
  "ServerName",
] as const;

const MAX_DETAIL_LENGTH = 200;
/** Tool output rides the websocket to every connected client; cap it. */
const MAX_OUTPUT_LENGTH = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function nonNegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function readDetail(parameters: Record<string, unknown> | undefined): string | undefined {
  if (!parameters) return undefined;
  for (const key of DETAIL_KEYS) {
    const value = trimmedString(parameters[key]);
    if (value) return truncate(value, MAX_DETAIL_LENGTH);
  }
  return undefined;
}

function readUsage(value: unknown): AntigravityUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usedTokens = nonNegativeInt(value.total_tokens);
  if (usedTokens === undefined) return undefined;
  const inputTokens = nonNegativeInt(value.input_tokens);
  const outputTokens = nonNegativeInt(value.output_tokens);
  const cachedInputTokens = nonNegativeInt(value.cache_read_tokens);
  const reasoningOutputTokens = nonNegativeInt(value.thinking_tokens);
  return {
    usedTokens,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(reasoningOutputTokens !== undefined ? { reasoningOutputTokens } : {}),
  };
}

function toolEvent(step: Record<string, unknown>): AntigravityStreamEvent | null {
  const stepIndex = nonNegativeInt(step.step_index);
  const toolInfo = isRecord(step.tool_info) ? step.tool_info : undefined;
  const toolName = trimmedString(step.tool_name) ?? trimmedString(toolInfo?.name);
  if (stepIndex === undefined || !toolName) return null;

  const itemType = TOOL_ITEM_TYPES[toolName] ?? "dynamic_tool_call";
  const parameters = isRecord(toolInfo?.parameters) ? toolInfo.parameters : undefined;
  const detail = readDetail(parameters);
  const command =
    itemType === "command_execution" ? trimmedString(parameters?.CommandLine) : undefined;
  const output = trimmedString(toolInfo?.output);
  const error = isRecord(toolInfo?.error) ? trimmedString(toolInfo.error.message) : undefined;

  // Antigravity opens a tool step as ACTIVE and closes it DONE, or ERROR when
  // the tool threw — which is also how a supervised run reports the permission
  // it was never able to ask for.
  const state = trimmedString(step.state)?.toUpperCase() ?? "DONE";
  const completed = state !== "ACTIVE";
  const status = !completed
    ? undefined
    : error === undefined && state !== "ERROR"
      ? "completed"
      : /denied permission|permission denied/i.test(error ?? "")
        ? "declined"
        : "failed";

  return {
    kind: "tool",
    stepIndex,
    completed,
    ...(status ? { status } : {}),
    toolName,
    itemType,
    title: ITEM_TITLES[itemType] ?? "Tool call",
    ...(detail ? { detail } : {}),
    data: {
      toolName,
      ...(command ? { command } : {}),
      ...(parameters ? { parameters } : {}),
      ...(output ? { output: truncate(output, MAX_OUTPUT_LENGTH) } : {}),
      ...(error ? { error: truncate(error, MAX_OUTPUT_LENGTH) } : {}),
    },
  };
}

export function parseAntigravityStreamLine(line: string): AntigravityStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  switch (parsed.event) {
    case "init": {
      const conversationId =
        trimmedString(parsed.conversation_id) ??
        (isRecord(parsed.init) ? trimmedString(parsed.init.conversation_id) : undefined);
      return conversationId ? { kind: "init", conversationId } : null;
    }
    case "step_update": {
      const step = isRecord(parsed.step_update) ? parsed.step_update : undefined;
      if (!step) return null;
      if (step.step_type === "tool") return toolEvent(step);
      const delta = typeof step.text_delta === "string" ? step.text_delta : "";
      return delta ? { kind: "text", delta } : null;
    }
    case "result": {
      const result = isRecord(parsed.result) ? parsed.result : undefined;
      if (!result) return null;
      const status = trimmedString(result.status) ?? "UNKNOWN";
      const succeeded = status.toUpperCase() === "SUCCESS";
      const conversationId = trimmedString(result.conversation_id);
      const usage = readUsage(result.usage);
      const response = trimmedString(result.response);
      // A run that answered did the work, whatever `status` says about the
      // steps it took to get there.
      const answered = response !== undefined;
      // A failing run puts its explanation in `error`; `response` holds the
      // assistant's reply, which on a recovered turn reads as a success.
      const detail = trimmedString(result.error) ?? response;
      const message = succeeded
        ? undefined
        : `Antigravity turn ${status}${detail ? `: ${truncate(detail, MAX_DETAIL_LENGTH)}` : "."}`;
      return {
        kind: "result",
        succeeded,
        answered,
        ...(conversationId ? { conversationId } : {}),
        ...(message ? { message } : {}),
        ...(usage ? { usage } : {}),
      };
    }
    default:
      return null;
  }
}

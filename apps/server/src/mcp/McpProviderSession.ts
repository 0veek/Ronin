import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

/**
 * Name every provider registers our MCP server under.
 *
 * Agents namespace MCP tools by server, so this string is user-visible: it is
 * the `ronin` in `ronin__preview_snapshot`. Keep it here rather than repeated
 * at each adapter's registration site — the copies drifted from the product
 * name once already.
 */
export const MCP_SERVER_NAME = "ronin";

/** Env var Codex reads the MCP bearer token from; named for the same reason. */
export const MCP_BEARER_TOKEN_ENV_VAR = "RONIN_MCP_BEARER_TOKEN";

/** Identifies this client to an ACP agent during `initialize`. */
export const MCP_CLIENT_NAME = "ronin";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
}

const sessionsByThread = new Map<ThreadId, McpProviderSessionConfig>();

export function setMcpProviderSession(config: McpProviderSessionConfig): void {
  sessionsByThread.set(config.threadId, config);
}

export function readMcpProviderSession(threadId: ThreadId): McpProviderSessionConfig | undefined {
  return sessionsByThread.get(threadId);
}

export function clearMcpProviderSession(threadId: ThreadId): void {
  sessionsByThread.delete(threadId);
}

export function clearAllMcpProviderSessions(): void {
  sessionsByThread.clear();
}

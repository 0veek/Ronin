/** Requests use the provider's existing MCP client and never open a session. */
export type McpAppProviderRequest = {
  readonly nativeThreadId: string;
  readonly providerInstanceId: string;
  readonly server: string;
} & (
  | { readonly operation: "listTools" }
  | {
      readonly operation: "callTool";
      readonly tool: string;
      readonly arguments: Record<string, unknown>;
    }
  | { readonly operation: "readResource"; readonly uri: string }
);

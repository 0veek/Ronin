const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the Ronin MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked.
</pull_request_linking>`;

const PRIVATE_SECRET_INSTRUCTIONS = `<private_secrets>
When a Ronin tool accepts a secretRef, obtain it with request_secret. The user enters the value in a private card, and you receive only a one-use reference. Never ask the user to paste a secret into chat or try to read the stored value. Pass the reference only to the intended tool; it expires after 24 hours and works only in the project where it was requested.
</private_secrets>`;

const HTML_RENDER_INSTRUCTIONS = `<html_renders>
Use html_preview to inspect an interactive page, then html_render to show it inline in this thread. The page is already visible above your final reply; add only what it does not say. Use inline styles and scripts, fluid width, and the injected theme variables. Absolute paths to local image files are inlined. Preview requires a connected Ronin desktop client; publishing does not.
</html_renders>`;

/** Shared runtime context; omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in Ronin through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}\n\n${PRIVATE_SECRET_INSTRUCTIONS}\n\n${HTML_RENDER_INSTRUCTIONS}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

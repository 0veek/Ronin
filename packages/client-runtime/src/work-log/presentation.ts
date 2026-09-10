import {
  isToolLifecycleItemType,
  type RuntimeItemStatus,
  type ToolLifecycleItemType,
} from "@t3tools/contracts";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";

export type WorkLogToolLifecycleStatus = RuntimeItemStatus | "stopped";

export interface WorkLogPresentationEntry {
  readonly label: string;
  readonly toolTitle?: string;
  readonly toolData?: unknown;
  readonly tone: "thinking" | "tool" | "info" | "error";
  readonly command?: string;
  readonly detail?: string;
  readonly itemType?: ToolLifecycleItemType;
  readonly requestKind?: string;
  readonly toolLifecycleStatus?: WorkLogToolLifecycleStatus;
}

const PULL_REQUEST_MCP_TOOL_LABELS = {
  link_pull_request: ["Link", "Linking", "Linked", "a pull request"],
  unlink_pull_request: ["Unlink", "Unlinking", "Unlinked", "a pull request"],
  list_thread_pull_requests: ["Check", "Checking", "Checked", "linked pull requests"],
} as const;

function pullRequestMcpToolPresentation(
  value: string | undefined,
  status: WorkLogToolLifecycleStatus | undefined,
  data?: unknown,
) {
  if (!value) return null;
  const name = value
    .replace(/\s+(?:complete|completed)\s*$/i, "")
    .trim()
    .replace(
      /^(?:mcp__(?:t3-code|t3_code|t3code)__|(?:t3-code|t3_code|t3code)(?:[.:/]|\s*·\s*))/i,
      "",
    );
  if (!Object.hasOwn(PULL_REQUEST_MCP_TOOL_LABELS, name)) return null;

  const [action, running, completed, detail] =
    PULL_REQUEST_MCP_TOOL_LABELS[name as keyof typeof PULL_REQUEST_MCP_TOOL_LABELS];
  const verb =
    status === "completed"
      ? completed
      : status === "failed"
        ? `Failed to ${action.toLowerCase()}`
        : status === "declined"
          ? `Declined to ${action.toLowerCase()}`
          : status === "stopped"
            ? `Stopped ${running.toLowerCase()}`
            : running;
  const payload = asRecord(data);
  const input =
    asRecord(payload?.arguments) ?? asRecord(payload?.input) ?? asRecord(payload?.rawInput);
  const urlTarget = typeof input?.url === "string" ? parseChangeRequestUrl(input.url) : null;
  const number = urlTarget?.number ?? input?.number;
  const target =
    name !== "list_thread_pull_requests" &&
    typeof number === "number" &&
    Number.isSafeInteger(number) &&
    number > 0
      ? `PR #${number}`
      : detail;
  return { displayName: `${verb} ${target}`, icon: "pull-request" as const };
}

/** Gives Ronin's compact work rows a native label and icon for its own PR-linking tools. */
export function resolveWorkEntryToolPresentation(
  entry: Pick<WorkLogPresentationEntry, "label" | "toolTitle" | "toolData" | "toolLifecycleStatus">,
) {
  const data = entry.toolData;
  if (data !== null && typeof data === "object") {
    if (
      "server" in data &&
      typeof data.server === "string" &&
      "tool" in data &&
      typeof data.tool === "string"
    ) {
      return pullRequestMcpToolPresentation(
        `${data.server}.${data.tool}`,
        entry.toolLifecycleStatus,
        data,
      );
    }
    if ("toolName" in data && typeof data.toolName === "string") {
      return pullRequestMcpToolPresentation(data.toolName, entry.toolLifecycleStatus, data);
    }
  }
  return (
    pullRequestMcpToolPresentation(entry.toolTitle, entry.toolLifecycleStatus, data) ??
    pullRequestMcpToolPresentation(entry.label, entry.toolLifecycleStatus, data)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function workLogEntryIsToolLike(entry: WorkLogPresentationEntry): boolean {
  if (entry.tone === "tool" || entry.tone === "thinking" || entry.tone === "error") return true;
  if (entry.command !== undefined && entry.command.trim().length > 0) return true;
  if (entry.requestKind !== undefined) return true;
  return entry.itemType !== undefined && isToolLifecycleItemType(entry.itemType);
}

/** Maps item and task status to the status shown on a work-log row. */
export function extractWorkLogToolLifecycleStatus(
  payloadValue: unknown,
): WorkLogToolLifecycleStatus | undefined {
  const payload = asRecord(payloadValue);
  switch (payload?.status) {
    case "pending":
    case "running":
    case "waiting":
      return "inProgress";
    case "cancelled":
    case "interrupted":
      return "stopped";
    case "idle":
      // A batch becomes idle when its parent turn ends. Other idle tasks can resume.
      return payload.taskType === "subagent_batch" ? "stopped" : undefined;
    case "inProgress":
    case "completed":
    case "failed":
    case "declined":
    case "stopped":
      return payload.status;
    default:
      return undefined;
  }
}

// Some providers report completion even when the output describes a failure.
function toolDetailTextLooksLikeFailure(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("file not found") ||
    normalized.includes("no files found") ||
    normalized.includes("enoent") ||
    normalized.includes("no such file or directory") ||
    normalized.includes("no such file") ||
    normalized.includes("commandnotfoundexception") ||
    normalized.includes("command not found") ||
    (normalized.includes("cannot find path") && normalized.includes("because it does not exist")) ||
    (normalized.includes("is not recognized") && normalized.includes("the term '")) ||
    normalized.includes("is not recognized as the name of a cmdlet") ||
    normalized.includes("a parameter cannot be found that matches parameter name") ||
    /<exited with exit code\s+[1-9]\d*\s*>/i.test(text) ||
    /exit(?:ed)? with exit code\s+[1-9]\d*/i.test(text) ||
    /exit code\s*[:\s]\s*[1-9]\d*\b/i.test(text)
  );
}

function workEntryIndicatesToolFailureFromOutput(
  entry: WorkLogPresentationEntry,
  includeCommand: boolean,
): boolean {
  if (
    entry.tone === "error" ||
    entry.toolLifecycleStatus === "failed" ||
    entry.toolLifecycleStatus === "declined"
  ) {
    return true;
  }
  if (!workLogEntryIsToolLike(entry)) return false;
  const output = includeCommand
    ? [entry.detail, entry.command].filter(Boolean).join("\n")
    : (entry.detail ?? "");
  return output.length > 0 && toolDetailTextLooksLikeFailure(output);
}

/** Includes legacy activities that stored error output in the command field. */
export function workEntryIndicatesToolFailure(entry: WorkLogPresentationEntry): boolean {
  return workEntryIndicatesToolFailureFromOutput(entry, true);
}

/** Checks rendered output without treating the user's command as an error. */
export function workEntryDisplayIndicatesToolFailure(entry: WorkLogPresentationEntry): boolean {
  return workEntryIndicatesToolFailureFromOutput(entry, false);
}

/** Decides whether the row can show a success marker. */
export function workEntryIndicatesToolSuccess(entry: WorkLogPresentationEntry): boolean {
  return (
    workLogEntryIsToolLike(entry) &&
    !workEntryIndicatesToolFailure(entry) &&
    entry.tone !== "thinking" &&
    entry.toolLifecycleStatus !== "inProgress" &&
    entry.toolLifecycleStatus !== "stopped"
  );
}

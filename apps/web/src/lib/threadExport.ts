/**
 * Thread transcript export.
 *
 * Builds a portable Markdown or JSON transcript from a loaded thread. Export is
 * client-side on purpose: the thread detail already carries the full message
 * list, so a remote browser exports its own copy without the server writing
 * files on the environment's disk.
 */
import type { OrchestrationMessage, ThreadId } from "@t3tools/contracts";

export type ThreadExportFormat = "md" | "json";

export interface ThreadExportInput {
  readonly threadId: ThreadId;
  readonly title: string;
  readonly projectTitle: string | null;
  readonly branch: string | null;
  readonly createdAt: string;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
}

const FILENAME_MAX_LENGTH = 80;

/**
 * A streaming message is a reply still being written. Exporting one would
 * capture a sentence mid-word, so settled messages are the export unit.
 */
function settledMessages(
  messages: ReadonlyArray<OrchestrationMessage>,
): ReadonlyArray<OrchestrationMessage> {
  return messages.filter((message) => !message.streaming);
}

function speakerHeading(message: OrchestrationMessage): string {
  if (message.role === "user") {
    return "You";
  }
  if (message.role === "assistant") {
    return message.providerName ? `Agent (${message.providerName})` : "Agent";
  }
  return message.role.charAt(0).toUpperCase() + message.role.slice(1);
}

export function buildThreadMarkdown(input: ThreadExportInput): string {
  const header = [
    `# ${input.title}`,
    "",
    ...(input.projectTitle ? [`- Project: ${input.projectTitle}`] : []),
    ...(input.branch ? [`- Branch: ${input.branch}`] : []),
    `- Started: ${input.createdAt}`,
    `- Thread: ${input.threadId}`,
    "",
  ];

  const body = settledMessages(input.messages).flatMap((message) => [
    `## ${speakerHeading(message)}`,
    "",
    message.text.trimEnd(),
    "",
  ]);

  return `${[...header, ...body].join("\n").trimEnd()}\n`;
}

export function buildThreadJson(input: ThreadExportInput): string {
  return `${JSON.stringify(
    {
      threadId: input.threadId,
      title: input.title,
      projectTitle: input.projectTitle,
      branch: input.branch,
      createdAt: input.createdAt,
      messages: settledMessages(input.messages).map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        turnId: message.turnId,
        providerName: message.providerName ?? null,
        createdAt: message.createdAt,
      })),
    },
    null,
    2,
  )}\n`;
}

export function buildThreadExportFilename(title: string, format: ThreadExportFormat): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, FILENAME_MAX_LENGTH)
    .replaceAll(/-+$/g, "");
  return `${slug.length > 0 ? slug : "thread"}.${format}`;
}

export function downloadThreadExport(input: ThreadExportInput, format: ThreadExportFormat): void {
  const contents = format === "md" ? buildThreadMarkdown(input) : buildThreadJson(input);
  const blob = new Blob([contents], {
    type: format === "md" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = buildThreadExportFilename(input.title, format);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

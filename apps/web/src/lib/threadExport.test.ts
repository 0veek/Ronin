import { MessageId, ThreadId, TurnId, type OrchestrationMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadExportFilename,
  buildThreadJson,
  buildThreadMarkdown,
  type ThreadExportInput,
} from "./threadExport";

function message(overrides: Partial<OrchestrationMessage>): OrchestrationMessage {
  return {
    id: MessageId.make("message-1"),
    role: "user",
    text: "Hello",
    turnId: TurnId.make("turn-1"),
    streaming: false,
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T10:00:00.000Z",
    ...overrides,
  };
}

function input(overrides?: Partial<ThreadExportInput>): ThreadExportInput {
  return {
    threadId: ThreadId.make("thread-1"),
    title: "Fix the flaky test",
    projectTitle: "ronin",
    branch: "fix/flaky",
    createdAt: "2026-05-01T09:00:00.000Z",
    messages: [
      message({ id: MessageId.make("m1"), role: "user", text: "Fix the flaky test." }),
      message({
        id: MessageId.make("m2"),
        role: "assistant",
        text: "Found it: a timing assumption.",
        providerName: "codex",
        createdAt: "2026-05-01T10:01:00.000Z",
      }),
    ],
    ...overrides,
  };
}

describe("buildThreadMarkdown", () => {
  it("writes a front matter header and one section per message", () => {
    const markdown = buildThreadMarkdown(input());

    expect(markdown).toContain("# Fix the flaky test");
    expect(markdown).toContain("- Project: ronin");
    expect(markdown).toContain("- Branch: fix/flaky");
    expect(markdown).toContain("## You");
    expect(markdown).toContain("Fix the flaky test.");
    expect(markdown).toContain("## Agent (codex)");
    expect(markdown).toContain("Found it: a timing assumption.");
    expect(markdown.endsWith("\n")).toBe(true);
  });

  it("omits metadata rows that are absent", () => {
    const markdown = buildThreadMarkdown(input({ branch: null, projectTitle: null }));

    expect(markdown).not.toContain("- Branch:");
    expect(markdown).not.toContain("- Project:");
  });

  it("skips streaming messages so a partial reply is never exported", () => {
    const markdown = buildThreadMarkdown(
      input({
        messages: [
          message({ id: MessageId.make("m1"), text: "Settled text" }),
          message({
            id: MessageId.make("m2"),
            role: "assistant",
            text: "Half-written",
            streaming: true,
          }),
        ],
      }),
    );

    expect(markdown).toContain("Settled text");
    expect(markdown).not.toContain("Half-written");
  });

  it("labels messages with no known provider generically", () => {
    const markdown = buildThreadMarkdown(
      input({
        messages: [message({ id: MessageId.make("m1"), role: "assistant", text: "Anonymous" })],
      }),
    );

    expect(markdown).toContain("## Agent\n");
  });
});

describe("buildThreadJson", () => {
  it("round-trips as JSON and drops streaming messages", () => {
    const parsed = JSON.parse(
      buildThreadJson(
        input({
          messages: [
            message({ id: MessageId.make("m1"), text: "Kept" }),
            message({ id: MessageId.make("m2"), text: "Dropped", streaming: true }),
          ],
        }),
      ),
    ) as { readonly title: string; readonly messages: ReadonlyArray<{ readonly text: string }> };

    expect(parsed.title).toBe("Fix the flaky test");
    expect(parsed.messages.map((entry) => entry.text)).toEqual(["Kept"]);
  });
});

describe("buildThreadExportFilename", () => {
  it("slugifies the title and keeps the extension", () => {
    expect(buildThreadExportFilename("Fix the flaky test", "md")).toBe("fix-the-flaky-test.md");
    expect(buildThreadExportFilename("  Weird///name  ", "json")).toBe("weird-name.json");
  });

  it("falls back when a title has no usable characters", () => {
    expect(buildThreadExportFilename("///", "md")).toBe("thread.md");
  });

  it("bounds absurdly long titles", () => {
    const name = buildThreadExportFilename("a".repeat(300), "md");
    expect(name.length).toBeLessThanOrEqual(83);
  });
});

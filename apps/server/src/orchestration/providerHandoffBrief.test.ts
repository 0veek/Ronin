import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  renderProviderHandoffBrief,
  selectHandoffMessages,
  type ProviderHandoffBriefInput,
  type ProviderHandoffBriefMessage,
} from "./providerHandoffBrief.ts";

const codexInstance = ProviderInstanceId.make("codex");
const claudeInstance = ProviderInstanceId.make("claude-agent");
const claudeSecondaryInstance = ProviderInstanceId.make("claude-agent-work");

const continuationKeys = new Map([
  [codexInstance, "codex:home:/home/dev/.codex"],
  [claudeInstance, "claude-agent:instance:claude-agent"],
  // Shares a continuation group with `claudeInstance`: either one can resume
  // the other's native session, so either one's messages are already "seen".
  [claudeSecondaryInstance, "claude-agent:instance:claude-agent"],
]);

function assistant(text: string, instanceId: ProviderInstanceId): ProviderHandoffBriefMessage {
  return {
    role: "assistant",
    text,
    providerInstanceId: instanceId,
    providerName: instanceId.startsWith("codex") ? "codex" : "claude-agent",
  };
}

function user(text: string): ProviderHandoffBriefMessage {
  return { role: "user", text };
}

const baseInput: Omit<ProviderHandoffBriefInput, "messages"> = {
  workspace: {
    threadTitle: "Fix the flaky reaper test",
    branch: "ronin/fix-reaper",
    worktreePath: "/home/dev/worktrees/fix-reaper",
    cwd: "/home/dev/worktrees/fix-reaper",
  },
  changedFiles: [],
  fromProviderName: "codex",
  mode: "briefed",
  maxChars: 120_000,
};

describe("selectHandoffMessages", () => {
  it("gives a provider with no resumable state the whole conversation", () => {
    const messages = [user("start"), assistant("ok", codexInstance), user("keep going")];

    const selected = selectHandoffMessages({
      messages,
      continuationKeyByInstanceId: continuationKeys,
    });

    expect(selected).toEqual(messages);
  });

  it("gives a returning provider only what happened after its last message", () => {
    const messages = [
      user("start"),
      assistant("claude replied", claudeInstance),
      user("switch to codex now"),
      assistant("codex replied", codexInstance),
      user("switch back"),
    ];

    const selected = selectHandoffMessages({
      messages,
      continuationKeyByInstanceId: continuationKeys,
      resumedContinuationKey: "claude-agent:instance:claude-agent",
    });

    expect(selected.map((message) => message.text)).toEqual([
      "switch to codex now",
      "codex replied",
      "switch back",
    ]);
  });

  it("treats every instance in a continuation group as the same author", () => {
    const messages = [
      assistant("first claude instance", claudeInstance),
      user("mid"),
      assistant("second claude instance", claudeSecondaryInstance),
      user("after"),
    ];

    const selected = selectHandoffMessages({
      messages,
      continuationKeyByInstanceId: continuationKeys,
      resumedContinuationKey: "claude-agent:instance:claude-agent",
    });

    expect(selected.map((message) => message.text)).toEqual(["after"]);
  });

  it("replays everything when the resuming provider authored nothing in the thread", () => {
    // A stale cursor, or history recorded before messages carried attribution.
    // Seeing a turn twice is recoverable; never seeing it is not.
    const messages = [user("start"), assistant("codex replied", codexInstance)];

    const selected = selectHandoffMessages({
      messages,
      continuationKeyByInstanceId: continuationKeys,
      resumedContinuationKey: "claude-agent:instance:claude-agent",
    });

    expect(selected).toEqual(messages);
  });

  it("keeps unattributed legacy messages in the delta", () => {
    const messages = [
      assistant("claude replied", claudeInstance),
      { role: "assistant" as const, text: "legacy reply with no author" },
      user("after"),
    ];

    const selected = selectHandoffMessages({
      messages,
      continuationKeyByInstanceId: continuationKeys,
      resumedContinuationKey: "claude-agent:instance:claude-agent",
    });

    expect(selected.map((message) => message.text)).toEqual([
      "legacy reply with no author",
      "after",
    ]);
  });
});

describe("renderProviderHandoffBrief", () => {
  it("renders the whole conversation for a provider taking over cold", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [user("add a test"), assistant("added it", codexInstance)],
      changedFiles: [{ path: "src/reaper.test.ts", additions: 12, deletions: 3 }],
    });

    expect(brief.compressed).toBe(false);
    expect(brief.messageCount).toBe(2);
    expect(brief.chars).toBe(brief.text.length);
    expect(brief.text).toContain("# Handoff: taking over");
    expect(brief.text).toContain("from codex");
    expect(brief.text).toContain("- Branch: ronin/fix-reaper");
    expect(brief.text).toContain("- src/reaper.test.ts (+12/-3)");
    expect(brief.text).toContain("### User\nadd a test");
    expect(brief.text).toContain("### Assistant (codex)\nadded it");
  });

  it("tells a resuming provider it is only catching up", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      mode: "resumed",
      messages: [user("what changed?")],
    });

    expect(brief.text).toContain("# Handoff: catching up");
    expect(brief.text).toContain("since your last message");
  });

  it("omits sections it has nothing to say about", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      workspace: { threadTitle: null, branch: null, worktreePath: null, cwd: null },
      fromProviderName: null,
      messages: [user("hello")],
    });

    expect(brief.text).not.toContain("## Workspace");
    expect(brief.text).not.toContain("## Files already changed");
    expect(brief.text).toContain("an in-progress conversation.");
  });

  it("truncates long message bodies instead of dropping the messages", () => {
    const messages = [
      user("A".repeat(4_000)),
      assistant("B".repeat(4_000), codexInstance),
      user("C".repeat(4_000)),
    ];

    const brief = renderProviderHandoffBrief({ ...baseInput, messages, maxChars: 2_000 });

    expect(brief.compressed).toBe(true);
    // Every turn still shows up: the shape of the conversation survives.
    expect(brief.messageCount).toBe(3);
    expect(brief.chars).toBeLessThanOrEqual(2_000);
    expect(brief.text).toContain("characters elided");
    expect(brief.text).toContain("AAA");
    expect(brief.text).toContain("BBB");
    expect(brief.text).toContain("CCC");
  });

  it("drops the oldest messages only when truncation alone cannot fit them", () => {
    const messages = Array.from({ length: 60 }, (_unused, index) =>
      user(`message ${index} ${"x".repeat(500)}`),
    );

    const brief = renderProviderHandoffBrief({ ...baseInput, messages, maxChars: 3_000 });

    expect(brief.compressed).toBe(true);
    expect(brief.messageCount).toBeLessThan(60);
    expect(brief.chars).toBeLessThanOrEqual(3_000);
    expect(brief.text).toContain("earlier messages omitted");
    // The most recent exchange is the one the provider has to act on.
    expect(brief.text).toContain("message 59");
    expect(brief.text).not.toContain("message 0 ");
  });

  it("stays within budget even when the scaffold alone is oversized", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [user("hello")],
      maxChars: 80,
    });

    expect(brief.chars).toBeLessThanOrEqual(80);
    expect(brief.compressed).toBe(true);
  });

  it("skips blank messages", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [user("real"), assistant("   ", codexInstance)],
    });

    expect(brief.messageCount).toBe(1);
    expect(brief.text).not.toContain("### Assistant");
  });
});

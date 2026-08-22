import { MessageId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  estimateHandoffTokens,
  handoffWrapOverhead,
  renderProviderHandoffBrief,
  selectHandoffMessages,
  wrapProviderHandoffInput,
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

  it("does not replay a message the group processed but never answered", () => {
    // Interrupted before it could reply: the message is in its native
    // transcript, so replaying it would duplicate the provider's own context.
    const interrupted = MessageId.make("message-interrupted");
    const messages: ReadonlyArray<ProviderHandoffBriefMessage> = [
      assistant("claude replied", claudeInstance),
      { ...user("do the big refactor"), id: interrupted },
      assistant("codex took over", codexInstance),
      user("claude, carry on"),
    ];

    const selected = selectHandoffMessages({
      messages,
      continuationKeyByInstanceId: continuationKeys,
      resumedContinuationKey: "claude-agent:instance:claude-agent",
      deliveredThroughMessageId: interrupted,
    });

    expect(selected.map((message) => message.text)).toEqual([
      "codex took over",
      "claude, carry on",
    ]);
  });

  it("ignores a delivery mark that points behind the group's own last message", () => {
    const stale = MessageId.make("message-stale");
    const messages: ReadonlyArray<ProviderHandoffBriefMessage> = [
      { ...user("older ask"), id: stale },
      assistant("claude replied after it", claudeInstance),
      user("after"),
    ];

    const selected = selectHandoffMessages({
      messages,
      continuationKeyByInstanceId: continuationKeys,
      resumedContinuationKey: "claude-agent:instance:claude-agent",
      deliveredThroughMessageId: stale,
    });

    expect(selected.map((message) => message.text)).toEqual(["after"]);
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
    expect(brief.fullMessageCount).toBe(2);
    expect(brief.chars).toBe(brief.text.length);
    expect(brief.estimatedTokens).toBeGreaterThan(0);
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
    expect(brief.text).not.toContain("## Files this conversation has changed");
    expect(brief.text).toContain("an in-progress conversation.");
  });

  it("keeps the whole thread in full when the budget affords it", () => {
    const messages = Array.from({ length: 12 }, (_unused, index) => user(`turn ${index}`));

    const brief = renderProviderHandoffBrief({ ...baseInput, messages });

    expect(brief.compressed).toBe(false);
    expect(brief.fullMessageCount).toBe(12);
    expect(brief.summarizedMessageCount).toBe(0);
    expect(brief.text).not.toContain("## Earlier conversation summary");
    expect(brief.text).toContain("### User\nturn 0");
    expect(brief.text).toContain("### User\nturn 11");
  });

  it("collapses older turns to bullets once the full window will not fit", () => {
    const messages = Array.from({ length: 20 }, (_unused, index) =>
      user(`turn ${index} ${"x".repeat(600)}`),
    );

    const brief = renderProviderHandoffBrief({ ...baseInput, messages, maxChars: 12_000 });

    expect(brief.compressed).toBe(false);
    expect(brief.messageCount).toBe(20);
    expect(brief.summarizedMessageCount).toBeGreaterThan(0);
    expect(brief.fullMessageCount).toBeLessThan(20);
    expect(brief.text).toContain("## Earlier conversation summary");
    // Turn 0 is the original ask, so it is pinned rather than bulleted.
    expect(brief.text).toContain("## Original request");
    expect(brief.text).toContain("- User: turn 1");
    expect(brief.text).toContain("### User\nturn 19");
    expect(brief.chars).toBeLessThanOrEqual(12_000);
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

  it("keeps the end of a truncated body, not just its opening", () => {
    const body = `${"opening ".repeat(200)}THE-CONCLUSION`;

    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [user("go"), assistant(body, codexInstance)],
      maxChars: 1_600,
    });

    expect(brief.text).toContain("opening");
    expect(brief.text).toContain("THE-CONCLUSION");
    expect(brief.text).toContain("characters elided");
  });

  it("closes a code fence a cut left open", () => {
    const body = `here is the patch\n\n\`\`\`ts\n${"const x = 1;\n".repeat(400)}\`\`\`\n`;

    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [assistant(body, codexInstance)],
      maxChars: 1_800,
    });

    const fences = brief.text.match(/^ {0,3}```/gm) ?? [];
    expect(fences.length % 2).toBe(0);
  });

  it("pins the original request when the middle of the thread is dropped", () => {
    const messages = [
      user("ORIGINAL-ASK: make the reaper test deterministic"),
      ...Array.from({ length: 60 }, (_unused, index) => user(`filler ${index} ${"y".repeat(500)}`)),
    ];

    const brief = renderProviderHandoffBrief({ ...baseInput, messages, maxChars: 3_000 });

    expect(brief.text).toContain("## Original request");
    expect(brief.text).toContain("ORIGINAL-ASK: make the reaper test deterministic");
    expect(brief.omittedMessageCount).toBeGreaterThan(0);
    expect(brief.chars).toBeLessThanOrEqual(3_000);
  });

  it("does not pin an original request at a provider resuming its own session", () => {
    // It already holds the start of the conversation in its own context.
    const messages = [
      user("ORIGINAL-ASK"),
      ...Array.from({ length: 40 }, (_unused, index) => user(`filler ${index} ${"y".repeat(500)}`)),
    ];

    const brief = renderProviderHandoffBrief({
      ...baseInput,
      mode: "resumed",
      messages,
      maxChars: 3_000,
    });

    expect(brief.text).not.toContain("## Original request");
  });

  it("carries the plan of record alongside the pinned request", () => {
    const messages = [
      user("ORIGINAL-ASK"),
      ...Array.from({ length: 40 }, (_unused, index) => user(`filler ${index} ${"y".repeat(400)}`)),
    ];

    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages,
      plan: { markdown: "1. Reproduce\n2. Fix\n3. Test", implemented: false },
      maxChars: 6_000,
    });

    expect(brief.text).toContain("## Plan of record");
    expect(brief.text).toContain("1. Reproduce");
  });

  it("drops the oldest summary lines only when even bullets will not fit", () => {
    const messages = Array.from({ length: 60 }, (_unused, index) =>
      assistant(`message ${index} ${"x".repeat(500)}`, codexInstance),
    );

    const brief = renderProviderHandoffBrief({ ...baseInput, messages, maxChars: 3_000 });

    expect(brief.compressed).toBe(true);
    expect(brief.messageCount).toBeLessThan(60);
    expect(brief.omittedMessageCount).toBeGreaterThan(0);
    expect(brief.chars).toBeLessThanOrEqual(3_000);
    expect(brief.text).toContain("Earlier conversation summary");
    expect(brief.text).toContain("omitted to fit the context budget");
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

  it("skips messages that carry nothing at all", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [user("real"), assistant("   ", codexInstance)],
    });

    expect(brief.messageCount).toBe(1);
    expect(brief.text).not.toContain("### Assistant");
  });

  it("keeps an attachment-only turn instead of dropping it", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [
        { role: "user", text: "", attachments: ["screenshot.png"] },
        user("what is this?"),
      ],
    });

    expect(brief.messageCount).toBe(2);
    expect(brief.text).toContain("Attached: screenshot.png");
  });

  it("carries the work each turn did, marking what failed", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [
        user("fix it"),
        {
          ...assistant("done", codexInstance),
          work: [
            { label: "Edit", detail: "src/reaper.ts" },
            { label: "Bash", detail: "vp test run src/reaper.test.ts", failed: true },
          ],
        },
      ],
    });

    expect(brief.text).toContain("Work log:");
    expect(brief.text).toContain("- Edit: src/reaper.ts");
    expect(brief.text).toContain("- Bash: vp test run src/reaper.test.ts — failed");
  });

  it("marks the thread-level events that landed between turns", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [
        user("start"),
        { ...user("keep going"), notices: ["Context compacted", "Tool denied: Bash"] },
      ],
    });

    expect(brief.text).toContain("> Context compacted");
    expect(brief.text).toContain("> Tool denied: Bash");
  });

  it("ranks changed files by churn and says how many turns touched them", () => {
    const brief = renderProviderHandoffBrief({
      ...baseInput,
      messages: [user("go")],
      changedFiles: [
        { path: "docs/notes.md", additions: 1, deletions: 0, turns: 1 },
        { path: "src/reaper.ts", additions: 80, deletions: 40, turns: 3 },
        { path: "src/untouched.ts", additions: 0, deletions: 0, turns: 2 },
      ],
    });

    const files = brief.text.slice(brief.text.indexOf("## Files this conversation has changed"));
    expect(files.indexOf("src/reaper.ts")).toBeLessThan(files.indexOf("docs/notes.md"));
    expect(brief.text).toContain("- src/reaper.ts (+80/-40 across 3 turns)");
    expect(brief.text).not.toContain("src/untouched.ts");
  });
});

describe("estimateHandoffTokens", () => {
  it("charges long unbroken runs more than a word of the same length", () => {
    expect(estimateHandoffTokens("a b c d")).toBe(4);
    expect(estimateHandoffTokens("averyveryverylongidentifier")).toBeGreaterThan(1);
  });
});

describe("wrapProviderHandoffInput", () => {
  it("keeps the reconstructed brief out of the user's latest message", () => {
    const wrapped = wrapProviderHandoffInput({
      contextText: "# Handoff: taking over\n\nYou are taking over.",
      messageText: "keep going from the tests",
    });

    expect(wrapped).toContain("<handoff_context>");
    expect(wrapped).toContain("# Handoff: taking over");
    expect(wrapped).toContain("</handoff_context>");
    expect(wrapped).toContain(
      "<latest_user_message>\nkeep going from the tests\n</latest_user_message>",
    );
  });

  it("charges the envelope against the brief budget, not the user's message", () => {
    const message = "continue";
    const overhead = handoffWrapOverhead(message);
    const wrapped = wrapProviderHandoffInput({ contextText: "brief", messageText: message });

    expect(overhead).toBe(
      wrapProviderHandoffInput({ contextText: "", messageText: message }).length,
    );
    expect(wrapped.length).toBe(overhead + "brief".length);
  });
});

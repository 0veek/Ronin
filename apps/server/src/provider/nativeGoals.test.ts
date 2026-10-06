import { describe, expect, it } from "vite-plus/test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { nextClaudeGoal, parseCodexGoalCommand, providerGoalFromCodex } from "./nativeGoals.ts";

const assistant = (text: string, model = "<synthetic>", parent: string | null = null) =>
  ({
    type: "assistant",
    parent_tool_use_id: parent,
    message: { model, content: [{ type: "text", text }] },
  }) as SDKMessage;

describe("native goals", () => {
  it.each([
    ["/goal", { type: "show" }],
    [" /goal edit ", { type: "show" }],
    ["/goal PAUSE", { type: "pause" }],
    ["/goal resume", { type: "resume" }],
    ["/goal clear", { type: "clear" }],
    ["/goal finish\nall steps", { type: "set", objective: "finish\nall steps" }],
    ["/goals", null],
    ["Explain /goal", null],
  ])("parses Codex's command %s", (text, command) =>
    expect(parseCodexGoalCommand(text as string)).toEqual(command),
  );

  it("normalizes Codex accounting and budget statuses", () => {
    expect(
      providerGoalFromCodex({
        threadId: "native-thread",
        createdAt: 0,
        updatedAt: 0,
        objective: " Ship it ",
        status: "budgetLimited",
        tokensUsed: 1234,
        tokenBudget: 1000,
        timeUsedSeconds: 90,
      }),
    ).toEqual({
      objective: "Ship it",
      status: "budget_limited",
      tokensUsed: 1234,
      tokenBudget: 1000,
      timeUsedSeconds: 90,
    });
  });

  it("trusts only Claude's root synthetic command output", () => {
    expect(nextClaudeGoal(null, assistant("Goal set: Ship it"))).toEqual({
      objective: "Ship it",
      status: "active",
      checks: 0,
    });
    expect(nextClaudeGoal(null, assistant("Goal set: Ship it", "claude"))).toBeUndefined();
    expect(
      nextClaudeGoal(null, assistant("Goal set: Ship it", "<synthetic>", "child")),
    ).toBeUndefined();
    expect(nextClaudeGoal(null, assistant("Goal set: "))).toBeUndefined();
  });

  it("counts matching root evaluator feedback and clears the previous goal", () => {
    const goal = { objective: "Ship it", status: "active" as const, checks: 1 };
    const feedback = {
      type: "user",
      isSynthetic: true,
      parent_tool_use_id: null,
      message: { content: "Stop hook feedback:\n[Ship it]: Tests still fail" },
    } as SDKMessage;
    const next = nextClaudeGoal(goal, feedback);
    expect(next).toEqual({ ...goal, checks: 2, lastCheck: "Tests still fail" });
    expect(nextClaudeGoal({ ...goal, objective: "Another goal" }, feedback)).toBeUndefined();
    expect(
      nextClaudeGoal(goal, { ...feedback, parent_tool_use_id: "child" } as SDKMessage),
    ).toBeUndefined();
    expect(nextClaudeGoal(goal, assistant("Goal active: Ship it (2 turns)"))).toEqual({
      ...goal,
      checks: 2,
    });
    expect(nextClaudeGoal(goal, assistant("Goal cleared: Ship it"))).toBeNull();
    expect(nextClaudeGoal(goal, assistant("No goal set"))).toBeNull();
  });
});

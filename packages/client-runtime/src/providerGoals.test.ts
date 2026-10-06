import { describe, expect, it } from "vite-plus/test";
import { presentProviderGoal } from "./providerGoals.ts";

describe("presentProviderGoal", () => {
  it("summarizes Codex accounting and offers resume once the goal stops short", () => {
    expect(
      presentProviderGoal(
        {
          objective: "Ship the feature",
          status: "paused",
          tokensUsed: 12_400,
          tokenBudget: 50_000,
          timeUsedSeconds: 245,
        },
        false,
      ),
    ).toEqual({
      title: "Goal paused",
      objective: "Ship the feature",
      usage: "12k / 50k tokens · 4m 5s",
      canResume: true,
    });
  });

  it("counts Claude evaluator checks and never offers resume", () => {
    expect(
      presentProviderGoal({ objective: "All tests pass", status: "active", checks: 1 }, true),
    ).toEqual({
      title: "Pursuing goal",
      objective: "All tests pass",
      usage: "1 check",
      canResume: false,
    });
    expect(
      presentProviderGoal({ objective: "All tests pass", status: "complete", checks: 0 }, false)
        .usage,
    ).toBeNull();
    expect(
      presentProviderGoal({ objective: "All tests pass", status: "active" }, false).title,
    ).toBe("Goal set");
  });
});

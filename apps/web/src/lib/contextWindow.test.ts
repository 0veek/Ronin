import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import { deriveLatestContextWindowSnapshot, formatContextWindowTokens } from "./contextWindow";

function makeActivity(
  id: string,
  kind: string,
  payload: unknown,
  createdAt = "2026-03-23T00:00:00.000Z",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt,
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("keeps valid zero-usage snapshots", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 0,
        maxTokens: 100_000,
      }),
    ]);

    expect(snapshot).toMatchObject({
      usedTokens: 0,
      maxTokens: 100_000,
      remainingTokens: 100_000,
      usedPercentage: 0,
      remainingPercentage: 100,
    });
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("drops snapshots recorded before a provider switch", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity(
        "activity-1",
        "context-window.updated",
        { usedTokens: 207_720, maxTokens: 258_400 },
        "2026-03-23T00:00:00.000Z",
      ),
      makeActivity(
        "activity-2",
        "provider.switched",
        { fromInstanceId: "codex", toInstanceId: "claudeAgent", model: "claude-opus-5" },
        "2026-03-23T01:00:00.000Z",
      ),
    ]);

    expect(snapshot).toBeNull();
  });

  it("keeps snapshots recorded after a provider switch", () => {
    // `provider.switched` is appended without a sequence, so the ordering used
    // by the thread reducer sorts it last even once the new provider reports.
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity(
        "activity-1",
        "context-window.updated",
        { usedTokens: 207_720, maxTokens: 258_400 },
        "2026-03-23T00:00:00.000Z",
      ),
      makeActivity(
        "activity-2",
        "context-window.updated",
        { usedTokens: 12_000, maxTokens: 1_000_000 },
        "2026-03-23T02:00:00.000Z",
      ),
      makeActivity(
        "activity-3",
        "provider.switched",
        { fromInstanceId: "codex", toInstanceId: "claudeAgent", model: "claude-opus-5" },
        "2026-03-23T01:00:00.000Z",
      ),
    ]);

    expect(snapshot?.usedTokens).toBe(12_000);
    expect(snapshot?.maxTokens).toBe(1_000_000);
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });
});

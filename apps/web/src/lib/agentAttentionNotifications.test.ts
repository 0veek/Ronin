import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import {
  ATTENTION_SUMMARY_THRESHOLD,
  diffAgentAttention,
  summarizeAttention,
  type AgentAttentionEvent,
} from "./agentAttentionNotifications";

function shell(overrides: {
  readonly id?: string;
  readonly turnState?: "running" | "interrupted" | "completed" | "error" | null;
  readonly turnId?: string;
  readonly hasPendingApprovals?: boolean;
  readonly archivedAt?: string | null;
  readonly providerName?: string | null;
}): EnvironmentThreadShell {
  const turnState = overrides.turnState === undefined ? "running" : overrides.turnState;
  return {
    environmentId: "env-1",
    id: overrides.id ?? "thread-1",
    projectId: "project-1",
    title: "Fix the flaky test",
    modelSelection: { model: "auto" },
    runtimeMode: "local",
    interactionMode: "chat",
    branch: null,
    worktreePath: null,
    latestTurn:
      turnState === null
        ? null
        : {
            turnId: overrides.turnId ?? "turn-1",
            state: turnState,
            requestedAt: "2026-08-14T10:00:00.000Z",
            startedAt: "2026-08-14T10:00:01.000Z",
            completedAt: turnState === "running" ? null : "2026-08-14T10:05:00.000Z",
            assistantMessageId: null,
          },
    createdAt: "2026-08-14T09:00:00.000Z",
    updatedAt: "2026-08-14T10:05:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    session: {
      threadId: overrides.id ?? "thread-1",
      status: turnState === "running" ? "running" : "idle",
      providerName: overrides.providerName === undefined ? "claude" : overrides.providerName,
      runtimeMode: "local",
      activeTurnId: turnState === "running" ? (overrides.turnId ?? "turn-1") : null,
      lastError: null,
      updatedAt: "2026-08-14T10:05:00.000Z",
    },
    latestUserMessageAt: null,
    hasPendingApprovals: overrides.hasPendingApprovals ?? false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as unknown as EnvironmentThreadShell;
}

describe("diffAgentAttention", () => {
  it("stays silent on the first snapshot", () => {
    // Connecting replays every thread's current state; none of it is news.
    const { events } = diffAgentAttention(null, [shell({ turnState: "completed" })]);
    expect(events).toEqual([]);
  });

  it("notifies when a running turn completes", () => {
    const first = diffAgentAttention(null, [shell({ turnState: "running" })]);
    const { events } = diffAgentAttention(first.baseline, [shell({ turnState: "completed" })]);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("turn-completed");
    expect(events[0]?.title).toBe("Fix the flaky test");
    expect(events[0]?.body).toBe("Claude finished");
  });

  it("notifies when a running turn errors", () => {
    const first = diffAgentAttention(null, [shell({ turnState: "running" })]);
    const { events } = diffAgentAttention(first.baseline, [shell({ turnState: "error" })]);

    expect(events[0]?.kind).toBe("turn-failed");
  });

  it("stays silent when the user interrupts a turn themselves", () => {
    const first = diffAgentAttention(null, [shell({ turnState: "running" })]);
    const { events } = diffAgentAttention(first.baseline, [shell({ turnState: "interrupted" })]);

    expect(events).toEqual([]);
  });

  it("notifies when an approval appears, and prefers it over completion", () => {
    const first = diffAgentAttention(null, [shell({ turnState: "running" })]);
    const { events } = diffAgentAttention(first.baseline, [
      shell({ turnState: "completed", hasPendingApprovals: true }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("needs-approval");
  });

  it("does not repeat a completion that was already observed", () => {
    const first = diffAgentAttention(null, [shell({ turnState: "running" })]);
    const second = diffAgentAttention(first.baseline, [shell({ turnState: "completed" })]);
    const third = diffAgentAttention(second.baseline, [shell({ turnState: "completed" })]);

    expect(second.events).toHaveLength(1);
    expect(third.events).toEqual([]);
  });

  it("treats a thread first seen mid-run as baseline, not news", () => {
    const first = diffAgentAttention(null, [shell({ id: "existing", turnState: "running" })]);
    // A second thread appears already completed (reconnect, other device).
    const { events } = diffAgentAttention(first.baseline, [
      shell({ id: "existing", turnState: "running" }),
      shell({ id: "newcomer", turnState: "completed" }),
    ]);

    expect(events).toEqual([]);
  });

  it("skips archived threads", () => {
    const first = diffAgentAttention(null, [shell({ turnState: "running" })]);
    const { events } = diffAgentAttention(first.baseline, [
      shell({ turnState: "completed", archivedAt: "2026-08-14T10:04:00.000Z" }),
    ]);

    expect(events).toEqual([]);
  });

  it("falls back to a generic label without a provider name", () => {
    const first = diffAgentAttention(null, [shell({ turnState: "running", providerName: null })]);
    const { events } = diffAgentAttention(first.baseline, [
      shell({ turnState: "completed", providerName: null }),
    ]);

    expect(events[0]?.body).toBe("Agent finished");
  });
});

describe("summarizeAttention", () => {
  const event = (id: string, kind: AgentAttentionEvent["kind"]): AgentAttentionEvent => ({
    kind,
    environmentId: "env-1",
    threadId: id,
    tag: `env-1:${id}`,
    title: id,
    body: "",
  });

  it("leaves small batches as individual notifications", () => {
    const events = Array.from({ length: ATTENTION_SUMMARY_THRESHOLD }, (_, index) =>
      event(`t${index}`, "turn-completed"),
    );
    expect(summarizeAttention(events)).toBeNull();
  });

  it("collapses a burst into one summary and counts the approvals", () => {
    const events = [
      ...Array.from({ length: ATTENTION_SUMMARY_THRESHOLD }, (_, index) =>
        event(`t${index}`, "turn-completed"),
      ),
      event("waiting", "needs-approval"),
    ];
    const summary = summarizeAttention(events);

    expect(summary?.title).toBe("5 threads need a look");
    expect(summary?.body).toBe("1 waiting for approval, 4 finished");
  });
});

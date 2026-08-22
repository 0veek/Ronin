import {
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationMessage,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  buildProviderHandoffChangedFiles,
  buildProviderHandoffMessages,
  buildProviderHandoffPlan,
} from "./providerHandoffContext.ts";

const threadId = ThreadId.make("thread-1");
const turnOne = TurnId.make("turn-1");
const codex = ProviderInstanceId.make("codex");

function message(
  id: string,
  overrides: Partial<Omit<OrchestrationMessage, "id">> = {},
): OrchestrationMessage {
  return {
    id: MessageId.make(id),
    role: "user",
    text: "hello",
    turnId: null,
    streaming: false,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function activity(
  id: string,
  overrides: Partial<Omit<OrchestrationThreadActivity, "id">> = {},
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "tool",
    kind: "tool.completed",
    summary: "Bash",
    payload: {},
    turnId: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function thread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title: "Fix the reaper",
    modelSelection: { instanceId: codex, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  } as OrchestrationThread;
}

describe("buildProviderHandoffMessages", () => {
  it("hangs each turn's work off the message that turn produced", () => {
    const built = buildProviderHandoffMessages({
      thread: thread({
        messages: [
          message("m1", { text: "fix it" }),
          message("m2", {
            role: "assistant",
            text: "done",
            turnId: turnOne,
            providerInstanceId: codex,
            providerName: "codex",
          }),
        ],
        activities: [
          activity("a1", { summary: "Edit", turnId: turnOne, payload: { detail: "src/a.ts" } }),
          activity("a2", {
            summary: "Bash",
            turnId: turnOne,
            payload: { detail: "vp test", status: "failed" },
          }),
        ],
      }),
    });

    expect(built[0]?.work).toBeUndefined();
    expect(built[1]?.work).toEqual([
      { label: "Edit", detail: "src/a.ts" },
      { label: "Bash", detail: "vp test", failed: true },
    ]);
  });

  it("marks a denied tool as failed work", () => {
    const built = buildProviderHandoffMessages({
      thread: thread({
        messages: [message("m1", { role: "assistant", text: "tried", turnId: turnOne })],
        activities: [
          activity("a1", {
            kind: "tool.denied",
            summary: "Tool denied: Bash",
            turnId: turnOne,
          }),
        ],
      }),
    });

    expect(built[0]?.work).toEqual([{ label: "Tool denied: Bash", failed: true }]);
  });

  it("lands a thread-level notice on the message that follows it", () => {
    const built = buildProviderHandoffMessages({
      thread: thread({
        messages: [
          message("m1", { text: "first", createdAt: "2026-03-01T00:00:00.000Z" }),
          message("m2", { text: "second", createdAt: "2026-03-01T00:00:02.000Z" }),
        ],
        activities: [
          activity("a1", {
            kind: "context-compaction",
            tone: "info",
            summary: "Context compacted",
            createdAt: "2026-03-01T00:00:01.000Z",
          }),
        ],
      }),
    });

    expect(built[0]?.notices).toBeUndefined();
    expect(built[1]?.notices?.[0]).toContain("compacted");
  });

  it("drops a notice with no message after it rather than misdating it", () => {
    const built = buildProviderHandoffMessages({
      thread: thread({
        messages: [message("m1", { createdAt: "2026-03-01T00:00:00.000Z" })],
        activities: [
          activity("a1", {
            kind: "context-compaction",
            tone: "info",
            summary: "Context compacted",
            createdAt: "2026-03-01T00:00:09.000Z",
          }),
        ],
      }),
    });

    expect(built[0]?.notices).toBeUndefined();
  });

  it("keeps an attachment-only message and names its files", () => {
    const built = buildProviderHandoffMessages({
      thread: thread({
        messages: [
          message("m1", {
            text: "",
            attachments: [
              {
                type: "image",
                id: "att1",
                name: "screenshot.png",
                mimeType: "image/png",
                sizeBytes: 10,
              },
            ],
          }),
        ],
      }),
    });

    expect(built[0]?.attachments).toEqual(["screenshot.png"]);
  });

  it("leaves out the message being sent this turn", () => {
    const built = buildProviderHandoffMessages({
      thread: thread({ messages: [message("m1"), message("m2")] }),
      excludeMessageId: MessageId.make("m2"),
    });

    expect(built.map((entry) => entry.id)).toEqual([MessageId.make("m1")]);
  });
});

describe("buildProviderHandoffChangedFiles", () => {
  function checkpoint(
    turn: string,
    files: ReadonlyArray<{ path: string; additions: number; deletions: number }>,
    status: OrchestrationCheckpointSummary["status"] = "ready",
  ): OrchestrationCheckpointSummary {
    return {
      turnId: TurnId.make(turn),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make(`refs/t3/${turn}`),
      status,
      files: files.map((file) => ({ ...file, kind: "modified" as const })),
      assistantMessageId: null,
      completedAt: "2026-03-01T00:00:00.000Z",
    };
  }

  it("adds churn across turns and counts how many touched each file", () => {
    const files = buildProviderHandoffChangedFiles(
      thread({
        checkpoints: [
          checkpoint("t1", [{ path: "src/a.ts", additions: 10, deletions: 2 }]),
          checkpoint("t2", [
            { path: "src/a.ts", additions: 5, deletions: 1 },
            { path: "src/b.ts", additions: 3, deletions: 0 },
          ]),
        ],
      }),
    );

    expect(files).toEqual([
      { path: "src/a.ts", additions: 15, deletions: 3, turns: 2 },
      { path: "src/b.ts", additions: 3, deletions: 0, turns: 1 },
    ]);
  });

  it("skips checkpoints whose diff did not come back cleanly", () => {
    const files = buildProviderHandoffChangedFiles(
      thread({
        checkpoints: [
          checkpoint("t1", [{ path: "src/a.ts", additions: 9, deletions: 9 }], "error"),
        ],
      }),
    );

    expect(files).toEqual([]);
  });
});

describe("buildProviderHandoffPlan", () => {
  it("takes the most recent plan, since a revision supersedes what it revised", () => {
    const plan = buildProviderHandoffPlan(
      thread({
        proposedPlans: [
          {
            id: "p1",
            turnId: null,
            planMarkdown: "old plan",
            implementedAt: null,
            implementationThreadId: null,
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
          {
            id: "p2",
            turnId: null,
            planMarkdown: "new plan",
            implementedAt: "2026-03-01T00:01:00.000Z",
            implementationThreadId: null,
            createdAt: "2026-03-01T00:01:00.000Z",
            updatedAt: "2026-03-01T00:01:00.000Z",
          },
        ],
      }),
    );

    expect(plan).toEqual({ markdown: "new plan", implemented: true });
  });

  it("reports no plan when none was proposed", () => {
    expect(buildProviderHandoffPlan(thread())).toBeNull();
  });
});

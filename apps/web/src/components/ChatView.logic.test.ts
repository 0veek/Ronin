import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { Thread, ThreadShell, TurnDiffSummary } from "../types";
import type { CodexArtifactTemplate } from "@t3tools/client-runtime/codex-artifact-templates";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type RightPanelSurface,
  pullRequestSurface,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import {
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "../previewMiniPlayerStore";
import {
  MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  agentControlledBrowserCloseConfirmation,
  branchMismatchKey,
  buildExpiredTerminalContextToastCopy,
  buildLoadingThreadFromShell,
  buildRunningThreadTurnInterruptInput,
  buildThreadTurnInterruptInput,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  deriveLockedProvider,
  deriveProviderSwitchBlockReason,
  dismissBranchMismatchForSession,
  ENVIRONMENT_RECONNECT_WARNING_GRACE_MS,
  getStartedThreadModelChangeBlockReason,
  loadVideoPreviewUrl,
  isVideoPreviewRequestCurrent,
  hasEnvironmentReconnectWarningGraceElapsed,
  hasServerAcknowledgedLocalDispatch,
  isBranchMismatchDismissedForSession,
  isProviderHandoff,
  providerInstanceLabel,
  reconcileMountedTerminalThreadIds,
  reconcileRetainedMountedThreadIds,
  resolveBackgroundDraftWorkspaceOptions,
  resolveDraftPromotionNavigationTarget,
  observeProactivePanelUserChoice,
  resolveProactiveTurnDiffAction,
  resolveThreadMetadataUpdateForNextTurn,
  resolveSendEnvMode,
  resolveDraftHeroState,
  scheduleEnvironmentReconnectWarning,
  startNewThreadForProject,
  codexArtifactTemplatePromptToAppend,
  shouldDockDraftHeroForSubmission,
  shouldReleaseTimelineAnchorForToolActivity,
  shouldOpenProactivePullRequest,
  shouldRetargetThreadPullRequestPanel,
  shouldOpenProactiveTurnDiff,
  shouldRefocusComposerOnWindowFocus,
  shouldRenderPreviewMiniPlayer,
  shouldShowBranchMismatchBanner,
  shouldShowPlanFollowUpPrompt,
  shouldWriteThreadErrorToCurrentServerThread,
} from "./ChatView.logic";

describe("agent browser close confirmation", () => {
  const surfaces = [
    { id: "browser:one", kind: "preview", resourceId: "tab-1" },
    { id: "browser:two", kind: "preview", resourceId: "tab-2" },
    { id: "diff", kind: "diff" },
  ] satisfies RightPanelSurface[];

  it("only warns for browsers under active agent control", () => {
    expect(
      agentControlledBrowserCloseConfirmation(surfaces, {
        "tab-1": { controller: "none" },
        "tab-2": { controller: "human" },
      }),
    ).toBeNull();

    expect(
      agentControlledBrowserCloseConfirmation([surfaces[0]!], {
        "tab-1": { controller: "agent" },
      }),
    ).toBe(
      [
        "Close browser while the agent is using it?",
        "The agent is actively controlling this browser. Closing it may interrupt the current browser action.",
      ].join("\n"),
    );
  });

  it("counts every agent-controlled browser in a bulk close", () => {
    expect(
      agentControlledBrowserCloseConfirmation(surfaces, {
        "tab-1": { controller: "agent" },
        "tab-2": { controller: "agent" },
      }),
    ).toContain("Close 2 browsers");
  });
});

describe("floating browser preview", () => {
  it("keeps agent preview intent when a user selects its browser tab and then switches away", () => {
    useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
    usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
    const ref = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-1"));
    const panels = useRightPanelStore.getState();
    const revision = panels.getUserActionRevision(ref);
    usePreviewMiniPlayerStore.getState().open(ref, "agent-tab");
    panels.reconcileBrowserSurfaces(ref, ["agent-tab"]);
    const intent = selectThreadPreviewMiniPlayer(
      usePreviewMiniPlayerStore.getState().byThreadKey,
      ref,
    );
    const isFloating = () =>
      shouldRenderPreviewMiniPlayer(
        selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, ref)
          ?.tabId ?? null,
        selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref),
      );

    panels.openProactive(ref, { id: "diff", kind: "diff" }, revision);
    expect(isFloating()).toBe(true);
    panels.activateSurface(ref, "browser:agent-tab");
    expect(isFloating()).toBe(false);
    expect(panels.openProactive(ref, { id: "diff", kind: "diff" }, revision)).toBe(false);
    panels.open(ref, "diff");
    expect(isFloating()).toBe(true);
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, ref),
    ).toBe(intent);
  });

  it("only hides the duplicate while the same browser is rendered in the panel", () => {
    expect(shouldRenderPreviewMiniPlayer(null, null)).toBe(false);
    expect(
      shouldRenderPreviewMiniPlayer("tab-1", {
        id: "browser:one",
        kind: "preview",
        resourceId: "tab-1",
      }),
    ).toBe(false);
    expect(
      shouldRenderPreviewMiniPlayer("tab-1", {
        id: "browser:two",
        kind: "preview",
        resourceId: "tab-2",
      }),
    ).toBe(true);
    expect(shouldRenderPreviewMiniPlayer("tab-1", { id: "diff", kind: "diff" })).toBe(true);
  });
});

describe("proactive panels", () => {
  it("keeps a manual PR selection made after following a replacement while loading", () => {
    useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
    const ref = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-1"));
    const panels = useRightPanelStore.getState();
    const oldPr = pullRequestSurface({
      projectId: "project-1",
      repository: "owner/repo",
      number: 1,
    });
    const replacement = pullRequestSurface({ ...oldPr, number: 2 });
    const turnId = TurnId.make("turn-1");
    panels.openPullRequest(ref, oldPr);
    const loading = observeProactivePanelUserChoice(null, {
      threadKey: "env-1:thread-1",
      runningTurnId: turnId,
      userActionRevision: panels.getUserActionRevision(ref),
    });
    expect(panels.openProactive(ref, replacement, loading.userActionRevision)).toBe(true);

    panels.activateSurface(ref, oldPr.id);
    const loaded = observeProactivePanelUserChoice(loading, {
      threadKey: loading.threadKey,
      runningTurnId: turnId,
      userActionRevision: panels.getUserActionRevision(ref),
    });
    expect(panels.openProactive(ref, replacement, loaded.userActionRevision)).toBe(false);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref)).toEqual(
      oldPr,
    );
    expect(shouldOpenProactivePullRequest(loaded.targetKey, "owner/repo:2")).toBe(true);
    expect(
      shouldOpenProactiveTurnDiff({
        previousRunningTurnId: loaded.runningTurnId,
        runningTurnId: null,
        settledTurnId: turnId,
        turnCompleted: true,
      }),
    ).toBe(true);
    expect(panels.openProactive(ref, { id: "diff", kind: "diff" }, loaded.userActionRevision)).toBe(
      false,
    );
  });

  it.each(["idle", "loading", "observed"] as const)(
    "captures a new turn's choice once with initial state %s",
    (initialState) => {
      useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
      const ref = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-1"));
      const panels = useRightPanelStore.getState();
      const firstTurn = TurnId.make("turn-1");
      const nextTurn = TurnId.make("turn-2");
      const initial = observeProactivePanelUserChoice(null, {
        threadKey: "env-1:thread-1",
        runningTurnId: initialState === "idle" ? null : firstTurn,
        userActionRevision: panels.getUserActionRevision(ref),
      });
      panels.openFile(ref, "src/first.ts");
      const loadingNextTurn = observeProactivePanelUserChoice(
        {
          ...initial,
          ...(initialState === "observed" ? { runningTurnId: firstTurn, targetKey: null } : {}),
        },
        {
          threadKey: initial.threadKey,
          runningTurnId: nextTurn,
          userActionRevision: panels.getUserActionRevision(ref),
        },
      );
      expect(
        panels.openProactive(ref, { id: "diff", kind: "diff" }, loadingNextTurn.userActionRevision),
      ).toBe(true);

      panels.openFile(ref, "src/second.ts");
      const loaded = observeProactivePanelUserChoice(loadingNextTurn, {
        threadKey: initial.threadKey,
        runningTurnId: nextTurn,
        userActionRevision: panels.getUserActionRevision(ref),
      });
      expect(
        panels.openProactive(ref, { id: "diff", kind: "diff" }, loaded.userActionRevision),
      ).toBe(false);
      expect(
        selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref)?.id,
      ).toBe("file:src/second.ts");
    },
  );

  it("opens an existing pull request on entry and follows newly observed links", () => {
    expect(shouldOpenProactivePullRequest(undefined, "project:repo:42")).toBe(true);
    expect(shouldOpenProactivePullRequest(undefined, null)).toBe(false);
    expect(shouldOpenProactivePullRequest(null, "project:repo:42")).toBe(true);
    expect(shouldOpenProactivePullRequest("project:repo:42", "project:repo:42")).toBe(false);
    expect(shouldOpenProactivePullRequest("project:repo:42", null)).toBe(false);
  });

  it("follows a changed server PR link without replacing an unrelated open panel", () => {
    const previous = {
      projectId: ProjectId.make("project-1"),
      repository: "pingdotgg/t3code",
      number: 42,
      url: "https://github.com/pingdotgg/t3code/pull/42",
    };
    const current = {
      ...previous,
      number: 43,
      url: "https://github.com/pingdotgg/t3code/pull/43",
    };
    const surface = {
      id: "pull-request:previous",
      kind: "pull-request",
      projectId: previous.projectId,
      repository: "PingDotGG/T3Code",
      number: previous.number,
    } satisfies RightPanelSurface;

    expect(shouldRetargetThreadPullRequestPanel(previous, current, surface)).toBe(true);
    expect(shouldRetargetThreadPullRequestPanel(previous, previous, surface)).toBe(false);
    expect(shouldRetargetThreadPullRequestPanel(previous, null, surface)).toBe(false);
    expect(
      shouldRetargetThreadPullRequestPanel(previous, current, { ...surface, number: 99 }),
    ).toBe(false);
    expect(
      shouldRetargetThreadPullRequestPanel(previous, current, {
        ...surface,
        projectId: "another-project",
      }),
    ).toBe(false);
  });

  it("opens a completed diff on entry or when the observed running turn settles", () => {
    const turnId = TurnId.make("turn-1");
    expect(
      shouldOpenProactiveTurnDiff({
        previousRunningTurnId: undefined,
        runningTurnId: null,
        settledTurnId: turnId,
        turnCompleted: true,
      }),
    ).toBe(true);
    expect(
      shouldOpenProactiveTurnDiff({
        previousRunningTurnId: turnId,
        runningTurnId: null,
        settledTurnId: turnId,
        turnCompleted: true,
      }),
    ).toBe(true);
    expect(
      shouldOpenProactiveTurnDiff({
        previousRunningTurnId: turnId,
        runningTurnId: TurnId.make("turn-2"),
        settledTurnId: turnId,
        turnCompleted: true,
      }),
    ).toBe(false);
    expect(
      shouldOpenProactiveTurnDiff({
        previousRunningTurnId: turnId,
        runningTurnId: null,
        settledTurnId: turnId,
        turnCompleted: false,
      }),
    ).toBe(false);
  });

  it("opens a completed turn with files in a git repo", () => {
    const changedCheckpoint = {
      status: "ready",
      files: [{ path: "src/app.ts", kind: "modified", additions: 1, deletions: 0 }],
    } satisfies Pick<TurnDiffSummary, "status" | "files">;
    const unchangedCheckpoint = {
      status: "ready",
      files: [],
    } satisfies Pick<TurnDiffSummary, "status" | "files">;

    expect(
      resolveProactiveTurnDiffAction({
        checkpoint: changedCheckpoint,
        isGitRepo: true,
      }),
    ).toBe("open");
    expect(
      resolveProactiveTurnDiffAction({
        checkpoint: unchangedCheckpoint,
        isGitRepo: true,
      }),
    ).toBe("ignore");
  });

  it("defers until the checkpoint and repo status are known", () => {
    const changedCheckpoint = {
      status: "ready",
      files: [{ path: "src/app.ts", kind: "modified", additions: 1, deletions: 0 }],
    } satisfies Pick<TurnDiffSummary, "status" | "files">;
    const missingCheckpoint = {
      status: "missing",
      files: [],
    } satisfies Pick<TurnDiffSummary, "status" | "files">;

    expect(
      resolveProactiveTurnDiffAction({
        checkpoint: undefined,
        isGitRepo: true,
      }),
    ).toBe("defer");
    expect(
      resolveProactiveTurnDiffAction({
        checkpoint: missingCheckpoint,
        isGitRepo: true,
      }),
    ).toBe("defer");
    expect(
      resolveProactiveTurnDiffAction({
        checkpoint: changedCheckpoint,
        isGitRepo: undefined,
      }),
    ).toBe("defer");
  });
});

describe("loadVideoPreviewUrl", () => {
  it("loads video bytes into an object URL", async () => {
    const objectUrl = await loadVideoPreviewUrl("data:video/mp4;base64,AA==");
    expect(objectUrl).toMatch(/^blob:/);
    URL.revokeObjectURL(objectUrl);
  });

  it("stops loading when the preview request is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadVideoPreviewUrl("data:video/mp4;base64,AA==", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("isVideoPreviewRequestCurrent", () => {
  it("rejects changed threads and replaced previews", () => {
    expect(isVideoPreviewRequestCurrent("thread-1", "thread-2", 1, 1)).toBe(false);
    expect(isVideoPreviewRequestCurrent("thread-1", "thread-1", 1, 2)).toBe(false);
    expect(isVideoPreviewRequestCurrent("thread-1", "thread-1", 2, 2)).toBe(true);
  });
});

const environmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");
const threadId = ThreadId.make("thread-1");
const now = "2026-03-29T00:00:00.000Z";
const helloWorldTemplate: CodexArtifactTemplate = {
  artifactKind: "document",
  displayName: "Hello World",
  skillDirectory: "/Users/test/.codex/skills/artifact-template-hello-world",
  skillName: "artifact-template-hello-world",
};

describe("artifact template composer insertion", () => {
  it("does not insert an already-present prompt", () => {
    const prompt = "Create a document using this $artifact-template-hello-world about…";

    expect(codexArtifactTemplatePromptToAppend(prompt, helloWorldTemplate)).toBeNull();
  });
});

describe("draft hero submission transition", () => {
  it("does not dock the composer before a background submission", () => {
    expect(
      shouldDockDraftHeroForSubmission({
        isDraftHeroState: true,
        activeThreadKey: "environment-local:thread-1",
        submissionIntent: "background",
      }),
    ).toBe(false);
  });

  it("keeps the composer in the hero layout until navigation after server promotion", () => {
    expect(
      resolveDraftHeroState({
        isLocalDraftThread: false,
        hasTimelineEntries: true,
        isWorking: true,
        draftHeroDockRequested: false,
        backgroundSubmissionPending: true,
      }),
    ).toBe(true);
  });

  it("does not auto-navigate a background submission after server promotion", () => {
    expect(
      resolveDraftPromotionNavigationTarget({
        serverThreadRef: { environmentId, threadId },
        serverThread: makeThread({ latestTurn: completedTurn }),
        backgroundSubmissionPending: true,
      }),
    ).toBeNull();
  });
});

describe("shouldReleaseTimelineAnchorForToolActivity", () => {
  const activeTurnId = TurnId.make("active-turn");
  const anchorMessageId = MessageId.make("anchored-message");
  const activeToolEntry = {
    id: "tool-entry",
    kind: "work" as const,
    createdAt: now,
    entry: {
      id: "active-tool",
      createdAt: now,
      turnId: activeTurnId,
      label: "Run command",
      tone: "tool" as const,
      command: "git status",
    },
  };

  it("releases the send anchor for tool activity in the active turn", () => {
    expect(
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId,
        liveFollowEnabled: true,
        runningTurnId: activeTurnId,
        timelineEntries: [activeToolEntry],
      }),
    ).toBe(true);
  });

  it("keeps the anchor while the user reads history", () => {
    expect(
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId,
        liveFollowEnabled: false,
        runningTurnId: activeTurnId,
        timelineEntries: [activeToolEntry],
      }),
    ).toBe(false);
  });

  it("ignores tool activity from earlier turns", () => {
    expect(
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId,
        liveFollowEnabled: true,
        runningTurnId: activeTurnId,
        timelineEntries: [
          {
            ...activeToolEntry,
            entry: {
              ...activeToolEntry.entry,
              turnId: TurnId.make("previous-turn"),
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("ignores thinking and error rows without tool activity", () => {
    expect(
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId,
        liveFollowEnabled: true,
        runningTurnId: activeTurnId,
        timelineEntries: [
          {
            ...activeToolEntry,
            entry: {
              id: "thinking-entry",
              createdAt: now,
              turnId: activeTurnId,
              label: "Thinking",
              tone: "thinking",
            },
          },
          {
            ...activeToolEntry,
            id: "error-entry",
            entry: {
              id: "error-entry",
              createdAt: now,
              turnId: activeTurnId,
              label: "Provider error",
              tone: "error",
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("does nothing without an anchor or running turn", () => {
    const input = {
      anchorMessageId,
      liveFollowEnabled: true,
      runningTurnId: activeTurnId,
      timelineEntries: [activeToolEntry],
    };

    expect(shouldReleaseTimelineAnchorForToolActivity({ ...input, anchorMessageId: null })).toBe(
      false,
    );
    expect(shouldReleaseTimelineAnchorForToolActivity({ ...input, runningTurnId: null })).toBe(
      false,
    );
  });
});

describe("environment reconnect warning grace", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a persistent reconnect after the grace period", () => {
    vi.useFakeTimers();
    const showWarning = vi.fn();

    scheduleEnvironmentReconnectWarning(showWarning);
    vi.advanceTimersByTime(ENVIRONMENT_RECONNECT_WARNING_GRACE_MS - 1);
    expect(showWarning).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(showWarning).toHaveBeenCalledOnce();
  });

  it("cancels the warning when the connection recovers during the grace period", () => {
    vi.useFakeTimers();
    const showWarning = vi.fn();

    const cancel = scheduleEnvironmentReconnectWarning(showWarning);
    cancel();
    vi.advanceTimersByTime(ENVIRONMENT_RECONNECT_WARNING_GRACE_MS);

    expect(showWarning).not.toHaveBeenCalled();
  });

  it("does not reuse elapsed grace from another environment", () => {
    const anotherEnvironmentId = EnvironmentId.make("environment-remote");

    expect(hasEnvironmentReconnectWarningGraceElapsed(environmentId, environmentId)).toBe(true);
    expect(hasEnvironmentReconnectWarningGraceElapsed(anotherEnvironmentId, environmentId)).toBe(
      false,
    );
  });
});

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: threadId,
    environmentId,
    projectId,
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

const completedTurn = {
  turnId: TurnId.make("turn-1"),
  state: "completed" as const,
  requestedAt: now,
  startedAt: "2026-03-29T00:00:01.000Z",
  completedAt: "2026-03-29T00:00:10.000Z",
  assistantMessageId: null,
};

const readySession = {
  threadId,
  status: "ready" as const,
  providerName: "codex",
  providerInstanceId: ProviderInstanceId.make("codex"),
  runtimeMode: "full-access" as const,
  activeTurnId: null,
  lastError: null,
  updatedAt: "2026-03-29T00:00:10.000Z",
};

describe("draft promotion during worktree setup", () => {
  const serverThreadRef = { environmentId, threadId };

  it.each([null, "idle", "starting", "ready"] as const)(
    "keeps the draft mounted while the first turn waits with session %s",
    (status) => {
      const serverThread = makeThread({
        messages: [
          {
            id: MessageId.make("submitted-message"),
            role: "user",
            text: "Start in a new worktree",
            turnId: null,
            createdAt: now,
            updatedAt: now,
            streaming: false,
          },
        ],
        session: status ? { ...readySession, status } : null,
      });

      expect(
        resolveDraftPromotionNavigationTarget({
          serverThreadRef,
          serverThread,
          backgroundSubmissionPending: false,
        }),
      ).toBeNull();
    },
  );

  it("promotes when the provider starts the first turn", () => {
    const latestTurn = { ...completedTurn, state: "running" as const, completedAt: null };

    expect(
      resolveDraftPromotionNavigationTarget({
        serverThreadRef,
        serverThread: makeThread({
          latestTurn,
          session: { ...readySession, status: "running", activeTurnId: latestTurn.turnId },
        }),
        backgroundSubmissionPending: false,
      }),
    ).toEqual(serverThreadRef);
  });

  it.each(["error", "stopped", "interrupted"] as const)(
    "promotes a startup that ends as %s before a turn starts",
    (status) => {
      expect(
        resolveDraftPromotionNavigationTarget({
          serverThreadRef,
          serverThread: makeThread({ session: { ...readySession, status } }),
          backgroundSubmissionPending: false,
        }),
      ).toEqual(serverThreadRef);
    },
  );
});

describe("buildLoadingThreadFromShell", () => {
  it("preserves shell metadata and supplies empty detail collections", () => {
    const shell = {
      environmentId,
      id: threadId,
      projectId,
      title: "Loading thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: null,
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      session: null,
      latestUserMessageAt: now,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    } satisfies ThreadShell;

    expect(buildLoadingThreadFromShell(shell)).toMatchObject({
      environmentId,
      id: threadId,
      projectId,
      title: "Loading thread",
      branch: "main",
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
    });
  });
});

describe("resolveThreadMetadataUpdateForNextTurn", () => {
  const modelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  };

  it("updates a stale local thread branch to the active checkout", () => {
    expect(
      resolveThreadMetadataUpdateForNextTurn({
        currentModelSelection: modelSelection,
        currentBranch: "feature/thread",
        nextBranch: "feature/checkout",
      }),
    ).toEqual({ branch: "feature/checkout", worktreePath: null });
  });

  it("does not write metadata when the model and branch are unchanged", () => {
    expect(
      resolveThreadMetadataUpdateForNextTurn({
        currentModelSelection: modelSelection,
        nextModelSelection: modelSelection,
        currentBranch: "feature/current",
        nextBranch: "feature/current",
      }),
    ).toBeNull();
  });
});

describe("buildThreadTurnInterruptInput", () => {
  it("targets the session's active running turn", () => {
    const activeTurnId = TurnId.make("turn-running");

    expect(
      buildThreadTurnInterruptInput(
        makeThread({
          session: {
            ...readySession,
            status: "running",
            activeTurnId,
          },
        }),
      ),
    ).toEqual({ threadId, turnId: activeTurnId });
  });

  it("omits a turn id when the session is not running", () => {
    expect(buildThreadTurnInterruptInput(makeThread({ session: readySession }))).toEqual({
      threadId,
    });
  });

  it("omits a turn id when a running session has not projected its active turn yet", () => {
    expect(
      buildThreadTurnInterruptInput(
        makeThread({ session: { ...readySession, status: "running", activeTurnId: null } }),
      ),
    ).toEqual({ threadId });
  });
});

describe("buildRunningThreadTurnInterruptInput", () => {
  it("targets only a running thread", () => {
    const activeTurnId = TurnId.make("turn-running");
    const running = makeThread({
      session: { ...readySession, status: "running", activeTurnId },
    });
    expect(buildRunningThreadTurnInterruptInput(running, "running")).toEqual({
      threadId,
      turnId: activeTurnId,
    });
    expect(buildRunningThreadTurnInterruptInput(running, "ready")).toBeNull();
    expect(buildRunningThreadTurnInterruptInput(null, "disconnected")).toBeNull();
  });
});

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId,
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: now,
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId,
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: now,
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });

  it("treats element contexts as sendable content (no text, no images, no terminals)", () => {
    const state = deriveComposerSendState({
      prompt: "",
      imageCount: 0,
      terminalContexts: [],
      elementContextCount: 1,
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.expiredTerminalContextCount).toBe(0);
    expect(state.hasSendableContent).toBe(true);
  });

  it("does NOT treat zero element contexts as sendable", () => {
    expect(
      deriveComposerSendState({
        prompt: "",
        imageCount: 0,
        terminalContexts: [],
        elementContextCount: 0,
      }).hasSendableContent,
    ).toBe(false);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats empty and omission guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("getStartedThreadModelChangeBlockReason", () => {
  const providers = [
    {
      instanceId: ProviderInstanceId.make("codex"),
    },
    {
      instanceId: ProviderInstanceId.make("grok"),
      requiresNewThreadForModelChange: true,
    },
  ];

  it("allows model changes before a provider session has started", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: false,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-other",
        },
      }),
    ).toBeNull();
  });

  it("allows unchanged model selections for restricted providers", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
      }),
    ).toBeNull();
  });

  it("blocks started-session model changes when either provider requires a new thread", () => {
    expect(
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        currentModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        nextModelSelection: {
          instanceId: ProviderInstanceId.make("grok"),
          model: "grok-build",
        },
      }),
    ).toEqual({
      title: "Start a new chat to change models",
      description:
        "This provider does not allow switching models after a conversation has started.",
    });
  });
});

describe("deriveLockedProvider", () => {
  it("locks a started thread to the provider its live session is on", () => {
    expect(
      deriveLockedProvider({
        thread: makeThread({ session: readySession }),
        selectedProvider: "grok",
        threadProvider: null,
        providers: [],
      }),
    ).toBe("codex");
  });

  it("stops speaking for a session that was retired by a provider switch", () => {
    // After a switch the outgoing session lingers as `stopped` until the
    // incoming provider binds; reading it would keep the picker pointed at
    // the provider the user just left.
    expect(
      deriveLockedProvider({
        thread: makeThread({
          session: { ...readySession, status: "stopped" },
          latestTurn: completedTurn,
        }),
        selectedProvider: "grok",
        threadProvider: null,
        providers: [],
      }),
    ).toBe("grok");
  });

  // Imported history carries a custom instance id and has no session until its
  // first prompt, so the lock has to go through the environment's catalog.
  it("resolves a custom instance id through the provider catalog", () => {
    expect(
      deriveLockedProvider({
        thread: makeThread({ latestTurn: completedTurn }),
        selectedProvider: "codex",
        threadProvider: "claude_work",
        providers: [
          {
            instanceId: ProviderInstanceId.make("claude_work"),
            driver: ProviderDriverKind.make("claudeAgent"),
          },
        ],
      }),
    ).toBe("claudeAgent");
  });

  // A missing instance must not hand the thread to whatever the picker happens
  // to show; the lock keeps naming the instance until the catalog explains it.
  it("does not fall back to the selected driver when its instance left the catalog", () => {
    expect(
      deriveLockedProvider({
        thread: makeThread({ latestTurn: completedTurn }),
        selectedProvider: "codex",
        threadProvider: "claude_work",
        providers: [],
      }),
    ).not.toBe("codex");
  });
});

describe("deriveProviderSwitchBlockReason", () => {
  it("never blocks a thread that has not started", () => {
    expect(
      deriveProviderSwitchBlockReason({ thread: makeThread(), hasOpenBlockingRequest: true }),
    ).toBeNull();
  });

  it("blocks while a turn is in flight", () => {
    for (const status of ["starting", "running"] as const) {
      expect(
        deriveProviderSwitchBlockReason({
          thread: makeThread({ session: { ...readySession, status } }),
          hasOpenBlockingRequest: false,
        }),
      ).toBe("Interrupt the current turn before switching providers.");
    }
  });

  it("blocks while a request is waiting on the user", () => {
    expect(
      deriveProviderSwitchBlockReason({
        thread: makeThread({ session: readySession }),
        hasOpenBlockingRequest: true,
      }),
    ).toBe("Answer the pending request before switching providers.");
  });

  it("allows the switch on a settled started thread", () => {
    expect(
      deriveProviderSwitchBlockReason({
        thread: makeThread({ session: readySession, latestTurn: completedTurn }),
        hasOpenBlockingRequest: false,
      }),
    ).toBeNull();
  });
});

describe("isProviderHandoff", () => {
  const providers = [
    {
      instanceId: ProviderInstanceId.make("codex"),
      driver: ProviderDriverKind.make("codex"),
      continuation: { groupKey: "codex:home:/home/user/.codex" },
    },
    {
      instanceId: ProviderInstanceId.make("codex_work"),
      driver: ProviderDriverKind.make("codex"),
      continuation: { groupKey: "codex:home:/home/user/.codex" },
    },
    {
      instanceId: ProviderInstanceId.make("codex_isolated"),
      driver: ProviderDriverKind.make("codex"),
      continuation: { groupKey: "codex:home:/home/user/.codex-isolated" },
    },
    {
      instanceId: ProviderInstanceId.make("grok"),
      driver: ProviderDriverKind.make("grok"),
      continuation: { groupKey: "grok:instance:grok" },
    },
  ];

  it("is not a handoff without a current binding or when the instance is unchanged", () => {
    expect(isProviderHandoff({ providers, currentInstanceId: null, nextInstanceId: "grok" })).toBe(
      false,
    );
    expect(
      isProviderHandoff({ providers, currentInstanceId: "codex", nextInstanceId: "codex" }),
    ).toBe(false);
  });

  it("is not a handoff between instances that can resume each other", () => {
    expect(
      isProviderHandoff({ providers, currentInstanceId: "codex", nextInstanceId: "codex_work" }),
    ).toBe(false);
  });

  it("is a handoff across drivers and across continuation groups", () => {
    expect(
      isProviderHandoff({ providers, currentInstanceId: "codex", nextInstanceId: "grok" }),
    ).toBe(true);
    expect(
      isProviderHandoff({
        providers,
        currentInstanceId: "codex",
        nextInstanceId: "codex_isolated",
      }),
    ).toBe(true);
  });

  it("treats an unresolvable instance as a handoff", () => {
    expect(
      isProviderHandoff({ providers, currentInstanceId: "retired", nextInstanceId: "codex" }),
    ).toBe(true);
  });
});

describe("providerInstanceLabel", () => {
  const providers = [
    { instanceId: ProviderInstanceId.make("codex"), displayName: "Codex" },
    { instanceId: ProviderInstanceId.make("codex_work"), displayName: undefined },
  ];

  it("prefers the configured display name and falls back to the routing key", () => {
    expect(providerInstanceLabel(providers, "codex")).toBe("Codex");
    expect(providerInstanceLabel(providers, "codex_work")).toBe("codex_work");
    expect(providerInstanceLabel(providers, "unknown")).toBe("unknown");
    expect(providerInstanceLabel(providers, null)).toBe("the current provider");
  });
});

describe("resolveSendEnvMode", () => {
  it("keeps worktree mode only for git repositories", () => {
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: true })).toBe("worktree");
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: false })).toBe("local");
  });
});

describe("resolveBackgroundDraftWorkspaceOptions", () => {
  it("keeps New worktree selected without reusing the launched worktree", () => {
    expect(
      resolveBackgroundDraftWorkspaceOptions({
        envMode: "worktree",
        branch: "main",
        startFromOrigin: true,
      }),
    ).toEqual({
      envMode: "worktree",
      branch: "main",
      worktreePath: null,
      startFromOrigin: true,
    });
  });
});

describe("branchMismatchKey", () => {
  it("builds a key from thread id and both branches", () => {
    expect(branchMismatchKey("thread-1", { threadBranch: "feat/a", currentBranch: "feat/b" })).toBe(
      "thread-1:feat/a:feat/b",
    );
  });

  it("returns null without a thread or mismatch", () => {
    expect(branchMismatchKey(null, { threadBranch: "a", currentBranch: "b" })).toBeNull();
    expect(branchMismatchKey("thread-1", null)).toBeNull();
  });
});

describe("shouldShowBranchMismatchBanner", () => {
  const base = {
    hasMismatch: true,
    isDismissed: false,
    composerHasContent: false,
    wasShownForCurrentMismatch: false,
  };

  it("stays hidden during passive browsing (even though the composer autofocuses)", () => {
    expect(shouldShowBranchMismatchBanner(base)).toBe(false);
  });

  it("shows once the composer has draft content", () => {
    expect(shouldShowBranchMismatchBanner({ ...base, composerHasContent: true })).toBe(true);
  });

  it("stays mounted after the draft clears once shown for the current mismatch", () => {
    expect(shouldShowBranchMismatchBanner({ ...base, wasShownForCurrentMismatch: true })).toBe(
      true,
    );
  });

  it("never shows when dismissed or without a mismatch", () => {
    expect(
      shouldShowBranchMismatchBanner({ ...base, composerHasContent: true, isDismissed: true }),
    ).toBe(false);
    expect(
      shouldShowBranchMismatchBanner({ ...base, composerHasContent: true, hasMismatch: false }),
    ).toBe(false);
  });
});

describe("shouldShowPlanFollowUpPrompt", () => {
  const base = {
    pendingUserInputCount: 0,
    interactionMode: "plan" as const,
    latestTurnSettled: true,
    hasActionableProposedPlan: true,
    hasComposerAttachments: false,
  };

  it("shows plan actions for a settled actionable plan without attachments", () => {
    expect(shouldShowPlanFollowUpPrompt(base)).toBe(true);
  });

  it("hides plan actions while the composer has staged attachments", () => {
    expect(shouldShowPlanFollowUpPrompt({ ...base, hasComposerAttachments: true })).toBe(false);
  });

  it("preserves the existing plan follow-up gates", () => {
    expect(shouldShowPlanFollowUpPrompt({ ...base, pendingUserInputCount: 1 })).toBe(false);
    expect(shouldShowPlanFollowUpPrompt({ ...base, interactionMode: "default" })).toBe(false);
    expect(shouldShowPlanFollowUpPrompt({ ...base, latestTurnSettled: false })).toBe(false);
    expect(shouldShowPlanFollowUpPrompt({ ...base, hasActionableProposedPlan: false })).toBe(false);
  });
});

describe("session branch mismatch dismissal", () => {
  it("tracks dismissed keys and treats other keys as active", () => {
    expect(isBranchMismatchDismissedForSession("t1:a:b")).toBe(false);
    dismissBranchMismatchForSession("t1:a:b");
    expect(isBranchMismatchDismissedForSession("t1:a:b")).toBe(true);
    expect(isBranchMismatchDismissedForSession("t1:a:c")).toBe(false);
    expect(isBranchMismatchDismissedForSession(null)).toBe(false);
  });
});

describe("reconcileMountedTerminalThreadIds", () => {
  it("keeps open threads and makes the active thread most recent", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: ["thread-a", "thread-b", "thread-c"],
        openThreadIds: ["thread-a", "thread-b", "thread-c"],
        activeThreadId: "thread-a",
        activeThreadTerminalOpen: true,
        maxHiddenThreadCount: 2,
      }),
    ).toEqual(["thread-b", "thread-c", "thread-a"]);
  });

  it("drops closed threads and enforces the hidden mounted cap", () => {
    const ids = Array.from(
      { length: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS + 2 },
      (_, index) => `thread-${index}`,
    );
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: ids,
        openThreadIds: ids.slice(1),
        activeThreadId: null,
        activeThreadTerminalOpen: false,
      }),
    ).toEqual(ids.slice(-MAX_HIDDEN_MOUNTED_TERMINAL_THREADS));
  });
});

describe("reconcileRetainedMountedThreadIds", () => {
  it("retains hidden open threads and adds the active open thread", () => {
    expect(
      reconcileRetainedMountedThreadIds({
        currentThreadIds: [ThreadId.make("thread-hidden")],
        openThreadIds: [ThreadId.make("thread-hidden")],
        activeThreadId: ThreadId.make("thread-active"),
        activeThreadOpen: true,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
      }),
    ).toEqual([ThreadId.make("thread-hidden"), ThreadId.make("thread-active")]);
  });

  it("can retain the active thread as hidden when it is inactive", () => {
    expect(
      reconcileRetainedMountedThreadIds({
        currentThreadIds: [ThreadId.make("thread-active")],
        openThreadIds: [ThreadId.make("thread-active")],
        activeThreadId: ThreadId.make("thread-active"),
        activeThreadOpen: false,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
        retainInactiveActiveThread: true,
      }),
    ).toEqual([ThreadId.make("thread-active")]);
  });

  it("evicts the oldest hidden threads beyond the configured cap", () => {
    const currentThreadIds = Array.from(
      { length: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS + 2 },
      (_, index) => ThreadId.make(`thread-${index + 1}`),
    );

    expect(
      reconcileRetainedMountedThreadIds({
        currentThreadIds,
        openThreadIds: currentThreadIds,
        activeThreadId: null,
        activeThreadOpen: false,
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_PREVIEW_THREADS,
      }),
    ).toEqual(currentThreadIds.slice(-MAX_HIDDEN_MOUNTED_PREVIEW_THREADS));
  });
});

describe("shouldWriteThreadErrorToCurrentServerThread", () => {
  it("writes errors for a shell-derived active server thread", () => {
    const routeThreadRef = { environmentId, threadId };

    expect(
      shouldWriteThreadErrorToCurrentServerThread({
        activeServerThread: { environmentId, id: threadId },
        routeThreadRef,
        targetThreadId: threadId,
      }),
    ).toBe(true);
  });

  it("requires an active server thread matching the environment, route, and target", () => {
    const routeThreadRef = { environmentId, threadId };

    expect(
      shouldWriteThreadErrorToCurrentServerThread({
        activeServerThread: null,
        routeThreadRef,
        targetThreadId: threadId,
      }),
    ).toBe(false);
  });
});

describe("startNewThreadForProject", () => {
  it("starts a thread through the supplied shared handler for the active project", () => {
    const calls: Array<{ environmentId: EnvironmentId; projectId: ProjectId }> = [];
    const projectRef = { environmentId, projectId };

    expect(
      startNewThreadForProject(projectRef, (nextProjectRef) => {
        calls.push(nextProjectRef);
        return Promise.resolve();
      }),
    ).toBe(true);
    expect(calls).toEqual([projectRef]);
  });

  it("does nothing when the active project is unavailable", () => {
    let called = false;

    expect(
      startNewThreadForProject(null, () => {
        called = true;
        return Promise.resolve();
      }),
    ).toBe(false);
    expect(called).toBe(false);
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  it("does not acknowledge unchanged server state", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: completedTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: readySession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("keeps a follow-up active while its provider session is starting", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "connecting",
        latestTurn: completedTurn,
        latestUserMessageId: MessageId.make("message-followup"),
        session: {
          ...readySession,
          status: "starting",
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("acknowledges a settled newer turn", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );
    const newerTurn = {
      ...completedTurn,
      turnId: TurnId.make("turn-2"),
      requestedAt: "2026-03-29T00:01:00.000Z",
      startedAt: "2026-03-29T00:01:01.000Z",
      completedAt: "2026-03-29T00:01:30.000Z",
    };

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: newerTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: { ...readySession, updatedAt: newerTurn.completedAt },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("waits for the matching running turn before acknowledging", () => {
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({ latestTurn: completedTurn, session: readySession }),
    );
    const runningTurn = {
      ...completedTurn,
      turnId: TurnId.make("turn-2"),
      state: "running" as const,
      requestedAt: "2026-03-29T00:01:00.000Z",
      startedAt: "2026-03-29T00:01:01.000Z",
      completedAt: null,
    };

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: {
          ...readySession,
          status: "running",
          activeTurnId: TurnId.make("turn-other"),
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: localDispatch.latestUserMessageId,
        session: {
          ...readySession,
          status: "running",
          activeTurnId: runningTurn.turnId,
        },
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("acknowledges a steering message projected onto the current running turn", () => {
    const runningTurn = {
      ...completedTurn,
      state: "running" as const,
      completedAt: null,
    };
    const runningSession = {
      ...readySession,
      status: "running" as const,
      activeTurnId: runningTurn.turnId,
    };
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        latestTurn: runningTurn,
        session: runningSession,
        messages: [
          {
            id: MessageId.make("message-before-steer"),
            role: "user",
            text: "Initial prompt",
            turnId: runningTurn.turnId,
            createdAt: runningTurn.requestedAt,
            updatedAt: runningTurn.requestedAt,
            streaming: false,
          },
        ],
      }),
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: runningTurn,
        latestUserMessageId: MessageId.make("message-steer"),
        session: runningSession,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("acknowledges pending user interaction and errors immediately", () => {
    const localDispatch = createLocalDispatchSnapshot(makeThread());
    const common = {
      localDispatch,
      phase: "ready" as const,
      latestTurn: null,
      latestUserMessageId: localDispatch.latestUserMessageId,
      session: null,
      hasPendingApproval: false,
      hasPendingUserInput: false,
      threadError: null,
    };

    expect(hasServerAcknowledgedLocalDispatch({ ...common, hasPendingApproval: true })).toBe(true);
    expect(hasServerAcknowledgedLocalDispatch({ ...common, hasPendingUserInput: true })).toBe(true);
    expect(
      hasServerAcknowledgedLocalDispatch({
        ...common,
        latestTurnStartFailureId: "turn-start-failure-1",
      }),
    ).toBe(true);
    expect(hasServerAcknowledgedLocalDispatch({ ...common, threadError: "failed" })).toBe(true);
  });

  it("acknowledges only a new turn-start failure", () => {
    const localDispatch = {
      ...createLocalDispatchSnapshot(makeThread()),
      latestTurnStartFailureId: "turn-start-failure-old",
    };
    const common = {
      localDispatch,
      phase: "ready" as const,
      latestTurn: null,
      latestUserMessageId: localDispatch.latestUserMessageId,
      session: null,
      hasPendingApproval: false,
      hasPendingUserInput: false,
      threadError: null,
    };

    expect(
      hasServerAcknowledgedLocalDispatch({
        ...common,
        latestTurnStartFailureId: "turn-start-failure-old",
      }),
    ).toBe(false);
    expect(
      hasServerAcknowledgedLocalDispatch({
        ...common,
        latestTurnStartFailureId: "turn-start-failure-new",
      }),
    ).toBe(true);
  });
});

describe("shouldRefocusComposerOnWindowFocus", () => {
  function element(
    tagName: string,
    options?: { editable?: boolean; role?: string; within?: string },
  ) {
    return {
      tagName,
      isContentEditable: options?.editable ?? false,
      getAttribute: (name: string) => (name === "role" ? (options?.role ?? null) : null),
      closest: (selector: string) =>
        options?.within !== undefined && selector.includes(options.within) ? ({} as Element) : null,
    };
  }

  it("refocuses when nothing or the body holds focus", () => {
    expect(shouldRefocusComposerOnWindowFocus(null)).toBe(true);
    expect(shouldRefocusComposerOnWindowFocus(element("BODY"))).toBe(true);
  });

  it("refocuses away from a plain button, such as a pull request tab", () => {
    expect(shouldRefocusComposerOnWindowFocus(element("BUTTON"))).toBe(true);
  });

  it("leaves other text fields alone", () => {
    expect(shouldRefocusComposerOnWindowFocus(element("INPUT"))).toBe(false);
    expect(shouldRefocusComposerOnWindowFocus(element("TEXTAREA"))).toBe(false);
    expect(shouldRefocusComposerOnWindowFocus(element("DIV", { editable: true }))).toBe(false);
    expect(shouldRefocusComposerOnWindowFocus(element("DIV", { role: "textbox" }))).toBe(false);
  });

  it("leaves a focused terminal alone in the drawer and the right panel", () => {
    expect(
      shouldRefocusComposerOnWindowFocus(element("BUTTON", { within: "data-terminal-owner" })),
    ).toBe(false);
  });

  it("leaves focus inside a dialog or popup alone", () => {
    expect(shouldRefocusComposerOnWindowFocus(element("BUTTON", { within: "dialog" }))).toBe(false);
    expect(shouldRefocusComposerOnWindowFocus(element("BUTTON", { within: "-popup" }))).toBe(false);
  });
});

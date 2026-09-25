import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  type KeybindingCommand,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { Thread } from "../types";
import {
  browseInputEndPaddingClass,
  buildBrowseGroups,
  buildCommandPaletteProjectMetadata,
  buildThreadActionItems,
  buildLinkedThreadActionItems,
  enumerateCommandPaletteItems,
  filterPinnedBrowseEntries,
  filterCommandPaletteGroups,
  reduceCommandPaletteUiState,
  type CommandPaletteGroup,
  WORKSPACE_COMMANDS,
} from "./CommandPalette.logic";

describe("browseInputEndPaddingClass", () => {
  it("reserves the widest space for the create action", () => {
    expect(
      browseInputEndPaddingClass({
        willCreateProjectPath: true,
        hasHighlightedBrowseItem: false,
      }),
    ).toContain("pe-38");
  });

  it("reserves space for the wider highlighted-item shortcut", () => {
    expect(
      browseInputEndPaddingClass({
        willCreateProjectPath: false,
        hasHighlightedBrowseItem: true,
      }),
    ).toContain("pe-30");
  });

  it("keeps the compact reserve for the normal add action", () => {
    expect(
      browseInputEndPaddingClass({
        willCreateProjectPath: false,
        hasHighlightedBrowseItem: false,
      }),
    ).toContain("pe-24");
  });
});

describe("linked pull request thread navigation", () => {
  it("keeps archived relations searchable and routes them through the PR environment", async () => {
    const environmentId = EnvironmentId.make("remote");
    const id = ThreadId.make("archived-thread");
    const runThread = vi.fn(async () => {});
    const query = "https://github.com/acme/web/pull/42";
    const linkedThreads = {
      environmentId,
      threads: [
        {
          id,
          projectId: ProjectId.make("project"),
          title: "Completed work",
          archivedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    };
    const state = reduceCommandPaletteUiState(
      { open: false, mode: "command", openIntent: null },
      {
        _tag: "OpenSearch",
        query,
        linkedThreads,
      },
    );
    expect(state.openIntent).toEqual({ kind: "search", query, linkedThreads });
    const items = buildLinkedThreadActionItems({ ...linkedThreads, query, icon: null, runThread });
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query,
      isInSubmenu: false,
      projectSearchItems: [],
      settingsSearchItems: [],
      threadSearchItems: items,
    });
    expect(groups.flatMap((group) => group.items)).toEqual(items);
    expect(items[0]?.description).toBe("Archived thread");
    await items[0]?.run();
    expect(runThread).toHaveBeenCalledWith({ environmentId, id });
  });
});

describe("buildCommandPaletteProjectMetadata", () => {
  const localEnvironmentId = EnvironmentId.make("environment-local");
  const remoteEnvironmentId = EnvironmentId.make("environment-build-box");
  const locations = new Map([
    [localEnvironmentId, { kind: "local" as const, label: "Local", machine: "laptop" as const }],
    [
      remoteEnvironmentId,
      { kind: "remote" as const, label: "Build box", machine: "server" as const },
    ],
  ]);

  it("makes every member environment and path searchable", () => {
    const metadata = buildCommandPaletteProjectMetadata({
      projects: [
        {
          environmentId: localEnvironmentId,
          title: "T3 Code",
          workspaceRoot: "/Users/theo/Projects/t3code",
        },
        {
          environmentId: remoteEnvironmentId,
          title: "t3code",
          workspaceRoot: "/srv/t3code",
        },
      ],
      locationByEnvironmentId: locations,
    });

    expect(metadata.searchTerms).toEqual([
      "T3 Code",
      "/Users/theo/Projects/t3code",
      "Local",
      "t3code",
      "/srv/t3code",
      "Build box",
    ]);
    expect(metadata.environmentLabels).toEqual(["Local", "Build box"]);

    const [filteredGroup] = filterCommandPaletteGroups({
      activeGroups: [],
      query: "build box",
      isInSubmenu: false,
      projectSearchItems: [
        {
          kind: "action",
          value: "project:t3code",
          title: "T3 Code",
          searchTerms: metadata.searchTerms,
          icon: null,
          run: async () => undefined,
        },
      ],
      threadSearchItems: [],
    });
    expect(filteredGroup?.items).toHaveLength(1);
  });

  it("deduplicates grouped checkouts by environment", () => {
    const metadata = buildCommandPaletteProjectMetadata({
      projects: [
        {
          environmentId: remoteEnvironmentId,
          title: "T3 Code",
          workspaceRoot: "/srv/t3code",
        },
        {
          environmentId: remoteEnvironmentId,
          title: "T3 Code worktree",
          workspaceRoot: "/srv/t3code-feature",
        },
      ],
      locationByEnvironmentId: locations,
    });

    expect(metadata.environmentLabels).toEqual(["Build box"]);
  });

  it("deduplicates distinct environments with the same label", () => {
    const secondRemoteEnvironmentId = EnvironmentId.make("environment-build-box-2");
    const metadata = buildCommandPaletteProjectMetadata({
      projects: [
        {
          environmentId: remoteEnvironmentId,
          title: "T3 Code",
          workspaceRoot: "/srv/t3code",
        },
        {
          environmentId: secondRemoteEnvironmentId,
          title: "T3 Code mirror",
          workspaceRoot: "/srv/mirror/t3code",
        },
      ],
      locationByEnvironmentId: new Map([
        [remoteEnvironmentId, { label: "Build box" }],
        [secondRemoteEnvironmentId, { label: "Build box" }],
      ]),
    });

    expect(metadata.environmentLabels).toEqual(["Build box"]);
  });

  it("uses a human-readable fallback when presentation data is unavailable", () => {
    const metadata = buildCommandPaletteProjectMetadata({
      projects: [
        {
          environmentId: remoteEnvironmentId,
          title: "T3 Code",
          workspaceRoot: "/srv/t3code",
        },
      ],
      locationByEnvironmentId: new Map(),
    });

    expect(metadata.searchTerms).toContain("Remote");
    expect(metadata.environmentLabels).toEqual(["Remote"]);
  });
});

describe("reduceCommandPaletteUiState", () => {
  const closedState = { open: false, mode: "command", openIntent: null } as const;

  it("toggles each overlay mode open and closed", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(filesOpen).toEqual({ open: true, mode: "files", openIntent: null });

    const contentOpen = reduceCommandPaletteUiState(filesOpen, {
      _tag: "ToggleMode",
      mode: "content",
    });
    expect(contentOpen).toEqual({ open: true, mode: "content", openIntent: null });

    expect(
      reduceCommandPaletteUiState(contentOpen, { _tag: "ToggleMode", mode: "content" }),
    ).toEqual({ open: false, mode: "content", openIntent: null });
  });

  it("switches between open modes without closing", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "ToggleMode", mode: "command" })).toEqual(
      {
        open: true,
        mode: "command",
        openIntent: null,
      },
    );
  });

  it("opens PR search from another overlay and replaces an earlier search", () => {
    const first = reduceCommandPaletteUiState(
      { open: true, mode: "files", openIntent: null },
      {
        _tag: "OpenSearch",
        query: "https://github.com/acme/web/pull/7",
      },
    );
    expect(first).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "search", query: "https://github.com/acme/web/pull/7" },
    });
    const second = reduceCommandPaletteUiState(first, {
      _tag: "OpenSearch",
      query: "https://github.com/acme/web/pull/8",
    });
    expect(second.openIntent).toEqual({
      kind: "search",
      query: "https://github.com/acme/web/pull/8",
    });
    expect(
      reduceCommandPaletteUiState(second, { _tag: "SetOpen", open: false }).openIntent,
    ).toBeNull();
  });

  it("routes open intents to command mode", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "OpenAddProject" })).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "add-project" },
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "OpenNewThreadIn" })).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "new-thread-in" },
    });
  });

  it("preserves the mode on close and resets it on open", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });

    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "SetOpen", open: false })).toEqual({
      open: false,
      mode: "files",
      openIntent: null,
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "SetOpen", open: true })).toEqual({
      open: true,
      mode: "command",
      openIntent: null,
    });
  });
});

describe("enumerateCommandPaletteItems", () => {
  it("assigns positional jump shortcuts to the first nine displayed items", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      kind: "action" as const,
      value: `project-${index + 1}`,
      searchTerms: [],
      title: `Project ${index + 1}`,
      icon: null,
      shortcutCommand: "chat.new" as const,
      run: async () => undefined,
    }));

    expect(enumerateCommandPaletteItems(items).map((item) => item.shortcutCommand)).toEqual([
      "thread.jump.1",
      "thread.jump.2",
      "thread.jump.3",
      "thread.jump.4",
      "thread.jump.5",
      "thread.jump.6",
      "thread.jump.7",
      "thread.jump.8",
      "thread.jump.9",
      undefined,
    ]);
  });
});

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: LOCAL_ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    checkpoints: [],
    pullRequests: [],
    activities: [],
    ...overrides,
  };
}

describe("buildThreadActionItems", () => {
  it("orders threads by most recent activity and formats timestamps from updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));

    try {
      const items = buildThreadActionItems({
        threads: [
          makeThread({
            id: ThreadId.make("thread-older"),
            title: "Older thread",
            updatedAt: "2026-03-24T12:00:00.000Z",
          }),
          makeThread({
            id: ThreadId.make("thread-newer"),
            title: "Newer thread",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          }),
        ],
        projectTitleById: new Map([[PROJECT_ID, "Project"]]),
        sortOrder: "updated_at",
        icon: null,
        runThread: async (_thread) => undefined,
      });

      expect(items.map((item) => item.value)).toEqual([
        "thread:thread-older",
        "thread:thread-newer",
      ]);
      expect(items[0]?.timestamp).toBe("1d ago");
      expect(items[1]?.timestamp).toBe("5d ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ranks thread title matches ahead of contextual project-name matches", () => {
    const threadItems = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-context-match"),
          title: "Fix navbar spacing",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-title-match"),
          title: "Project kickoff notes",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("threads-search");
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:thread-title-match",
      "thread:thread-context-match",
    ]);
  });

  it("orders title matches by recent activity before older prefix matches", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("old-prefix"),
        title: "Convex InvalidCursor in Convex threads query",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("recent-title"),
        title: "Disable Convex schema validation",
        createdAt: "2025-12-01T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("recent-content"),
        title: "Fix schema validation",
        createdAt: "2026-03-25T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
      }),
    ];
    const items = buildThreadActionItems({
      threads,
      projectTitleById: new Map([[PROJECT_ID, "T3 Code"]]),
      sortOrder: "created_at",
      icon: null,
      getContentMatch: (thread) =>
        thread.id === ThreadId.make("recent-content")
          ? { source: "user", snippet: "Please check Convex", query: "convex" }
          : undefined,
      runThread: async () => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "convex",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: items,
    });

    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:recent-title",
      "thread:old-prefix",
      "thread:recent-content",
    ]);
  });

  it("preserves thread project-name matches when there is no stronger title match", () => {
    const group: CommandPaletteGroup = {
      value: "threads-search",
      label: "Threads",
      items: [
        {
          kind: "action",
          value: "thread:project-context-only",
          searchTerms: ["Fix navbar spacing", "Project"],
          title: "Fix navbar spacing",
          description: "Project",
          icon: null,
          run: async () => undefined,
        },
      ],
    };

    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["thread:project-context-only"]);
  });

  it("keeps message excerpts searchable without replacing thread metadata", () => {
    const [item] = buildThreadActionItems({
      threads: [makeThread({ branch: "feat/search" })],
      projectTitleById: new Map([[PROJECT_ID, "Ronin"]]),
      sortOrder: "updated_at",
      icon: null,
      getContentMatch: () => ({
        source: "assistant",
        snippet: "The relay reconnect is now bounded.",
        query: "reconnect",
      }),
      runThread: async (_thread) => undefined,
    });

    expect(item?.searchTerms).toContain("The relay reconnect is now bounded.");
    expect(item?.threadContentMatch).toEqual({
      source: "assistant",
      snippet: "The relay reconnect is now bounded.",
      query: "reconnect",
    });
    expect(item?.description).toBe("Ronin · #feat/search");
  });

  it("prefers renderDescription when provided", () => {
    const [item] = buildThreadActionItems({
      threads: [makeThread({ branch: "feat/search", worktreePath: "/tmp/wt" })],
      projectTitleById: new Map([[PROJECT_ID, "T3 Code"]]),
      sortOrder: "updated_at",
      icon: null,
      renderDescription: (thread, { projectTitle }) =>
        `${projectTitle}:${thread.branch}:${thread.worktreePath ? "wt" : "local"}`,
      runThread: async (_thread) => undefined,
    });

    expect(item?.description).toBe("T3 Code:feat/search:wt");
  });

  it("filters archived threads out of thread search items", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          title: "Active thread",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-archived"),
          title: "Archived thread",
          archivedAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    expect(items.map((item) => item.value)).toEqual(["thread:thread-active"]);
  });
});

describe("buildBrowseGroups", () => {
  it("waits for asynchronous browse navigation actions", async () => {
    let finishNavigation: (() => void) | undefined;
    const browseTo = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishNavigation = resolve;
        }),
    );
    const groups = buildBrowseGroups({
      browseEntries: [{ name: "Downloads", fullPath: "/Users/test/Downloads" }],
      browseQuery: "~/",
      canBrowseUp: false,
      upIcon: null,
      directoryIcon: null,
      browseUp: vi.fn(),
      browseTo,
    });
    const item = groups[0]?.items[0];
    if (!item || item.kind !== "action") {
      throw new Error("Expected a browse action");
    }

    let actionSettled = false;
    const action = item.run().then(() => {
      actionSettled = true;
    });
    await Promise.resolve();

    expect(browseTo).toHaveBeenCalledWith("Downloads");
    expect(actionSettled).toBe(false);

    finishNavigation?.();
    await action;
    expect(actionSettled).toBe(true);
  });
});

describe("WORKSPACE_COMMANDS", () => {
  it("gives every entry a distinct palette row and a distinct command", () => {
    const values = WORKSPACE_COMMANDS.map((entry) => entry.value);
    const commands = WORKSPACE_COMMANDS.map((entry) => entry.command);

    expect(new Set(values).size).toBe(values.length);
    expect(new Set(commands).size).toBe(commands.length);
  });

  it("only lists commands the chat view actually dispatches", () => {
    // The palette runs these through the keybinding bus, so an entry naming a
    // command nothing handles is a row that silently does nothing.
    const dispatched = new Set<KeybindingCommand>([
      "terminal.toggle",
      "terminal.new",
      "terminal.split",
      "terminal.splitVertical",
      "terminal.close",
      "diff.toggle",
      "rightPanel.toggle",
      "modelPicker.toggle",
      "chat.askOnTheSide",
      "chat.captureTask",
      "chat.secondOpinion",
      "buildSystem.run",
      "chat.cycleWidth",
      "digest.show",
    ]);

    for (const entry of WORKSPACE_COMMANDS) {
      expect(dispatched.has(entry.command)).toBe(true);
    }
  });

  it("carries search terms so the verbs are findable by what they do", () => {
    for (const entry of WORKSPACE_COMMANDS) {
      expect(entry.searchTerms.length).toBeGreaterThan(0);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });
});

describe("filterPinnedBrowseEntries", () => {
  const entries = [
    { name: "repo", fullPath: "/projects/repo" },
    { name: "work", fullPath: "/projects/work" },
  ];

  it("shows sibling folders without losing an existing pinned destination", () => {
    expect(
      filterPinnedBrowseEntries({
        browseEntries: entries,
        filterQuery: "repo",
        pinnedDirectoryName: "repo",
        caseSensitive: true,
      }),
    ).toEqual({ visibleEntries: entries, exactEntry: entries[0] });
  });

  it("matches an existing pinned destination without Windows casing", () => {
    const windowsEntries = [
      { name: "Repo", fullPath: "C:\\projects\\Repo" },
      { name: "work", fullPath: "C:\\projects\\work" },
    ];
    expect(
      filterPinnedBrowseEntries({
        browseEntries: windowsEntries,
        filterQuery: "repo",
        pinnedDirectoryName: "repo",
        caseSensitive: false,
      }),
    ).toEqual({
      visibleEntries: windowsEntries,
      exactEntry: windowsEntries[0],
    });
  });
});

it.each([
  "#10839",
  "10839",
  "pingdotgg/t3code#10839",
  "https://github.com/pingdotgg/t3code/pull/10839",
])("finds linked threads from PR query %s", (query) => {
  const items = buildThreadActionItems({
    threads: [
      makeThread({
        title: "Implementation",
        pullRequests: [
          {
            host: "github.com",
            repository: "pingdotgg/t3code",
            number: 10839,
            url: "https://github.com/pingdotgg/t3code/pull/10839",
            source: "manual",
            linkedAt: "2026-09-08T00:00:00Z",
            snapshot: null,
            stack: null,
          },
        ],
      }),
      makeThread({ id: ThreadId.make("unrelated"), title: "Other work" }),
    ],
    projectTitleById: new Map(),
    sortOrder: "updated_at",
    icon: null,
    runThread: async () => undefined,
  });
  const groups = filterCommandPaletteGroups({
    activeGroups: [],
    query,
    isInSubmenu: false,
    projectSearchItems: [],
    threadSearchItems: items,
  });
  expect(groups.flatMap((group) => group.items.map((item) => item.title))).toEqual([
    "Implementation",
  ]);
});

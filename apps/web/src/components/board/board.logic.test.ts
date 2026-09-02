import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { describe, expect, it } from "vite-plus/test";

import { threadNeedsYou } from "../Sidebar.logic";
import type { SidebarThreadSummary } from "../../types";
import {
  BOARD_LANE_KEYS,
  buildBoard,
  deriveBoardLane,
  orderDraftCards,
  reorderCardIds,
  resolveBoardDrop,
  type BoardClassifyContext,
  type BoardEnvironmentCapabilities,
  type BoardLaneKey,
} from "./board.logic";

const NOW = "2026-04-10T00:00:00.000Z";
const ENV = EnvironmentId.make("env-1");
const FULL: BoardEnvironmentCapabilities = { settlement: true, snooze: true };

function threadKeyOf(thread: SidebarThreadSummary): string {
  return `${thread.environmentId}:${thread.id}`;
}

function context(overrides: Partial<BoardClassifyContext> = {}): BoardClassifyContext {
  return {
    now: NOW,
    preciseNow: NOW,
    capabilitiesByEnvironmentId: new Map([[ENV, FULL]]),
    ...overrides,
  };
}

function makeThread(
  overrides: Partial<Omit<SidebarThreadSummary, "id">> & { id?: string } = {},
): SidebarThreadSummary {
  const id = ThreadId.make(overrides.id ?? "thread-1");
  return {
    environmentId: ENV,
    id,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as SidebarThreadSummary;
}

function completedTurn(completedAt: string) {
  return {
    turnId: TurnId.make("turn-1"),
    state: "completed" as const,
    requestedAt: completedAt,
    startedAt: completedAt,
    completedAt,
    assistantMessageId: null,
  };
}

function session(status: "starting" | "running" | "error" | "stopped", updatedAt = NOW) {
  return {
    threadId: ThreadId.make("thread-1"),
    status,
    providerName: "Codex",
    runtimeMode: "full-access" as const,
    activeTurnId: null,
    lastError: status === "error" ? "boom" : null,
    updatedAt,
  };
}

function laneOf(thread: SidebarThreadSummary, ctx = context()): BoardLaneKey {
  return deriveBoardLane(thread, ctx);
}

describe("deriveBoardLane", () => {
  it("files a never-run thread as Draft and a run-then-idle thread as Up Next", () => {
    expect(laneOf(makeThread())).toBe("draft");
    expect(laneOf(makeThread({ latestTurn: completedTurn("2026-04-09T00:00:00.000Z") }))).toBe(
      "upNext",
    );
  });

  it("treats a thread with a dead session but no turn as Up Next, not Draft", () => {
    // A session existed, so work was asked of it — Draft would be a lie.
    expect(laneOf(makeThread({ session: session("stopped") }))).toBe("upNext");
  });

  it("routes blocked work to Needs You", () => {
    expect(laneOf(makeThread({ hasPendingApprovals: true }))).toBe("needsYou");
    expect(laneOf(makeThread({ hasPendingUserInput: true }))).toBe("needsYou");
    expect(laneOf(makeThread({ session: session("error") }))).toBe("needsYou");
  });

  it("routes live and background work to Working", () => {
    expect(laneOf(makeThread({ session: session("running") }))).toBe("working");
    expect(laneOf(makeThread({ session: session("starting") }))).toBe("working");
    expect(laneOf(makeThread({ backgroundLiveness: "working" }))).toBe("working");
    expect(laneOf(makeThread({ backgroundLiveness: "monitoring" }))).toBe("working");
  });

  it("routes an explicitly settled thread to Done", () => {
    const settled = makeThread({
      latestTurn: completedTurn("2026-04-09T00:00:00.000Z"),
      settledOverride: "settled",
      settledAt: NOW,
    });
    expect(laneOf(settled)).toBe("done");
  });

  it("snoozes ahead of every other lane while the wake time is in the future", () => {
    const snoozed = makeThread({
      snoozedAt: "2026-04-09T00:00:00.000Z",
      snoozedUntil: "2026-04-11T00:00:00.000Z",
      latestTurn: completedTurn("2026-04-08T00:00:00.000Z"),
      settledOverride: "settled",
      settledAt: NOW,
    });
    expect(laneOf(snoozed)).toBe("snoozed");
  });

  it("lets a raised hand pull a snoozed thread into Needs You", () => {
    // Blocked work outranks the user's snooze — effectiveSnoozed declines to
    // classify it, and the board must follow rather than hide the request.
    const snoozedButBlocked = makeThread({
      snoozedAt: "2026-04-09T00:00:00.000Z",
      snoozedUntil: "2026-04-11T00:00:00.000Z",
      hasPendingApprovals: true,
    });
    expect(laneOf(snoozedButBlocked)).toBe("needsYou");
  });

  it("settles a pinned thread into Done, matching the sidebar's settle-beats-pin rule", () => {
    const pinnedAndSettled = makeThread({
      latestTurn: completedTurn("2026-04-01T00:00:00.000Z"),
      pinnedAt: NOW,
      pinOrderKey: "a",
      settledOverride: "settled",
      settledAt: NOW,
    });
    expect(laneOf(pinnedAndSettled)).toBe("done");
    // Settlement is the only thing the pin yields to: a pinned never-run
    // thread is still a Draft, and a pinned live one still floats in its lane.
    expect(laneOf(makeThread({ pinnedAt: NOW, pinOrderKey: "a" }))).toBe("draft");
    expect(laneOf({ ...pinnedAndSettled, settledOverride: null, settledAt: null })).toBe("upNext");
  });

  it("never uses a lane whose exit command the environment cannot run", () => {
    const noCapabilities = context({
      capabilitiesByEnvironmentId: new Map([[ENV, { settlement: false, snooze: false }]]),
    });
    const settled = makeThread({
      latestTurn: completedTurn("2026-04-09T00:00:00.000Z"),
      settledOverride: "settled",
      settledAt: NOW,
    });
    const snoozed = makeThread({
      snoozedAt: "2026-04-09T00:00:00.000Z",
      snoozedUntil: "2026-04-11T00:00:00.000Z",
    });
    expect(laneOf(settled, noCapabilities)).toBe("upNext");
    expect(laneOf(snoozed, noCapabilities)).toBe("draft");
  });

  it("treats an unknown environment as having no capabilities", () => {
    const unknownEnv = context({ capabilitiesByEnvironmentId: new Map() });
    const settled = makeThread({
      latestTurn: completedTurn("2026-04-09T00:00:00.000Z"),
      settledOverride: "settled",
      settledAt: NOW,
    });
    expect(laneOf(settled, unknownEnv)).toBe("upNext");
  });
});

describe("deriveBoardLane parity with the sidebar's own predicates", () => {
  // The board must never claim a thread the sidebar files elsewhere. Rather
  // than restate the partition, assert the one-way invariants: a lane is only
  // ever used when the predicate that owns it agrees.
  const fixtures: ReadonlyArray<SidebarThreadSummary> = [
    makeThread({ id: "a" }),
    makeThread({ id: "b", latestTurn: completedTurn("2026-04-09T00:00:00.000Z") }),
    makeThread({ id: "c", hasPendingApprovals: true }),
    makeThread({ id: "d", hasPendingUserInput: true }),
    makeThread({ id: "e", session: session("error") }),
    makeThread({ id: "f", session: session("running") }),
    makeThread({ id: "g", backgroundLiveness: "monitoring" }),
    makeThread({
      id: "h",
      latestTurn: completedTurn("2026-04-09T00:00:00.000Z"),
      settledOverride: "settled",
      settledAt: NOW,
    }),
    makeThread({
      id: "i",
      snoozedAt: "2026-04-09T00:00:00.000Z",
      snoozedUntil: "2026-04-11T00:00:00.000Z",
    }),
    makeThread({
      id: "j",
      snoozedAt: "2026-04-09T00:00:00.000Z",
      snoozedUntil: "2026-04-11T00:00:00.000Z",
      hasPendingUserInput: true,
    }),
  ];

  it.each(fixtures.map((thread) => [thread.id, thread] as const))(
    "%s lands in a lane its owning predicate agrees with",
    (_id, thread) => {
      const ctx = context();
      const lane = laneOf(thread, ctx);
      if (lane === "snoozed") {
        expect(effectiveSnoozed(thread, { now: ctx.preciseNow })).toBe(true);
      }
      if (lane === "needsYou") {
        expect(threadNeedsYou(thread)).toBe(true);
      }
      if (lane === "done") {
        expect(thread.settledOverride).toBe("settled");
      }
      // Snooze and blocked work both outrank settlement, so a thread either
      // predicate claims must never be filed as Done.
      if (effectiveSnoozed(thread, { now: ctx.preciseNow }) || threadNeedsYou(thread)) {
        expect(lane).not.toBe("done");
      }
    },
  );
});

describe("buildBoard", () => {
  it("drops archived threads and honours the scope filter", () => {
    const board = buildBoard({
      threads: [
        makeThread({ id: "kept" }),
        makeThread({ id: "archived", archivedAt: NOW }),
        makeThread({ id: "other-project", projectId: ProjectId.make("project-2") }),
      ],
      context: context(),
      threadKeyOf,
      includeThread: (thread) => thread.projectId === ProjectId.make("project-1"),
    });
    expect(board.lanes.draft.map((card) => card.threadId)).toEqual(["kept"]);
    expect(board.totalCount).toBe(1);
  });

  it("counts every lane and totals them", () => {
    const board = buildBoard({
      threads: [
        makeThread({ id: "a" }),
        makeThread({ id: "b", hasPendingApprovals: true }),
        makeThread({ id: "c", session: session("running") }),
      ],
      context: context(),
      threadKeyOf,
    });
    expect(board.counts).toEqual({
      draft: 1,
      upNext: 0,
      working: 1,
      needsYou: 1,
      snoozed: 0,
      done: 0,
    });
    expect(board.totalCount).toBe(3);
    expect(BOARD_LANE_KEYS.every((key) => Array.isArray(board.lanes[key]))).toBe(true);
  });

  it("floats pinned cards to the top of their lane", () => {
    const board = buildBoard({
      threads: [
        makeThread({ id: "newest", createdAt: "2026-04-05T00:00:00.000Z" }),
        makeThread({
          id: "pinned",
          createdAt: "2026-04-01T00:00:00.000Z",
          pinnedAt: NOW,
          pinOrderKey: "a",
        }),
      ],
      context: context(),
      threadKeyOf,
    });
    expect(board.lanes.draft.map((card) => card.threadId)).toEqual(["pinned", "newest"]);
  });

  it("leads the Needs You lane with the longest-blocked thread", () => {
    const board = buildBoard({
      threads: [
        makeThread({
          id: "recent",
          hasPendingApprovals: true,
          updatedAt: "2026-04-09T00:00:00.000Z",
        }),
        makeThread({
          id: "stuck-longest",
          hasPendingApprovals: true,
          updatedAt: "2026-04-02T00:00:00.000Z",
        }),
      ],
      context: context(),
      threadKeyOf,
    });
    expect(board.lanes.needsYou.map((card) => card.threadId)).toEqual(["stuck-longest", "recent"]);
  });

  it("orders the Snoozed lane by when each thread comes back", () => {
    const board = buildBoard({
      threads: [
        makeThread({
          id: "later",
          snoozedAt: NOW,
          snoozedUntil: "2026-04-20T00:00:00.000Z",
        }),
        makeThread({
          id: "sooner",
          snoozedAt: NOW,
          snoozedUntil: "2026-04-11T00:00:00.000Z",
        }),
      ],
      context: context(),
      threadKeyOf,
    });
    expect(board.lanes.snoozed.map((card) => card.threadId)).toEqual(["sooner", "later"]);
  });
});

describe("orderDraftCards", () => {
  function draftBoard(draftOrder?: readonly string[]) {
    return buildBoard({
      threads: [
        makeThread({ id: "a", createdAt: "2026-04-01T00:00:00.000Z" }),
        makeThread({ id: "b", createdAt: "2026-04-02T00:00:00.000Z" }),
        makeThread({ id: "c", createdAt: "2026-04-03T00:00:00.000Z" }),
      ],
      context: context(),
      threadKeyOf,
      ...(draftOrder ? { draftOrder } : {}),
    }).lanes.draft;
  }

  it("falls back to newest-first when no manual order is stored", () => {
    expect(draftBoard().map((card) => card.threadId)).toEqual(["c", "b", "a"]);
  });

  it("leads with manually ordered cards and keeps the rest in creation order", () => {
    expect(draftBoard([`${ENV}:a`]).map((card) => card.threadId)).toEqual(["a", "c", "b"]);
  });

  it("ignores stale ids in the stored order", () => {
    expect(draftBoard([`${ENV}:gone`, `${ENV}:b`]).map((card) => card.threadId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("returns creation order when the manual order is empty", () => {
    const cards = draftBoard();
    expect(orderDraftCards(cards, []).map((card) => card.threadId)).toEqual(["c", "b", "a"]);
  });
});

describe("reorderCardIds", () => {
  it("moves the dragged id to the target's index", () => {
    expect(reorderCardIds(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(reorderCardIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("returns null when nothing moved", () => {
    expect(reorderCardIds(["a", "b", "c"], "a", "a")).toBeNull();
    expect(reorderCardIds(["a", "b", "c"], "a", "missing")).toBeNull();
    expect(reorderCardIds(["a", "b", "c"], "missing", "a")).toBeNull();
  });
});

describe("resolveBoardDrop", () => {
  // The whole matrix, spelled out. This table IS the feature's contract:
  // every cell is either a command the server accepts or an honest refusal.
  const expected: Record<BoardLaneKey, Record<BoardLaneKey, string>> = {
    draft: {
      draft: "reorder",
      upNext: "noop:derived-lane",
      working: "open-thread",
      needsYou: "noop:derived-lane",
      snoozed: "snooze",
      done: "settle",
    },
    upNext: {
      draft: "noop:derived-lane",
      upNext: "noop:same-lane",
      working: "open-thread",
      needsYou: "noop:derived-lane",
      snoozed: "snooze",
      done: "settle",
    },
    working: {
      draft: "noop:derived-lane",
      upNext: "noop:derived-lane",
      working: "noop:same-lane",
      needsYou: "noop:derived-lane",
      snoozed: "snooze",
      done: "settle",
    },
    needsYou: {
      draft: "noop:derived-lane",
      upNext: "noop:derived-lane",
      working: "open-thread",
      needsYou: "noop:same-lane",
      snoozed: "snooze",
      done: "settle",
    },
    snoozed: {
      draft: "unsnooze",
      upNext: "unsnooze",
      working: "unsnooze-then:open-thread",
      needsYou: "noop:derived-lane",
      snoozed: "noop:same-lane",
      done: "unsnooze-then:settle",
    },
    done: {
      draft: "unsettle",
      upNext: "unsettle",
      working: "unsettle-then-open",
      needsYou: "noop:derived-lane",
      snoozed: "snooze",
      done: "noop:same-lane",
    },
  };

  function describeAction(from: BoardLaneKey, to: BoardLaneKey): string {
    const action = resolveBoardDrop({ from, to, capabilities: FULL });
    if (action.kind === "noop") return `noop:${action.reason}`;
    if (action.kind === "unsnooze-then") return `unsnooze-then:${action.next}`;
    return action.kind;
  }

  it.each(BOARD_LANE_KEYS.flatMap((from) => BOARD_LANE_KEYS.map((to) => [from, to] as const)))(
    "%s -> %s",
    (from, to) => {
      expect(describeAction(from, to)).toBe(expected[from][to]);
    },
  );

  it("refuses settle-shaped drops on a server without settlement", () => {
    const capabilities = { settlement: false, snooze: true };
    expect(resolveBoardDrop({ from: "upNext", to: "done", capabilities })).toEqual({
      kind: "noop",
      reason: "unsupported",
    });
    expect(resolveBoardDrop({ from: "done", to: "upNext", capabilities })).toEqual({
      kind: "noop",
      reason: "unsupported",
    });
    expect(resolveBoardDrop({ from: "done", to: "working", capabilities })).toEqual({
      kind: "noop",
      reason: "unsupported",
    });
  });

  it("refuses a snooze drop the thread's own guard would reject", () => {
    // canSnooze says no while an approval is pending: opening the wake-time
    // menu and failing on submit is worse than declining the drop.
    expect(
      resolveBoardDrop({
        from: "needsYou",
        to: "snoozed",
        capabilities: FULL,
        permits: { canSettle: true, canSnooze: false },
      }),
    ).toEqual({ kind: "noop", reason: "blocked" });
  });

  it("refuses a settle drop while the thread is still live or blocked", () => {
    expect(
      resolveBoardDrop({
        from: "working",
        to: "done",
        capabilities: FULL,
        permits: { canSettle: false, canSnooze: true },
      }),
    ).toEqual({ kind: "noop", reason: "blocked" });
  });

  it("still wakes a snoozed thread dropped on Done, since waking can unblock the settle", () => {
    expect(
      resolveBoardDrop({
        from: "snoozed",
        to: "done",
        capabilities: FULL,
        permits: { canSettle: false, canSnooze: true },
      }),
    ).toEqual({ kind: "unsnooze-then", next: "settle" });
  });

  it("refuses snooze-shaped drops on a server without snooze", () => {
    const capabilities = { settlement: true, snooze: false };
    expect(resolveBoardDrop({ from: "upNext", to: "snoozed", capabilities })).toEqual({
      kind: "noop",
      reason: "unsupported",
    });
    expect(resolveBoardDrop({ from: "snoozed", to: "upNext", capabilities })).toEqual({
      kind: "noop",
      reason: "unsupported",
    });
    expect(resolveBoardDrop({ from: "snoozed", to: "done", capabilities })).toEqual({
      kind: "noop",
      reason: "unsupported",
    });
  });
});

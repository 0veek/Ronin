import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { buildDigest, formatWaitedLabel, summarizeDigest } from "./digest";

const SINCE = "2026-05-01T00:00:00.000Z";
const NOW = "2026-05-01T09:00:00.000Z";

function thread(input: {
  readonly id: string;
  readonly updatedAt?: string;
  readonly completedAt?: string | null;
  readonly status?: "running" | "error" | "idle";
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
  readonly archivedAt?: string | null;
}): EnvironmentThreadShell {
  return {
    id: input.id,
    environmentId: "env",
    title: input.id,
    updatedAt: input.updatedAt ?? SINCE,
    archivedAt: input.archivedAt ?? null,
    hasPendingApprovals: input.hasPendingApprovals ?? false,
    hasPendingUserInput: input.hasPendingUserInput ?? false,
    hasActionableProposedPlan: false,
    session: input.status === undefined ? null : { status: input.status },
    latestTurn: input.completedAt === undefined ? null : { completedAt: input.completedAt },
  } as unknown as EnvironmentThreadShell;
}

describe("buildDigest", () => {
  it("reports nothing when nothing happened", () => {
    const digest = buildDigest({ threads: [], since: SINCE, now: NOW });
    expect(digest.isEmpty).toBe(true);
    expect(summarizeDigest(digest)).toBe("Nothing new since you last looked.");
  });

  it("lists turns that finished after the mark and ignores older ones", () => {
    const digest = buildDigest({
      threads: [
        thread({ id: "old", completedAt: "2026-04-30T23:00:00.000Z" }),
        thread({ id: "new", completedAt: "2026-05-01T03:00:00.000Z" }),
      ],
      since: SINCE,
      now: NOW,
    });
    expect(digest.finished.map((entry) => entry.thread.id)).toEqual(["new"]);
  });

  it("orders finished work newest first", () => {
    const digest = buildDigest({
      threads: [
        thread({ id: "early", completedAt: "2026-05-01T01:00:00.000Z" }),
        thread({ id: "late", completedAt: "2026-05-01T05:00:00.000Z" }),
      ],
      since: SINCE,
      now: NOW,
    });
    expect(digest.finished.map((entry) => entry.thread.id)).toEqual(["late", "early"]);
  });

  it("puts the longest-blocked thread first and measures its wait", () => {
    const digest = buildDigest({
      threads: [
        thread({
          id: "recent",
          hasPendingApprovals: true,
          updatedAt: "2026-05-01T08:00:00.000Z",
        }),
        thread({
          id: "stale",
          hasPendingApprovals: true,
          updatedAt: "2026-05-01T02:00:00.000Z",
        }),
      ],
      since: SINCE,
      now: NOW,
    });
    expect(digest.needsYou.map((entry) => entry.thread.id)).toEqual(["stale", "recent"]);
    expect(digest.needsYou[0]?.waitedMs).toBe(7 * 60 * 60 * 1_000);
  });

  it("files a thread once, with blocked beating finished", () => {
    const digest = buildDigest({
      threads: [
        thread({
          id: "blocked-after-finishing",
          hasPendingUserInput: true,
          completedAt: "2026-05-01T05:00:00.000Z",
        }),
      ],
      since: SINCE,
      now: NOW,
    });
    expect(digest.needsYou).toHaveLength(1);
    expect(digest.finished).toHaveLength(0);
  });

  it("counts a running thread as working rather than finished", () => {
    const digest = buildDigest({
      threads: [thread({ id: "busy", status: "running", completedAt: "2026-05-01T05:00:00.000Z" })],
      since: SINCE,
      now: NOW,
    });
    expect(digest.working.map((entry) => entry.thread.id)).toEqual(["busy"]);
    expect(digest.finished).toHaveLength(0);
  });

  it("leaves archived threads out — the user already filed them away", () => {
    const digest = buildDigest({
      threads: [
        thread({
          id: "archived",
          hasPendingApprovals: true,
          archivedAt: "2026-05-01T04:00:00.000Z",
        }),
      ],
      since: SINCE,
      now: NOW,
    });
    expect(digest.isEmpty).toBe(true);
  });

  it("leads its summary with what only the user can unblock", () => {
    const digest = buildDigest({
      threads: [
        thread({ id: "blocked", hasPendingApprovals: true }),
        thread({ id: "done", completedAt: "2026-05-01T05:00:00.000Z" }),
      ],
      since: SINCE,
      now: NOW,
    });
    expect(summarizeDigest(digest)).toBe("1 waiting on you · 1 finished");
  });
});

describe("formatWaitedLabel", () => {
  it("names a wait at the scale a reader thinks in", () => {
    expect(formatWaitedLabel(0)).toBe("just now");
    expect(formatWaitedLabel(59_000)).toBe("just now");
    expect(formatWaitedLabel(4 * 60_000)).toBe("4m");
    expect(formatWaitedLabel(2 * 60 * 60_000)).toBe("2h");
    expect(formatWaitedLabel(130 * 60_000)).toBe("2h 10m");
    expect(formatWaitedLabel(3 * 24 * 60 * 60_000)).toBe("3d");
  });
});

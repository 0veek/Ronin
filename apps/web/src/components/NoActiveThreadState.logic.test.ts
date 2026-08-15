import { describe, expect, it } from "vite-plus/test";

import { RESUMABLE_THREAD_LIMIT, selectResumableThreads } from "./NoActiveThreadState.logic";

function thread(input: {
  id: string;
  createdAt: string;
  updatedAt?: string;
  latestUserMessageAt?: string | null;
  archivedAt?: string | null;
}) {
  return {
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
    latestUserMessageAt: input.latestUserMessageAt ?? null,
    archivedAt: input.archivedAt ?? null,
  };
}

describe("selectResumableThreads", () => {
  it("offers the most recently touched threads first", () => {
    const selected = selectResumableThreads({
      threads: [
        thread({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
        thread({ id: "newest", createdAt: "2026-03-01T00:00:00.000Z" }),
        thread({ id: "middle", createdAt: "2026-02-01T00:00:00.000Z" }),
      ],
      sortOrder: "created_at",
    });

    expect(selected.map((entry) => entry.id)).toEqual(["newest", "middle", "old"]);
  });

  it("leaves archived threads out: stopping there was a deliberate choice", () => {
    const selected = selectResumableThreads({
      threads: [
        thread({ id: "archived", createdAt: "2026-03-01T00:00:00.000Z", archivedAt: "2026-03-02" }),
        thread({ id: "live", createdAt: "2026-01-01T00:00:00.000Z" }),
      ],
      sortOrder: "created_at",
    });

    expect(selected.map((entry) => entry.id)).toEqual(["live"]);
  });

  it("stays a shortlist rather than a second sidebar", () => {
    const selected = selectResumableThreads({
      threads: Array.from({ length: 10 }, (_unused, index) =>
        thread({ id: `t${index}`, createdAt: `2026-01-0${(index % 9) + 1}T00:00:00.000Z` }),
      ),
      sortOrder: "created_at",
    });

    expect(selected).toHaveLength(RESUMABLE_THREAD_LIMIT);
  });

  it("follows the user's own sidebar ordering preference", () => {
    const threads = [
      thread({
        id: "recently-created",
        createdAt: "2026-03-01T00:00:00.000Z",
        latestUserMessageAt: "2026-03-01T00:00:00.000Z",
      }),
      thread({
        id: "recently-messaged",
        createdAt: "2026-01-01T00:00:00.000Z",
        latestUserMessageAt: "2026-04-01T00:00:00.000Z",
      }),
    ];

    expect(
      selectResumableThreads({ threads, sortOrder: "created_at" }).map((entry) => entry.id)[0],
    ).toBe("recently-created");
    expect(
      selectResumableThreads({ threads, sortOrder: "updated_at" }).map((entry) => entry.id)[0],
    ).toBe("recently-messaged");
  });
});

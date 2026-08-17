import { describe, expect, it } from "vite-plus/test";

import { groupSideChatsUnderParents } from "./Sidebar.logic";

interface Row {
  readonly id: string;
  readonly sideChat?: { readonly parentThreadId: string } | null;
}

const shape = (rows: ReadonlyArray<{ thread: Row; depth: 0 | 1 }>) =>
  rows.map((row) => `${row.depth === 1 ? "  " : ""}${row.thread.id}`);

describe("groupSideChatsUnderParents", () => {
  it("leaves an ordinary list untouched", () => {
    expect(shape(groupSideChatsUnderParents([{ id: "a" }, { id: "b" }]))).toEqual(["a", "b"]);
  });

  it("files a side chat directly under its parent, wherever it sorted", () => {
    const rows = groupSideChatsUnderParents([
      { id: "side", sideChat: { parentThreadId: "parent" } },
      { id: "other" },
      { id: "parent" },
    ]);
    expect(shape(rows)).toEqual(["other", "parent", "  side"]);
  });

  it("keeps several side chats of one parent together, in list order", () => {
    const rows = groupSideChatsUnderParents([
      { id: "s1", sideChat: { parentThreadId: "p" } },
      { id: "s2", sideChat: { parentThreadId: "p" } },
      { id: "p" },
    ]);
    expect(shape(rows)).toEqual(["p", "  s1", "  s2"]);
  });

  it("keeps a side chat visible when its parent is not in this list", () => {
    // The parent may be settled, snoozed, or archived. Hiding the child
    // because of that would lose it entirely.
    const rows = groupSideChatsUnderParents([
      { id: "orphan", sideChat: { parentThreadId: "elsewhere" } },
      { id: "a" },
    ]);
    expect(shape(rows)).toEqual(["orphan", "a"]);
  });

  it("does not nest a thread under itself", () => {
    const rows = groupSideChatsUnderParents([{ id: "a", sideChat: { parentThreadId: "a" } }]);
    expect(shape(rows)).toEqual(["a"]);
  });

  it("stops at one level", () => {
    // A side chat of a side chat files under the one it came from; nesting
    // deeper costs the row its readable width for nothing.
    const rows = groupSideChatsUnderParents([
      { id: "p" },
      { id: "s", sideChat: { parentThreadId: "p" } },
      { id: "ss", sideChat: { parentThreadId: "s" } },
    ]);
    expect(shape(rows)).toEqual(["p", "  s", "  ss"]);
  });

  it("treats a null side chat as an ordinary thread", () => {
    expect(shape(groupSideChatsUnderParents([{ id: "a", sideChat: null }]))).toEqual(["a"]);
  });
});

describe("groupSideChatsUnderParents cycles", () => {
  it("keeps every thread on screen when provenance forms a cycle", () => {
    // Corrupt data must not make threads disappear from the sidebar.
    const rows = groupSideChatsUnderParents([
      { id: "a", sideChat: { parentThreadId: "b" } },
      { id: "b", sideChat: { parentThreadId: "a" } },
    ]);
    expect(rows.map((row) => row.thread.id).toSorted()).toEqual(["a", "b"]);
  });

  it("never lists a thread twice", () => {
    const rows = groupSideChatsUnderParents([
      { id: "p" },
      { id: "s", sideChat: { parentThreadId: "p" } },
      { id: "ss", sideChat: { parentThreadId: "s" } },
    ]);
    expect(rows.length).toBe(3);
  });
});

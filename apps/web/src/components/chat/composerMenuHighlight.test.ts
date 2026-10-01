import { describe, expect, it } from "vite-plus/test";

import {
  composerSuggestionOptionId,
  resolveComposerMenuActiveItemId,
} from "./composerMenuHighlight";

describe("composerSuggestionOptionId", () => {
  it("keeps file paths and malformed UTF-16 distinct in valid DOM ids", () => {
    const paths = [
      "docs/my file.md",
      "docs/my_file.md",
      "docs/my%20file.md",
      "docs/my\ud800.md",
      "docs/my\ud801.md",
      "docs/\ufffd.md",
    ];
    const ids = paths.map((path) => composerSuggestionOptionId("suggestions", `path:file:${path}`));
    expect(new Set(ids).size).toBe(paths.length);
    for (const id of ids) expect(id).not.toMatch(/\s|[\ud800-\udfff]/u);
    expect(composerSuggestionOptionId("other-composer", paths[0]!)).not.toBe(ids[0]);
  });
});

describe("resolveComposerMenuActiveItemId", () => {
  const items = [{ id: "top" }, { id: "second" }, { id: "third" }] as const;

  it("defaults to the first item when nothing is highlighted", () => {
    expect(
      resolveComposerMenuActiveItemId({
        items,
        highlightedItemId: null,
        currentSearchKey: "skill:u",
        highlightedSearchKey: null,
      }),
    ).toBe("top");
  });

  it("preserves the highlighted item within the same query", () => {
    expect(
      resolveComposerMenuActiveItemId({
        items,
        highlightedItemId: "second",
        currentSearchKey: "skill:u",
        highlightedSearchKey: "skill:u",
      }),
    ).toBe("second");
  });

  it("resets to the top result when the query changes", () => {
    expect(
      resolveComposerMenuActiveItemId({
        items,
        highlightedItemId: "second",
        currentSearchKey: "skill:ui",
        highlightedSearchKey: "skill:u",
      }),
    ).toBe("top");
  });

  it("falls back to the first item when the highlighted item disappears", () => {
    expect(
      resolveComposerMenuActiveItemId({
        items,
        highlightedItemId: "missing",
        currentSearchKey: "skill:ui",
        highlightedSearchKey: "skill:ui",
      }),
    ).toBe("top");
  });

  it("clears the active result while async results are empty and resolves against restored results", () => {
    const search = {
      highlightedItemId: "second",
      currentSearchKey: "path:src",
      highlightedSearchKey: "path:src",
    };
    const cleared = resolveComposerMenuActiveItemId({ ...search, items: [] });
    expect(cleared).toBeNull();
    expect(
      resolveComposerMenuActiveItemId({
        ...search,
        highlightedItemId: cleared,
        items: [{ id: "new-result" }, { id: "second" }],
      }),
    ).toBe("new-result");
  });
});

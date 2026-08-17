import { describe, expect, it } from "vite-plus/test";

import {
  normalizeSelectedPassage,
  resolveSelectionAnchor,
  resolveSideChatSelection,
  SIDE_CHAT_SELECTION_MIN_WORDS,
} from "./sideChatSelection";
import { SIDE_CHAT_EXCERPT_MAX_CHARS } from "./sideChatSeed";

type Endpoint = { messageId: string | null; messageRole: string | null };
const assistant = (messageId: string | null): Endpoint => ({
  messageId,
  messageRole: "assistant",
});
const user = (messageId: string | null): Endpoint => ({ messageId, messageRole: "user" });

const resolve = (
  selectedText: string,
  anchor: Endpoint = assistant("m1"),
  focus: Endpoint = anchor,
) => resolveSideChatSelection({ selectedText, anchor, focus });

describe("normalizeSelectedPassage", () => {
  it("collapses the indentation a rendered selection drags along", () => {
    expect(normalizeSelectedPassage("  the   cache is\n   invalidated  ")).toBe(
      "the cache is\ninvalidated",
    );
  });

  it("keeps a paragraph break but flattens bigger gaps", () => {
    expect(normalizeSelectedPassage("first\n\nsecond")).toBe("first\n\nsecond");
    expect(normalizeSelectedPassage("first\n\n\n\nsecond")).toBe("first\n\nsecond");
  });

  it("normalises CRLF", () => {
    expect(normalizeSelectedPassage("a\r\nb")).toBe("a\nb");
  });
});

describe("resolveSideChatSelection", () => {
  it("accepts a passage inside one assistant message", () => {
    expect(resolve("the cache is invalidated on write")).toEqual({
      messageId: "m1",
      text: "the cache is invalidated on write",
    });
  });

  it("refuses a selection that spans two messages", () => {
    // Nothing single is being asked about, so there is no honest anchor.
    expect(resolve("across both", assistant("m1"), assistant("m2"))).toBeNull();
  });

  it("refuses a selection in the user's own message", () => {
    expect(resolve("my own words", user("m1"), user("m1"))).toBeNull();
  });

  it("refuses a selection outside any message", () => {
    expect(
      resolve("stray words", { messageId: null, messageRole: null }, assistant("m1")),
    ).toBeNull();
  });

  it("refuses a one-word selection", () => {
    // Usually a double-click landing somewhere while reading, and too little
    // context to seed a question with.
    expect(resolve("cache")).toBeNull();
    expect(resolve("   cache   ")).toBeNull();
  });

  it("accepts at exactly the minimum word count", () => {
    const text = Array.from({ length: SIDE_CHAT_SELECTION_MIN_WORDS }, () => "word").join(" ");
    expect(resolve(text)?.text).toBe(text);
  });

  it("refuses an empty or whitespace selection", () => {
    expect(resolve("")).toBeNull();
    expect(resolve("   \n  ")).toBeNull();
  });

  it("bounds a very long passage so the chip and the composer agree", () => {
    const long = Array.from({ length: 4000 }, () => "word").join(" ");
    const resolved = resolve(long);
    expect(resolved).not.toBeNull();
    expect((resolved as { text: string }).text.length).toBeLessThanOrEqual(
      SIDE_CHAT_EXCERPT_MAX_CHARS,
    );
    expect((resolved as { text: string }).text.endsWith("…")).toBe(true);
  });
});

describe("resolveSelectionAnchor", () => {
  const base = { viewportWidth: 1000, chipWidth: 160 };

  it("centres the chip over the selection", () => {
    expect(resolveSelectionAnchor({ ...base, rect: { left: 400, right: 600, top: 200 } })).toEqual({
      x: 500,
      y: 200,
    });
  });

  it("clamps against the left edge", () => {
    const anchor = resolveSelectionAnchor({ ...base, rect: { left: 0, right: 20, top: 10 } });
    expect(anchor.x).toBe(88);
  });

  it("clamps against the right edge", () => {
    // A selection ending at the far edge is exactly when the reader most needs
    // the chip, so it must not slide off screen.
    const anchor = resolveSelectionAnchor({ ...base, rect: { left: 980, right: 1000, top: 10 } });
    expect(anchor.x).toBe(912);
  });

  it("survives a viewport narrower than the chip", () => {
    const anchor = resolveSelectionAnchor({
      viewportWidth: 100,
      chipWidth: 160,
      rect: { left: 0, right: 100, top: 0 },
    });
    expect(Number.isFinite(anchor.x)).toBe(true);
  });
});

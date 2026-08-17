import { describe, expect, it } from "vite-plus/test";

import {
  buildSideChatSeedPrompt,
  SIDE_CHAT_EXCERPT_MAX_CHARS,
  SIDE_CHAT_SEED_HEADING,
} from "./sideChatSeed";

describe("buildSideChatSeedPrompt", () => {
  it("quotes the anchored message under a heading", () => {
    expect(buildSideChatSeedPrompt("The cache is invalidated on write.")).toBe(
      `${SIDE_CHAT_SEED_HEADING}\n\n> The cache is invalidated on write.\n\n`,
    );
  });

  it("quotes every line, including the blank ones", () => {
    // A blank line left unquoted would end the blockquote and split the
    // excerpt into two, so the second half would read as the user's question.
    expect(buildSideChatSeedPrompt("first\n\nsecond")).toContain("> first\n>\n> second");
  });

  it("leaves the composer blank when there is nothing to quote", () => {
    expect(buildSideChatSeedPrompt("")).toBe("");
    expect(buildSideChatSeedPrompt("   \n  ")).toBe("");
    expect(buildSideChatSeedPrompt(null)).toBe("");
    expect(buildSideChatSeedPrompt(undefined)).toBe("");
  });

  it("keeps the opening of a long answer and marks the cut", () => {
    const long = `${"x".repeat(SIDE_CHAT_EXCERPT_MAX_CHARS + 500)}`;
    const seed = buildSideChatSeedPrompt(long);
    expect(seed).toContain("…");
    expect(seed.length).toBeLessThan(long.length);
  });

  it("cuts at a line boundary when one is near the limit", () => {
    const head = "a".repeat(SIDE_CHAT_EXCERPT_MAX_CHARS - 10);
    const seed = buildSideChatSeedPrompt(`${head}\n${"b".repeat(200)}`);
    expect(seed).toContain(`> ${head}`);
    expect(seed).not.toContain("bbb");
  });

  it("ends with a blank line so the question is separate from the quote", () => {
    expect(buildSideChatSeedPrompt("anything")).toMatch(/\n\n$/);
  });
});

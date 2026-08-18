import { describe, expect, it } from "vite-plus/test";

import {
  buildCapturedTaskPrompt,
  buildCapturedTaskTitle,
  CAPTURED_TASK_FALLBACK_TITLE,
  CAPTURED_TASK_MAX_CHARS,
  CAPTURED_TASK_TITLE_MAX_CHARS,
} from "./capturedTask";

describe("buildCapturedTaskPrompt", () => {
  it("carries the passage verbatim", () => {
    expect(buildCapturedTaskPrompt("Drop the legacy shim in loader.ts")).toBe(
      "Drop the legacy shim in loader.ts",
    );
  });

  it("keeps interior structure so a multi-step task survives", () => {
    const passage = "Two things:\n\n- drop the shim\n- delete its test";
    expect(buildCapturedTaskPrompt(`  ${passage}  `)).toBe(passage);
  });

  it("refuses a passage with nothing in it", () => {
    expect(buildCapturedTaskPrompt("")).toBeNull();
    expect(buildCapturedTaskPrompt("   \n  ")).toBeNull();
    expect(buildCapturedTaskPrompt(null)).toBeNull();
    expect(buildCapturedTaskPrompt(undefined)).toBeNull();
  });

  it("keeps the opening of an over-long passage and marks the cut", () => {
    const long = "x".repeat(CAPTURED_TASK_MAX_CHARS + 500);
    const prompt = buildCapturedTaskPrompt(long);
    expect(prompt).not.toBeNull();
    expect(prompt!.length).toBeLessThanOrEqual(CAPTURED_TASK_MAX_CHARS + 1);
    expect(prompt!.endsWith("…")).toBe(true);
    expect(prompt!.startsWith("xxx")).toBe(true);
  });
});

describe("buildCapturedTaskTitle", () => {
  it("titles from the first line that says something", () => {
    expect(buildCapturedTaskTitle("\n\nDrop the legacy shim\n\nthen delete its test")).toBe(
      "Drop the legacy shim",
    );
  });

  it("strips the markdown a captured passage arrives wearing", () => {
    expect(buildCapturedTaskTitle("- **Drop the shim** in `loader.ts`")).toBe(
      "Drop the shim in loader.ts",
    );
    expect(buildCapturedTaskTitle("> ## Merge the two helpers")).toBe("Merge the two helpers");
    expect(buildCapturedTaskTitle("1. Rename the flag")).toBe("Rename the flag");
  });

  it("truncates a long first line at a word boundary", () => {
    const title = buildCapturedTaskTitle(`${"word ".repeat(40)}end`);
    expect(title.length).toBeLessThanOrEqual(CAPTURED_TASK_TITLE_MAX_CHARS + 1);
    expect(title.endsWith("…")).toBe(true);
    // Cut between words, so the title never ends mid-word before the ellipsis.
    expect(title.endsWith("wor…")).toBe(false);
  });

  it("names a passage that is only markup rather than showing nothing", () => {
    expect(buildCapturedTaskTitle("***")).toBe(CAPTURED_TASK_FALLBACK_TITLE);
  });
});

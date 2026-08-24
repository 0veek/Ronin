import { describe, expect, it } from "vite-plus/test";

import { parseAntigravityModelLine, parseAntigravityModelLines } from "./AntigravityModels.ts";

describe("parseAntigravityModelLine", () => {
  it("keeps the CLI id as the slug and the label as the name", () => {
    expect(parseAntigravityModelLine("gemini-3.7-flash-high\tGemini 3.7 Flash (High)")).toEqual({
      slug: "gemini-3.7-flash-high",
      name: "Gemini 3.7 Flash (High)",
    });
  });

  it("drops the active-model marker", () => {
    expect(parseAntigravityModelLine("* gemini-3.5-flash-low\tGemini 3.5 Flash (Low)")).toEqual({
      slug: "gemini-3.5-flash-low",
      name: "Gemini 3.5 Flash (Low)",
    });
  });

  it("ignores rows without an id column", () => {
    expect(parseAntigravityModelLine("Fetching available models...")).toBeNull();
    expect(parseAntigravityModelLine("Gemini 3.5 Flash")).toBeNull();
    expect(parseAntigravityModelLine("")).toBeNull();
  });

  it("reads a build that aligns the columns with spaces instead of a tab", () => {
    expect(parseAntigravityModelLine("gemini-3.7-flash-high   Gemini 3.7 Flash (High)")).toEqual({
      slug: "gemini-3.7-flash-high",
      name: "Gemini 3.7 Flash (High)",
    });
    expect(parseAntigravityModelLine("* gemini-3.5-flash-low   Gemini 3.5 Flash (Low)")).toEqual({
      slug: "gemini-3.5-flash-low",
      name: "Gemini 3.5 Flash (Low)",
    });
  });

  it("still turns away space-aligned prose that has no id column", () => {
    expect(parseAntigravityModelLine("Fetching   available models")).toBeNull();
    expect(parseAntigravityModelLine("Available models:   pick one")).toBeNull();
  });
});

describe("parseAntigravityModelLines", () => {
  it("reads every model `agy models` lists, in order", () => {
    const models = parseAntigravityModelLines(
      [
        "Fetching available models...",
        "gemini-3.7-flash-high\tGemini 3.7 Flash (High)",
        "gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)",
        "gemini-3.7-flash-low\tGemini 3.7 Flash (Low)",
        "gemini-3.1-pro-high\tGemini 3.1 Pro (High)",
        "claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)",
        "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)",
        "",
      ].join("\n"),
    );

    expect(models).toEqual([
      { slug: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
      { slug: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)" },
      { slug: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
      { slug: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)" },
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
      { slug: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
    ]);
  });

  it("keeps the first row for a repeated id", () => {
    const models = parseAntigravityModelLines(
      ["gemini-3.5-flash-low\tGemini 3.5 Flash (Low)", "gemini-3.5-flash-low\tstale"].join("\n"),
    );
    expect(models).toEqual([{ slug: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Low)" }]);
  });
});

import { describe, expect, it } from "vite-plus/test";

import { parseAntigravityCliModelLabel, parseAntigravityModelLines } from "./AntigravityModels.ts";

describe("parseAntigravityCliModelLabel", () => {
  it("reads tab-separated slug and display name with effort", () => {
    expect(parseAntigravityCliModelLabel("gemini-3.5-flash\tGemini 3.5 Flash (medium)")).toEqual({
      model: "Gemini 3.5 Flash",
      effort: "medium",
    });
  });

  it("keeps a plain display label", () => {
    expect(parseAntigravityCliModelLabel("Gemini 3.5 Flash")).toEqual({
      model: "Gemini 3.5 Flash",
    });
  });
});

describe("parseAntigravityModelLines", () => {
  it("groups efforts under one model", () => {
    const models = parseAntigravityModelLines(
      ["gemini-flash\tGemini 3.5 Flash (low)", "gemini-flash\tGemini 3.5 Flash (medium)", ""].join(
        "\n",
      ),
    );
    expect(models).toEqual([
      {
        slug: "Gemini 3.5 Flash",
        name: "Gemini 3.5 Flash",
        efforts: ["low", "medium"],
      },
    ]);
  });
});

import type { ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildSecondOpinionTitle,
  SECOND_OPINION_MAX_ENTRANTS,
  SECOND_OPINION_TITLE_MAX_CHARS,
  secondOpinionSelectionError,
  type SecondOpinionEntrant,
} from "./secondOpinion";

function entrant(instanceId: string, model: string, label = model): SecondOpinionEntrant {
  return {
    modelSelection: { instanceId, model } as unknown as ModelSelection,
    label,
  };
}

describe("secondOpinionSelectionError", () => {
  it("refuses a race of one", () => {
    expect(secondOpinionSelectionError([])).toContain("at least");
    expect(secondOpinionSelectionError([entrant("codex", "gpt-5-codex")])).toContain("at least");
  });

  it("accepts a set of distinct models", () => {
    expect(
      secondOpinionSelectionError([entrant("codex", "gpt-5-codex"), entrant("claude", "opus")]),
    ).toBeNull();
  });

  it("counts the same model twice as a mistake rather than deduplicating it", () => {
    expect(
      secondOpinionSelectionError([
        entrant("codex", "gpt-5-codex"),
        entrant("codex", "gpt-5-codex"),
      ]),
    ).toContain("different model");
  });

  it("treats the same model on two instances as two entrants", () => {
    expect(
      secondOpinionSelectionError([
        entrant("codex_work", "gpt-5-codex"),
        entrant("codex_personal", "gpt-5-codex"),
      ]),
    ).toBeNull();
  });

  it("caps the field", () => {
    const many = Array.from({ length: SECOND_OPINION_MAX_ENTRANTS + 1 }, (_, index) =>
      entrant(`instance-${index}`, `model-${index}`),
    );
    expect(secondOpinionSelectionError(many)).toContain("at most");
  });
});

describe("buildSecondOpinionTitle", () => {
  it("leads with the model, since that is what tells the threads apart", () => {
    expect(buildSecondOpinionTitle("fix the loader", "Opus")).toBe("Opus: fix the loader");
  });

  it("flattens whitespace so a multi-line prompt still reads as one title", () => {
    expect(buildSecondOpinionTitle("fix\n\n  the   loader", "Opus")).toBe("Opus: fix the loader");
  });

  it("keeps the model when the prompt has to be cut", () => {
    const title = buildSecondOpinionTitle("word ".repeat(60), "Opus");
    expect(title.startsWith("Opus: ")).toBe(true);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(SECOND_OPINION_TITLE_MAX_CHARS + "Opus: ".length + 1);
  });

  it("falls back to the model alone when there is no prompt to quote", () => {
    expect(buildSecondOpinionTitle("   ", "Opus")).toBe("Opus");
  });
});

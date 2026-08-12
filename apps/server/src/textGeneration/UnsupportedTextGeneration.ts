import * as Effect from "effect/Effect";

import { TextGenerationError } from "@t3tools/contracts";

import * as TextGeneration from "./TextGeneration.ts";

export function makeUnsupportedTextGeneration(
  providerLabel: string,
): TextGeneration.TextGeneration["Service"] {
  const fail = (operation: TextGenerationError["operation"]) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `${providerLabel} does not generate git or pull-request text. Pick Codex, Claude, Cursor, Grok, or OpenCode for that.`,
      }),
    );

  return {
    generateCommitMessage: () => fail("generateCommitMessage"),
    generatePrContent: () => fail("generatePrContent"),
    generateBranchName: () => fail("generateBranchName"),
    generateThreadTitle: () => fail("generateThreadTitle"),
  };
}

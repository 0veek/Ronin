import { describe, expect, it } from "vite-plus/test";

import { resolveDictationKeyDownAction } from "./composerDictationKeyboard";

describe("dictation shortcut keyboard ownership", () => {
  it("claims repeated shortcut keydowns without starting another recording", () => {
    expect(
      resolveDictationKeyDownAction({
        key: "v",
        repeat: true,
        keyHeld: true,
        shortcutMatches: true,
      }),
    ).toBe("claim");
  });

  it("starts once on the initial shortcut keydown", () => {
    expect(
      resolveDictationKeyDownAction({
        key: "d",
        repeat: false,
        keyHeld: false,
        shortcutMatches: true,
      }),
    ).toBe("begin");
  });

  it("cancels an active hold on Escape", () => {
    expect(
      resolveDictationKeyDownAction({
        key: "Escape",
        repeat: false,
        keyHeld: true,
        shortcutMatches: false,
      }),
    ).toBe("cancel");
  });
});

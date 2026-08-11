import { describe, expect, it } from "vite-plus/test";

import type { ComposerDictationInsert } from "./composerDictationContext";

/**
 * The composer publishes its insert through a ref rather than a captured
 * closure. This reproduces both halves of why, without mounting the composer.
 */
function makeComposerLikeInsert() {
  // Stands in for the guards insertComposerTextAtEnd closes over: they are
  // false at mount and only become true once the thread is connected.
  let accepting = false;
  const inserted: string[] = [];

  // Rebuilt every render, exactly like the real one.
  const currentInsert = () => (text: string) => {
    if (!accepting) return false;
    inserted.push(text);
    return true;
  };

  const ref = { current: currentInsert() };
  const stable: ComposerDictationInsert = (text) => ref.current(text);

  return {
    inserted,
    stable,
    render: () => {
      ref.current = currentInsert();
    },
    connect: () => {
      accepting = true;
    },
  };
}

describe("dictation insert wiring", () => {
  it("sees the composer's current state, not the state it had at mount", () => {
    // The bug this guards: a useCallback with empty deps captures the first
    // render's insert, whose guards say "still connecting" forever, so every
    // transcript is refused for the life of the thread and nothing is typed.
    const composer = makeComposerLikeInsert();

    expect(composer.stable("first")).toBe(false);

    composer.connect();
    composer.render();

    expect(composer.stable("second")).toBe(true);
    expect(composer.inserted).toEqual(["second"]);
  });

  it("reports refusal rather than silently dropping the text", () => {
    // A void return would make "composer refused" and "insert succeeded" look
    // identical to the caller, which is how a transcript goes missing without
    // a single error anywhere.
    const composer = makeComposerLikeInsert();

    const result = composer.stable("dropped");

    expect(result).toBe(false);
    expect(composer.inserted).toEqual([]);
  });
});

import { describe, expect, it } from "vite-plus/test";

import { createComposerDictationInsert } from "./composerDictationContext";

/**
 * The composer publishes its insert through a ref rather than a captured
 * closure. This reproduces both halves of why, without mounting the composer.
 */
function makeComposerLikeInsert() {
  // Stands in for the guards insertComposerTextAtEnd closes over: they are
  // false at mount and only become true once the thread is connected.
  let accepting = false;
  const inserted: string[] = [];
  const promptRef = { current: "" };

  // Rebuilt every render, exactly like the real one.
  const currentInsert = () => (text: string) => {
    if (!accepting) return false;
    inserted.push(text);
    promptRef.current += text;
    return true;
  };

  const ref = { current: currentInsert() };
  const stable = createComposerDictationInsert(ref, promptRef, async () => true);

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
  it("sees the composer's current state, not the state it had at mount", async () => {
    // The bug this guards: a useCallback with empty deps captures the first
    // render's insert, whose guards say "still connecting" forever, so every
    // transcript is refused for the life of the thread and nothing is typed.
    const composer = makeComposerLikeInsert();

    await expect(composer.stable("first")).resolves.toBe(false);

    composer.connect();
    composer.render();

    await expect(composer.stable("second")).resolves.toBe(true);
    expect(composer.inserted).toEqual(["second"]);
  });

  it("reports refusal rather than silently dropping the text", async () => {
    // A void return would make "composer refused" and "insert succeeded" look
    // identical to the caller, which is how a transcript goes missing without
    // a single error anywhere.
    const composer = makeComposerLikeInsert();

    const result = await composer.stable("dropped");

    expect(result).toBe(false);
    expect(composer.inserted).toEqual([]);
  });

  it("leaves focus scheduling to the controlled insertion", async () => {
    const calls: Array<{
      text: string;
      options: { ensureLeadingBoundary?: boolean } | undefined;
    }> = [];
    const insertRef = {
      current: (text: string, options?: { ensureLeadingBoundary?: boolean }) => {
        calls.push({ text, options });
        return true;
      },
    };
    const promptRef = { current: "existing spoken words" };
    const committedPrompts: string[] = [];

    const insert = createComposerDictationInsert(insertRef, promptRef, async (prompt) => {
      committedPrompts.push(prompt);
      return true;
    });

    await expect(insert("spoken words")).resolves.toBe(true);
    expect(calls).toEqual([{ text: "spoken words", options: { ensureLeadingBoundary: true } }]);
    expect(committedPrompts).toEqual(["existing spoken words"]);
  });

  it("does not resolve until the controlled prompt is committed", async () => {
    const promptRef = { current: "" };
    const deferredCommit: { resolve?: (committed: boolean) => void } = {};
    const insert = createComposerDictationInsert(
      {
        current: (text) => {
          promptRef.current = text;
          return true;
        },
      },
      promptRef,
      () =>
        new Promise<boolean>((resolve) => {
          deferredCommit.resolve = resolve;
        }),
    );
    let settled = false;

    const result = insert("spoken words").then((committed) => {
      settled = true;
      return committed;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(deferredCommit.resolve).toBeDefined();
    deferredCommit.resolve?.(true);
    await expect(result).resolves.toBe(true);
  });
});

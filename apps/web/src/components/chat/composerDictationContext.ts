import { createContext, use } from "react";

/**
 * How dictated text reaches the composer it was spoken into.
 *
 * The obvious route was `ComposerHandleContext`, but that context is only
 * provided by the command palette; when it is absent ChatView quietly falls
 * back to a ref of its own, so a consumer inside the composer reads null and
 * the insert becomes a silent no-op -- text transcribed, nothing typed.
 *
 * ChatComposer publishes this itself, so the button is wired to the composer
 * it actually lives inside rather than to whichever ref happened to win
 * upstream.
 */
/** Resolves false when the composer refuses the text, so the caller can say so. */
export type ComposerDictationInsert = (text: string) => Promise<boolean>;

type ComposerTextInsert = (text: string, options?: { ensureLeadingBoundary?: boolean }) => boolean;

interface ComposerTextInsertRef {
  readonly current: ComposerTextInsert;
}

interface ComposerPromptRef {
  readonly current: string;
}

type WaitForPromptCommit = (prompt: string) => Promise<boolean>;

/**
 * Keeps dictation wired to the latest composer insertion callback.
 *
 * Insertion owns its focus scheduling because it first has to commit the
 * controlled prompt. Focusing synchronously here would make the editor publish
 * its stale pre-insertion snapshot and overwrite the transcript again. The
 * returned promise stays pending until that update is visible, so dictation
 * cannot leave its transcribing state prematurely.
 */
export function createComposerDictationInsert(
  insertRef: ComposerTextInsertRef,
  promptRef: ComposerPromptRef,
  waitForPromptCommit: WaitForPromptCommit,
): ComposerDictationInsert {
  return async (text) => {
    if (!insertRef.current(text, { ensureLeadingBoundary: true })) return false;
    return waitForPromptCommit(promptRef.current);
  };
}

export const ComposerDictationContext = createContext<ComposerDictationInsert | null>(null);

export function useComposerDictationInsert(): ComposerDictationInsert | null {
  return use(ComposerDictationContext);
}

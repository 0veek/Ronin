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
/** Returns false when the composer refuses the text, so the caller can say so. */
export type ComposerDictationInsert = (text: string) => boolean;

export const ComposerDictationContext = createContext<ComposerDictationInsert | null>(null);

export function useComposerDictationInsert(): ComposerDictationInsert | null {
  return use(ComposerDictationContext);
}

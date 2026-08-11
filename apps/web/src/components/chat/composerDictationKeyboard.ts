export type DictationKeyDownAction = "none" | "claim" | "begin" | "cancel";

/**
 * Decides how the global push-to-talk listener owns a keydown.
 *
 * Repeated shortcut events still have to be claimed. Letting them fall
 * through can trigger the shortcut's native editor action over and over while
 * the key remains held (most visibly, repeated clipboard pastes).
 */
export function resolveDictationKeyDownAction(input: {
  readonly key: string;
  readonly repeat: boolean;
  readonly keyHeld: boolean;
  readonly shortcutMatches: boolean;
}): DictationKeyDownAction {
  if (input.key === "Escape" && input.keyHeld) return "cancel";
  if (!input.shortcutMatches) return "none";
  if (input.repeat || input.keyHeld) return "claim";
  return "begin";
}

import { useAtomValue } from "@effect/atom-react";
import { memo, useCallback } from "react";

import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { ComposerDictateButton } from "./ComposerDictateButton";

/**
 * Resolves the dictation binding and hands it to the button.
 *
 * Separate from the button so the composer strip can mount dictation without
 * threading a keybindings prop through BranchToolbar, which knows nothing
 * about shortcuts otherwise.
 */
export const ComposerDictationControl = memo(function ComposerDictationControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  const matchesShortcut = useCallback(
    (event: KeyboardEvent) => resolveShortcutCommand(event, keybindings) === "composer.dictate",
    [keybindings],
  );

  return (
    <ComposerDictateButton
      matchesShortcut={matchesShortcut}
      shortcutLabel={shortcutLabelForCommand(keybindings, "composer.dictate")}
    />
  );
});

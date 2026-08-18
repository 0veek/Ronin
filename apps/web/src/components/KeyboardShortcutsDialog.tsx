import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useMemo } from "react";

import { keybindingDisplayParts } from "./settings/KeybindingsSettings.logic";
import { buildShortcutsCheatSheet } from "./shortcutsCheatSheet";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";

/** One shortcut, split into caps so `⇧⌘F` reads as three keys and `Ctrl+Alt+T`
    does not read as a sentence. */
function ShortcutKeys({ shortcut }: { shortcut: string }) {
  const parts = keybindingDisplayParts(shortcut);
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      {parts.map((part, index) => (
        <kbd
          className="min-w-5 rounded-[var(--control-radius)] border border-border/70 px-1.5 py-0.5 text-center font-mono text-2xs text-muted-foreground"
          // The keys up to and including this one: unique within a shortcut
          // without leaning on the index, since no prefix repeats.
          key={parts.slice(0, index + 1).join("+")}
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Every shortcut currently in force, on one screen.
 *
 * The keybindings editor in Settings could always answer "what is bound to
 * this?", but it is an editor — it is reached deliberately, sorted for
 * rebinding, and shows conflicts and sources. This answers the other question,
 * the one asked mid-task: "what can I press right now?" Read-only, grouped by
 * the part of the app each shortcut acts on, and reachable without leaving
 * what you were doing.
 *
 * It reads the resolved config, so a user's own bindings are what it shows.
 */
export function KeyboardShortcutsDialog({
  keybindings,
  onOpenChange,
  open,
}: {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const sections = useMemo(() => buildShortcutsCheatSheet(keybindings), [keybindings]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {sections.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">
              No shortcuts are bound. Settings &rarr; Keybindings can restore the defaults.
            </p>
          ) : (
            <div className="columns-1 gap-8 sm:columns-2">
              {sections.map((section) => (
                <section className="mb-6 break-inside-avoid" key={section.title}>
                  <h3 className="label-meta mb-2 text-muted-foreground">{section.title}</h3>
                  <ul className="flex flex-col gap-1">
                    {section.entries.map((entry) => (
                      <li
                        className="flex items-center justify-between gap-4 text-sm"
                        key={entry.command}
                      >
                        <span className="min-w-0 truncate text-foreground">{entry.label}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {entry.shortcuts.map((shortcut) => (
                            <ShortcutKeys key={shortcut} shortcut={shortcut} />
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

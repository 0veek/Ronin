import type { KeybindingCommand } from "@t3tools/contracts";

/**
 * Lets a surface outside the chat view ask for a keybinding command to run.
 *
 * The workspace commands — terminal, diff, right panel, model picker, project
 * scripts — are implemented against ChatView's own state and were reachable
 * only by pressing their shortcut. That made the shortcut the *only* way in,
 * which is backwards: the palette is where a user goes to find out what the
 * app can do, and a command they cannot find is a command they do not know
 * they have.
 *
 * An event bus rather than lifted state, matching `commandPaletteBus`: the
 * alternative is threading a dispatcher through the whole component tree to
 * reach a listener that already exists.
 */
const KEYBINDING_COMMAND_EVENT = "t3code:run-keybinding-command";

export interface KeybindingCommandDetail {
  readonly command: KeybindingCommand;
}

export function runKeybindingCommand(command: KeybindingCommand): void {
  window.dispatchEvent(
    new CustomEvent<KeybindingCommandDetail>(KEYBINDING_COMMAND_EVENT, { detail: { command } }),
  );
}

export function onRunKeybindingCommand(listener: (command: KeybindingCommand) => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<KeybindingCommandDetail>).detail;
    if (detail) listener(detail.command);
  };
  window.addEventListener(KEYBINDING_COMMAND_EVENT, handler);
  return () => window.removeEventListener(KEYBINDING_COMMAND_EVENT, handler);
}

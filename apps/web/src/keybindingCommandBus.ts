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
  /** Called by the listener that acted on the command. */
  readonly markHandled: () => void;
}

/**
 * How long `awaitHandler` keeps re-offering a command to a handler that has not
 * mounted yet. Bounded on purpose: a command that fires minutes later, against
 * whatever thread the user has moved on to, is worse than one that never fires.
 */
const HANDOFF_DEADLINE_MS = 1_000;

function dispatchKeybindingCommand(command: KeybindingCommand): boolean {
  let handled = false;
  const detail: KeybindingCommandDetail = {
    command,
    markHandled: () => {
      handled = true;
    },
  };
  window.dispatchEvent(
    new CustomEvent<KeybindingCommandDetail>(KEYBINDING_COMMAND_EVENT, { detail }),
  );
  return handled;
}

/**
 * `awaitHandler` is for callers that just navigated to the route whose handler
 * owns this command: the route change resolves before React has mounted the
 * new view, so the first dispatch lands with nobody listening. Retrying across
 * frames hands the command over as soon as the view subscribes.
 */
export function runKeybindingCommand(
  command: KeybindingCommand,
  options?: { readonly awaitHandler?: boolean },
): void {
  if (dispatchKeybindingCommand(command) || options?.awaitHandler !== true) {
    return;
  }

  const deadline = performance.now() + HANDOFF_DEADLINE_MS;
  const retry = () => {
    if (dispatchKeybindingCommand(command) || performance.now() >= deadline) {
      return;
    }
    window.requestAnimationFrame(retry);
  };
  window.requestAnimationFrame(retry);
}

export function onRunKeybindingCommand(
  listener: (command: KeybindingCommand, markHandled: () => void) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<KeybindingCommandDetail>).detail;
    if (detail) listener(detail.command, detail.markHandled);
  };
  window.addEventListener(KEYBINDING_COMMAND_EVENT, handler);
  return () => window.removeEventListener(KEYBINDING_COMMAND_EVENT, handler);
}

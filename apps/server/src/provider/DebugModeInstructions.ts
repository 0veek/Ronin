import type { ProviderInteractionMode } from "@t3tools/contracts";

/**
 * Debug mode is provider-neutral. No CLI Ronin drives exposes a native debug
 * collaboration mode, so the behaviour is carried entirely by this prefix and
 * every adapter otherwise treats the turn as a normal one.
 */
export const PROVIDER_DEBUG_MODE_PROMPT_PREFIX = `<ronin_debug_mode>
You are operating in Ronin Debug mode. Diagnose the reported defect with an evidence-first loop: observe, reproduce, investigate, fix, verify.

- Read the real current state before editing anything. Reproduce the failure when you can, and collect the actual logs, errors, and stack traces rather than assuming them.
- Form testable hypotheses and narrow them with evidence. Fix the smallest root cause; do not paper over the symptom.
- Add or update a regression test when practical. Run a real verification and confirm the original symptom is gone before you call the bug fixed. Never claim success you have not verified.
- Keep the current permission mode. Debug mode grants no extra access, and it is not Plan mode: you may edit and run commands exactly as you normally would.
- If reproducing needs the user, give exact steps and say what has to stay open. Ask one focused reproduction question, then stop and wait for their reply rather than guessing.
- Do not imply Ronin can see things it cannot. When browser state, terminal output, or a log you need is out of reach, ask the user for it.
- If you get stuck, report what you inspected, what the evidence showed, what is still uncertain, and the next concrete step.
</ronin_debug_mode>`;

/**
 * Characters `withProviderDebugModePrompt` will add, so callers can reserve
 * budget before they spend it on skills or a handoff brief.
 */
export function debugModePromptOverheadChars(
  interactionMode: ProviderInteractionMode | undefined,
): number {
  return interactionMode === "debug" ? PROVIDER_DEBUG_MODE_PROMPT_PREFIX.length + 2 : 0;
}

export function withProviderDebugModePrompt(input: {
  readonly text: string;
  readonly interactionMode?: ProviderInteractionMode | undefined;
}): string {
  if (
    input.interactionMode !== "debug" ||
    input.text.startsWith(PROVIDER_DEBUG_MODE_PROMPT_PREFIX)
  ) {
    return input.text;
  }
  return input.text.length > 0
    ? `${PROVIDER_DEBUG_MODE_PROMPT_PREFIX}\n\n${input.text}`
    : PROVIDER_DEBUG_MODE_PROMPT_PREFIX;
}

/**
 * Codex and the ACP providers only understand `default` and `plan`. Debug rides
 * on top of the default collaboration mode so the prefix is what makes it debug.
 */
export function toNativeInteractionMode(
  interactionMode: ProviderInteractionMode | undefined,
): "default" | "plan" | undefined {
  if (interactionMode === undefined) {
    return undefined;
  }
  return interactionMode === "plan" ? "plan" : "default";
}

import { describe, expect, it } from "vite-plus/test";

import {
  PROVIDER_DEBUG_MODE_PROMPT_PREFIX,
  debugModePromptOverheadChars,
  toNativeInteractionMode,
  withProviderDebugModePrompt,
} from "./DebugModeInstructions.ts";

describe("withProviderDebugModePrompt", () => {
  it("prefixes the message in debug mode", () => {
    const result = withProviderDebugModePrompt({
      interactionMode: "debug",
      text: "the sidebar count is wrong",
    });
    expect(result).toBe(`${PROVIDER_DEBUG_MODE_PROMPT_PREFIX}\n\nthe sidebar count is wrong`);
  });

  it("leaves other modes untouched", () => {
    for (const interactionMode of ["default", "plan", undefined] as const) {
      expect(withProviderDebugModePrompt({ interactionMode, text: "hi" })).toBe("hi");
    }
  });

  it("does not stack the prefix when a turn is retried", () => {
    const once = withProviderDebugModePrompt({ interactionMode: "debug", text: "hi" });
    const twice = withProviderDebugModePrompt({ interactionMode: "debug", text: once });
    expect(twice).toBe(once);
    expect(twice.split(PROVIDER_DEBUG_MODE_PROMPT_PREFIX)).toHaveLength(2);
  });

  it("still sends the instructions when the message is empty", () => {
    expect(withProviderDebugModePrompt({ interactionMode: "debug", text: "" })).toBe(
      PROVIDER_DEBUG_MODE_PROMPT_PREFIX,
    );
  });
});

describe("debugModePromptOverheadChars", () => {
  it("reserves exactly what the prefix will add", () => {
    const text = "reproduce the crash";
    const overhead = debugModePromptOverheadChars("debug");
    const prefixed = withProviderDebugModePrompt({ interactionMode: "debug", text });
    expect(prefixed.length).toBe(text.length + overhead);
  });

  it("reserves nothing outside debug mode", () => {
    expect(debugModePromptOverheadChars("default")).toBe(0);
    expect(debugModePromptOverheadChars("plan")).toBe(0);
    expect(debugModePromptOverheadChars(undefined)).toBe(0);
  });
});

describe("toNativeInteractionMode", () => {
  it("keeps plan and default as-is", () => {
    expect(toNativeInteractionMode("plan")).toBe("plan");
    expect(toNativeInteractionMode("default")).toBe("default");
  });

  it("maps debug onto the default collaboration mode", () => {
    // Codex's ModeKind is "plan" | "default"; sending "debug" would be a
    // protocol violation, and debug must never inherit plan's restrictions.
    expect(toNativeInteractionMode("debug")).toBe("default");
  });

  it("passes through undefined so callers can leave the mode unchanged", () => {
    expect(toNativeInteractionMode(undefined)).toBeUndefined();
  });
});

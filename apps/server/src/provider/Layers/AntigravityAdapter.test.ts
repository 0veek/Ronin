import { describe, expect, it } from "vite-plus/test";

import { antigravityAccessArgs, antigravityTurnArgs } from "./AntigravityAdapter.ts";

describe("antigravityAccessArgs", () => {
  it("skips permission prompts only when the thread asked for full access", () => {
    expect(
      antigravityAccessArgs({ runtimeMode: "full-access", interactionMode: "default" }),
    ).toEqual(["--dangerously-skip-permissions"]);
    expect(antigravityAccessArgs({ runtimeMode: "auto", interactionMode: undefined })).toEqual([
      "--dangerously-skip-permissions",
    ]);
  });

  it("leaves a supervised thread supervised", () => {
    expect(
      antigravityAccessArgs({ runtimeMode: "approval-required", interactionMode: "default" }),
    ).toEqual([]);
  });

  it("maps auto-accept-edits onto the CLI's own mode", () => {
    expect(
      antigravityAccessArgs({ runtimeMode: "auto-accept-edits", interactionMode: undefined }),
    ).toEqual(["--mode", "accept-edits"]);
  });

  it("lets plan mode win over the access setting", () => {
    expect(antigravityAccessArgs({ runtimeMode: "full-access", interactionMode: "plan" })).toEqual([
      "--mode",
      "plan",
    ]);
  });
});

describe("antigravityTurnArgs", () => {
  const base = {
    model: "gemini-3.7-flash-high",
    prompt: "hello",
    runtimeMode: "full-access",
    interactionMode: undefined,
  } as const;

  it("opens a project on the first turn and resumes the conversation after that", () => {
    expect(antigravityTurnArgs({ ...base, conversationId: undefined })).toContain("--new-project");
    const resumed = antigravityTurnArgs({ ...base, conversationId: "conv-1" });
    expect(resumed.slice(0, 2)).toEqual(["--conversation", "conv-1"]);
    expect(resumed).not.toContain("--new-project");
  });

  it("always asks for the NDJSON stream, which is where the conversation id lives", () => {
    const args = antigravityTurnArgs({ ...base, conversationId: undefined });
    const formatIndex = args.indexOf("--output-format");
    expect(args[formatIndex + 1]).toBe("stream-json");
  });

  it("passes the model and prompt through untouched", () => {
    const args = antigravityTurnArgs({ ...base, conversationId: undefined });
    expect(args[args.indexOf("--model") + 1]).toBe("gemini-3.7-flash-high");
    expect(args.at(-2)).toBe("-p");
    expect(args.at(-1)).toBe("hello");
  });
});

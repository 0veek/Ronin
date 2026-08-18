import { describe, expect, it } from "vite-plus/test";

import { describeDirectiveFailure, parseBuildSystemDirective } from "./directive.ts";

function fence(body: string): string {
  return ["```t3-directive", body, "```"].join("\n");
}

describe("parseBuildSystemDirective", () => {
  it("reads a delegate directive from a fenced block", () => {
    const result = parseBuildSystemDirective(
      `I'll have the implementer take this.\n\n${fence('{"action":"delegate","role":"implementer","task":"Add the parser","context":"see src/"}')}`,
    );

    expect(result).toEqual({
      ok: true,
      directive: {
        action: "delegate",
        role: "implementer",
        task: "Add the parser",
        context: "see src/",
      },
    });
  });

  it("defaults a delegate directive's context to null", () => {
    const result = parseBuildSystemDirective(fence('{"action":"delegate","role":"r","task":"t"}'));
    expect(result.ok && result.directive).toEqual({
      action: "delegate",
      role: "r",
      task: "t",
      context: null,
    });
  });

  it("reads ask_user and done directives", () => {
    expect(
      parseBuildSystemDirective(fence('{"action":"ask_user","question":"Which database?"}')),
    ).toEqual({ ok: true, directive: { action: "ask_user", question: "Which database?" } });

    expect(parseBuildSystemDirective(fence('{"action":"done","summary":"Shipped it"}'))).toEqual({
      ok: true,
      directive: { action: "done", summary: "Shipped it" },
    });
  });

  it("takes the last block when a model shows its working", () => {
    const message = [
      "First I considered:",
      fence('{"action":"delegate","role":"reviewer","task":"draft"}'),
      "but actually:",
      fence('{"action":"delegate","role":"implementer","task":"final"}'),
    ].join("\n\n");

    const result = parseBuildSystemDirective(message);
    expect(result.ok && result.directive).toMatchObject({ role: "implementer", task: "final" });
  });

  it("tolerates casing, spacing, and info strings on the fence", () => {
    const message = '```t3-directive json\n{"action":"Ask User","question":"why?"}\n```';
    expect(parseBuildSystemDirective(message)).toEqual({
      ok: true,
      directive: { action: "ask_user", question: "why?" },
    });
  });

  it("tolerates trailing commas and alternate field names", () => {
    expect(
      parseBuildSystemDirective(fence('{"action":"delegate","to":"reviewer","task":"look",}')),
    ).toMatchObject({ ok: true, directive: { role: "reviewer" } });
  });

  it("accepts an unfenced directive object as a fallback", () => {
    const result = parseBuildSystemDirective(
      'Handing off. {"action": "done", "summary": "all green"}',
    );
    expect(result).toEqual({ ok: true, directive: { action: "done", summary: "all green" } });
  });

  it("reports a missing directive when the reply is only prose", () => {
    const result = parseBuildSystemDirective("I think we should probably start with the parser.");
    expect(result).toEqual({ ok: false, failure: { reason: "missing" } });
  });

  it("treats prose mentioning an action as missing, not malformed", () => {
    const result = parseBuildSystemDirective('The {"action" field} is what matters here.');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("missing");
  });

  it("reports malformed JSON inside a real block", () => {
    const result = parseBuildSystemDirective(fence("{not json at all"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("malformed");
  });

  it("reports an unknown action", () => {
    const result = parseBuildSystemDirective(fence('{"action":"deploy"}'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("unknown-action");
  });

  it("reports a delegate directive with no task", () => {
    const result = parseBuildSystemDirective(fence('{"action":"delegate","role":"reviewer"}'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.reason).toBe("incomplete");
    expect(!result.ok && describeDirectiveFailure(result.failure)).toContain("task");
  });

  it("rejects blank fields rather than delegating an empty task", () => {
    const result = parseBuildSystemDirective(
      fence('{"action":"delegate","role":"reviewer","task":"   "}'),
    );
    expect(result.ok).toBe(false);
  });
});

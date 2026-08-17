import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";

import {
  classifyQuotaFailure,
  parseExplicitResetAt,
  RESUME_PAD_MS,
  resolveResumeAt,
  resumableProviderKind,
} from "./quotaFailureClassification.ts";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const classify = (message: string | null | undefined) =>
  classifyQuotaFailure({ message, nowMs: NOW });

describe("classifyQuotaFailure", () => {
  it("recognises the ways providers say a window is spent", () => {
    expect(classify("You've reached your usage limit. Try again later.")).not.toBeNull();
    expect(classify("Usage limit reached")).not.toBeNull();
    expect(classify("Quota exceeded for this plan")).not.toBeNull();
    expect(classify("You are out of credits")).not.toBeNull();
    expect(classify("Weekly limit reached")).not.toBeNull();
  });

  it("leaves ordinary failures alone", () => {
    expect(classify("Turn failed")).toBeNull();
    expect(classify("ECONNRESET")).toBeNull();
    expect(classify(null)).toBeNull();
    expect(classify(undefined)).toBeNull();
    expect(classify("")).toBeNull();
  });

  it("does not park short per-minute throttles", () => {
    // Waiting hours for a throttle that clears in seconds would strand the
    // turn, so a bare rate-limit phrase must not match.
    expect(classify("429 Too Many Requests")).toBeNull();
    expect(classify("rate limit")).toBeNull();
  });

  it("does not park failures that waiting cannot fix", () => {
    expect(classify("Quota exceeded — please add a payment method")).toBeNull();
    expect(classify("Usage limit reached: invalid api key")).toBeNull();
    expect(classify("Context window exceeded, quota exceeded")).toBeNull();
  });

  it("names the window when the message does", () => {
    expect(classify("Weekly limit reached")?.windowKind).toBe("weekly");
    expect(classify("Monthly limit reached")?.windowKind).toBe("monthly");
    expect(classify("You've reached your usage limit for this 5-hour window")?.windowKind).toBe(
      "session",
    );
    expect(classify("Usage limit reached")?.windowKind).toBeNull();
  });

  it("carries an explicit reset time through", () => {
    expect(classify("Usage limit reached. Limit resets at 2026-08-17T17:00:00Z")).toEqual({
      windowKind: null,
      explicitResetAt: "2026-08-17T17:00:00.000Z",
    });
  });
});

describe("parseExplicitResetAt", () => {
  it("reads an absolute timestamp in the future", () => {
    expect(parseExplicitResetAt("resets at 2026-08-17T17:00:00Z", NOW)).toBe(
      "2026-08-17T17:00:00.000Z",
    );
  });

  it("ignores a time that has already passed", () => {
    // A past timestamp is a log line or a window that already turned over,
    // not a reset worth waiting for.
    expect(parseExplicitResetAt("started at 2026-08-17T09:00:00Z", NOW)).toBeNull();
  });

  it("ignores an implausibly distant match", () => {
    expect(parseExplicitResetAt("expires 2030-01-01T00:00:00Z", NOW)).toBeNull();
  });

  it("takes nothing from a relative phrase it cannot anchor", () => {
    expect(parseExplicitResetAt("your limit will reset at 3pm", NOW)).toBeNull();
  });
});

describe("resumableProviderKind", () => {
  it("accepts only providers with a readable window", () => {
    expect(resumableProviderKind("claude")).toBe("claude");
    expect(resumableProviderKind("codex")).toBe("codex");
    expect(resumableProviderKind("grok")).toBe("grok");
    expect(resumableProviderKind("cursor")).toBeNull();
    expect(resumableProviderKind(null)).toBeNull();
    expect(resumableProviderKind(undefined)).toBeNull();
  });
});

describe("resolveResumeAt", () => {
  it("prefers the provider's own reset over the usage snapshot", () => {
    const resumeAt = resolveResumeAt({
      explicitResetAt: "2026-08-17T17:00:00.000Z",
      windowResetAt: "2026-08-17T20:00:00.000Z",
      nowMs: NOW,
    });
    expect(resumeAt).toBe(iso(Date.parse("2026-08-17T17:00:00.000Z") + RESUME_PAD_MS));
  });

  it("falls back to the snapshot when the message named no time", () => {
    const resumeAt = resolveResumeAt({
      explicitResetAt: null,
      windowResetAt: "2026-08-17T20:00:00.000Z",
      nowMs: NOW,
    });
    expect(resumeAt).toBe(iso(Date.parse("2026-08-17T20:00:00.000Z") + RESUME_PAD_MS));
  });

  it("pads a reset that already passed instead of firing straight back into the wall", () => {
    const resumeAt = resolveResumeAt({
      explicitResetAt: null,
      windowResetAt: "2026-08-17T11:00:00.000Z",
      nowMs: NOW,
    });
    expect(resumeAt).toBe(iso(NOW + RESUME_PAD_MS));
  });

  it("declines when no reset time is knowable", () => {
    expect(resolveResumeAt({ explicitResetAt: null, windowResetAt: null, nowMs: NOW })).toBeNull();
    expect(
      resolveResumeAt({ explicitResetAt: null, windowResetAt: "not a date", nowMs: NOW }),
    ).toBeNull();
  });
});

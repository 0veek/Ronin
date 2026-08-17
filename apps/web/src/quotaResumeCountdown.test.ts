import { describe, expect, it } from "vite-plus/test";

import {
  formatQuotaResumeCountdown,
  formatQuotaResumeProvider,
  formatQuotaResumeWindow,
} from "./quotaResumeCountdown";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const countdown = (offsetMs: number) =>
  formatQuotaResumeCountdown({ resumeAtMs: NOW + offsetMs, nowMs: NOW });

describe("formatQuotaResumeCountdown", () => {
  it("stops showing a clock once the wait is over", () => {
    expect(countdown(0)).toBeNull();
    expect(countdown(-5_000)).toBeNull();
  });

  it("collapses the final minute rather than counting seconds", () => {
    expect(countdown(1_000)).toBe("in under a minute");
    expect(countdown(59_000)).toBe("in under a minute");
  });

  it("rounds up so the banner never promises a reset that has not happened", () => {
    // 61s left is "2m" and not "1m": at "1m" the user would expect it to fire
    // within the next sixty seconds, and it would not.
    expect(countdown(61_000)).toBe("in 2m");
    expect(countdown(42 * 60_000)).toBe("in 42m");
  });

  it("switches to hours at the hour boundary", () => {
    expect(countdown(60 * 60_000)).toBe("in 1h");
    expect(countdown(90 * 60_000)).toBe("in 1h 30m");
    expect(countdown(5 * 60 * 60_000)).toBe("in 5h");
  });

  it("drops minutes past a day, where they are noise", () => {
    expect(countdown(24 * 60 * 60_000)).toBe("in 1d");
    expect(countdown((3 * 24 + 5) * 60 * 60_000)).toBe("in 3d 5h");
  });

  it("treats a non-finite instant as no countdown rather than rendering NaN", () => {
    expect(formatQuotaResumeCountdown({ resumeAtMs: Number.NaN, nowMs: NOW })).toBeNull();
  });
});

describe("formatQuotaResumeProvider", () => {
  it("uses each provider's own capitalisation", () => {
    expect(formatQuotaResumeProvider("claude")).toBe("Claude");
    expect(formatQuotaResumeProvider("codex")).toBe("Codex");
    expect(formatQuotaResumeProvider("grok")).toBe("Grok");
  });
});

describe("formatQuotaResumeWindow", () => {
  it("names the window when the provider named one", () => {
    expect(formatQuotaResumeWindow("session")).toBe("5-hour limit");
    expect(formatQuotaResumeWindow("weekly")).toBe("weekly limit");
    expect(formatQuotaResumeWindow("monthly")).toBe("monthly limit");
  });

  it("invents nothing when it did not", () => {
    expect(formatQuotaResumeWindow(null)).toBeNull();
  });
});

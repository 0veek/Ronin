import { describe, expect, it } from "vite-plus/test";

import { codexWindowSnapshot } from "./providerRateLimitSources.ts";
import {
  classifyCodexWindows,
  mapCodexWindow,
  SESSION_WINDOW_MINUTES,
  WEEKLY_WINDOW_MINUTES,
} from "./rateLimitWindows.ts";

/** One window exactly as `chatgpt.com/backend-api/wham/usage` sends it. */
function backendWindow(usedPercent: number, limitWindowSeconds: number, resetAt: number) {
  return {
    used_percent: usedPercent,
    limit_window_seconds: limitWindowSeconds,
    reset_at: resetAt,
  };
}

describe("codexWindowSnapshot", () => {
  it("converts the backend's seconds into minutes", () => {
    // The REST endpoint sends `limit_window_seconds`, not a minute count. Read
    // under the wrong name the duration is simply absent, and an absent
    // duration is what makes classification fall back to field position.
    expect(codexWindowSnapshot(backendWindow(40, 18_000, 1_770_000_000))).toEqual({
      usedPercent: 40,
      windowDurationMins: SESSION_WINDOW_MINUTES,
      resetsAt: 1_770_000_000,
    });

    expect(codexWindowSnapshot(backendWindow(12, 604_800, 1_770_000_000))?.windowDurationMins).toBe(
      WEEKLY_WINDOW_MINUTES,
    );
  });

  it("still reads the app server's camelCase minute form", () => {
    expect(
      codexWindowSnapshot({ usedPercent: 55, windowDurationMins: 300, resetsAt: 1_770_000_000 }),
    ).toEqual({ usedPercent: 55, windowDurationMins: 300, resetsAt: 1_770_000_000 });
  });

  it("ignores a nonsensical window length rather than dividing it", () => {
    expect(
      codexWindowSnapshot({ used_percent: 5, limit_window_seconds: 0 })?.windowDurationMins,
    ).toBeUndefined();
    expect(codexWindowSnapshot(null)).toBeNull();
    expect(codexWindowSnapshot("nope")).toBeNull();
  });
});

describe("codex window classification, end to end", () => {
  it("labels a lone weekly window as weekly, not as the 5-hour one", () => {
    // The regression this pairs with: with the duration unreadable, the
    // positional fallback assigned `primary_window` to the session slot, so an
    // account reporting only a weekly limit showed it under a "5h" tag.
    const classified = classifyCodexWindows({
      primary: codexWindowSnapshot(backendWindow(67, 604_800, 1_770_000_000)),
      secondary: null,
    });

    expect(classified.weekly?.usedPercent).toBe(67);
    expect(classified.session).toBeNull();

    const window = mapCodexWindow(classified.weekly, "weekly", WEEKLY_WINDOW_MINUTES);
    expect(window).toEqual({
      kind: "weekly",
      usedPercent: 67,
      windowMinutes: WEEKLY_WINDOW_MINUTES,
      resetsAt: "2026-02-02T02:40:00.000Z",
    });
  });

  it("sorts a reversed pair by duration rather than by slot", () => {
    const classified = classifyCodexWindows({
      primary: codexWindowSnapshot(backendWindow(12, 604_800, 1_770_000_000)),
      secondary: codexWindowSnapshot(backendWindow(82, 18_000, 1_770_000_000)),
    });

    expect(classified.session?.usedPercent).toBe(82);
    expect(classified.weekly?.usedPercent).toBe(12);
  });

  it("carries the reset stamp through, which the wrong key silently dropped", () => {
    const window = mapCodexWindow(
      classifyCodexWindows({
        primary: codexWindowSnapshot(backendWindow(40, 18_000, 1_770_000_000)),
      }).session,
      "session",
      SESSION_WINDOW_MINUTES,
    );

    expect(window?.resetsAt).toBe("2026-02-02T02:40:00.000Z");
  });
});

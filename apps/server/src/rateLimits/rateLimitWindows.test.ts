import { describe, expect, it } from "vite-plus/test";

import {
  classifyCodexWindows,
  makeWindow,
  mapClaudeWindow,
  mapCodexWindow,
  normalizeResetsAt,
  SESSION_WINDOW_MINUTES,
  WEEKLY_WINDOW_MINUTES,
} from "./rateLimitWindows.ts";

describe("normalizeResetsAt", () => {
  it("reads a seconds epoch and a milliseconds epoch as the same instant", () => {
    // The providers disagree on the unit and never say which they mean, so the
    // 1e10 split is the only thing standing between a correct reset time and
    // one in 1970.
    const seconds = 1_770_000_000;
    expect(normalizeResetsAt(seconds)).toBe(normalizeResetsAt(seconds * 1000));
    expect(normalizeResetsAt(seconds)).toBe("2026-02-02T02:40:00.000Z");
  });

  it("accepts an ISO string and rejects junk", () => {
    expect(normalizeResetsAt("2026-02-02T02:40:00.000Z")).toBe("2026-02-02T02:40:00.000Z");
    expect(normalizeResetsAt("not a date")).toBeNull();
    expect(normalizeResetsAt("")).toBeNull();
    expect(normalizeResetsAt(null)).toBeNull();
    expect(normalizeResetsAt(undefined)).toBeNull();
    expect(normalizeResetsAt(Number.NaN)).toBeNull();
  });
});

describe("makeWindow", () => {
  it("clamps the percentage into the range the meter can draw", () => {
    // A bar is drawn straight from this number; an out-of-range value would
    // overflow the track rather than reading as "full".
    expect(makeWindow("weekly", 140, WEEKLY_WINDOW_MINUTES, null).usedPercent).toBe(100);
    expect(makeWindow("weekly", -3, WEEKLY_WINDOW_MINUTES, null).usedPercent).toBe(0);
  });
});

describe("mapClaudeWindow", () => {
  it("maps a reported utilization", () => {
    expect(mapClaudeWindow({ utilization: 70, resets_at: 1_770_000_000 }, "session", 300)).toEqual({
      kind: "session",
      usedPercent: 70,
      windowMinutes: 300,
      resetsAt: "2026-02-02T02:40:00.000Z",
    });
  });

  it("drops a window with no utilization rather than calling it zero", () => {
    // An absent figure means "not reported". Rendering it as 0% would tell the
    // user they have their whole quota left, which is the dangerous direction
    // to be wrong in.
    expect(mapClaudeWindow({ resets_at: 1 }, "session", 300)).toBeNull();
    expect(mapClaudeWindow({ utilization: null }, "session", 300)).toBeNull();
    expect(mapClaudeWindow(null, "session", 300)).toBeNull();
  });
});

describe("classifyCodexWindows", () => {
  it("sorts by reported duration, not by field position", () => {
    // Codex has shipped these the other way round; trusting the field names
    // would label the weekly bucket as the 5-hour one.
    const classified = classifyCodexWindows({
      primary: { usedPercent: 12, windowDurationMins: WEEKLY_WINDOW_MINUTES },
      secondary: { usedPercent: 80, windowDurationMins: SESSION_WINDOW_MINUTES },
    });

    expect(classified.session?.usedPercent).toBe(80);
    expect(classified.weekly?.usedPercent).toBe(12);
  });

  it("tolerates a one-minute drift in the bucket length", () => {
    const classified = classifyCodexWindows({
      primary: { usedPercent: 5, windowDurationMins: SESSION_WINDOW_MINUTES - 1 },
      secondary: { usedPercent: 6, windowDurationMins: WEEKLY_WINDOW_MINUTES + 1 },
    });

    expect(classified.session?.usedPercent).toBe(5);
    expect(classified.weekly?.usedPercent).toBe(6);
  });

  it("falls back to the positional reading when durations are unusable", () => {
    // Better to show the pre-duration layout than to drop both rows.
    const classified = classifyCodexWindows({
      primary: { usedPercent: 5 },
      secondary: { usedPercent: 6, windowDurationMins: 999 },
    });

    expect(classified.session?.usedPercent).toBe(5);
    expect(classified.weekly?.usedPercent).toBe(6);
  });

  it("ignores a window with no percentage", () => {
    const classified = classifyCodexWindows({
      primary: { windowDurationMins: SESSION_WINDOW_MINUTES },
      secondary: null,
    });

    expect(classified.session).toBeNull();
    expect(classified.weekly).toBeNull();
  });
});

describe("mapCodexWindow", () => {
  it("keeps the reported duration rather than the nominal one", () => {
    const window = mapCodexWindow(
      { usedPercent: 40, windowDurationMins: 299, resetsAt: 1_770_000_000 },
      "session",
      SESSION_WINDOW_MINUTES,
    );

    expect(window).toEqual({
      kind: "session",
      usedPercent: 40,
      windowMinutes: 299,
      resetsAt: "2026-02-02T02:40:00.000Z",
    });
  });

  it("uses the fallback length when the duration is missing or nonsense", () => {
    expect(
      mapCodexWindow({ usedPercent: 40 }, "weekly", WEEKLY_WINDOW_MINUTES)?.windowMinutes,
    ).toBe(WEEKLY_WINDOW_MINUTES);
    expect(
      mapCodexWindow({ usedPercent: 40, windowDurationMins: 0 }, "weekly", WEEKLY_WINDOW_MINUTES)
        ?.windowMinutes,
    ).toBe(WEEKLY_WINDOW_MINUTES);
  });
});

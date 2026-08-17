import { describe, expect, it } from "vite-plus/test";
import type { Automation } from "@t3tools/contracts";

import {
  formatNextRun,
  formatSchedule,
  formatTimeOfDay,
  formatWeekdays,
  parseTimeOfDay,
  toggleWeekday,
} from "./automationPresentation";

describe("formatTimeOfDay / parseTimeOfDay", () => {
  it("round-trips a time", () => {
    expect(formatTimeOfDay(540)).toBe("09:00");
    expect(parseTimeOfDay("09:00")).toBe(540);
    expect(parseTimeOfDay(formatTimeOfDay(0))).toBe(0);
    expect(parseTimeOfDay(formatTimeOfDay(23 * 60 + 59))).toBe(23 * 60 + 59);
  });

  it("accepts a single-digit hour", () => {
    expect(parseTimeOfDay("9:05")).toBe(545);
  });

  it("rejects times that are not times", () => {
    expect(parseTimeOfDay("")).toBeNull();
    expect(parseTimeOfDay("9")).toBeNull();
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("09:60")).toBeNull();
    expect(parseTimeOfDay("nine")).toBeNull();
  });
});

describe("formatWeekdays", () => {
  it("reads an empty set as every day", () => {
    // The contract treats empty as unrestricted, so the label has to agree —
    // otherwise the form says one thing and the scheduler does another.
    expect(formatWeekdays([])).toBe("every day");
  });

  it("names the common sets", () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe("every weekday");
    expect(formatWeekdays([0, 6])).toBe("every weekend");
  });

  it("is order-insensitive", () => {
    expect(formatWeekdays([5, 3, 1, 4, 2])).toBe("every weekday");
  });

  it("lists anything else", () => {
    expect(formatWeekdays([1, 3])).toBe("on Mon, Wed");
  });
});

describe("formatSchedule", () => {
  it("phrases an interval in the largest whole unit", () => {
    expect(formatSchedule({ _tag: "interval", everyMinutes: 30 })).toBe("Every 30 minutes");
    expect(formatSchedule({ _tag: "interval", everyMinutes: 60 })).toBe("Every hour");
    expect(formatSchedule({ _tag: "interval", everyMinutes: 360 })).toBe("Every 6 hours");
    expect(formatSchedule({ _tag: "interval", everyMinutes: 1440 })).toBe("Every day");
    expect(formatSchedule({ _tag: "interval", everyMinutes: 2880 })).toBe("Every 2 days");
  });

  it("phrases a daily schedule as a sentence", () => {
    expect(formatSchedule({ _tag: "daily", timeOfDay: 540, weekdays: [1, 2, 3, 4, 5] })).toBe(
      "Every weekday at 09:00",
    );
    expect(formatSchedule({ _tag: "daily", timeOfDay: 0, weekdays: [] })).toBe(
      "Every day at 00:00",
    );
    expect(formatSchedule({ _tag: "daily", timeOfDay: 930, weekdays: [1, 3] })).toBe(
      "On Mon, Wed at 15:30",
    );
  });

  it("phrases a one-shot", () => {
    expect(formatSchedule({ _tag: "once", at: "2026-08-17T09:00:00.000Z" })).toBe("Once");
  });
});

const automation = (overrides: Partial<Automation>): Automation =>
  ({
    id: "a",
    projectId: "p",
    title: "t",
    prompt: "p",
    schedule: { _tag: "interval", everyMinutes: 60 },
    envMode: "worktree",
    modelSelection: null,
    enabled: true,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: "2026-08-17T10:00:00.000Z",
    ...overrides,
  }) as Automation;

describe("formatNextRun", () => {
  const formatter = (iso: string) => `@${iso}`;

  it("says paused rather than showing a stale time", () => {
    expect(formatNextRun(automation({ enabled: false }), formatter)).toBe("Paused");
  });

  it("says so when nothing is scheduled", () => {
    expect(formatNextRun(automation({ nextRunAt: null }), formatter)).toBe("Not scheduled");
  });

  it("defers the wording of the instant to the caller", () => {
    expect(formatNextRun(automation({}), formatter)).toBe("Next @2026-08-17T10:00:00.000Z");
  });
});

describe("toggleWeekday", () => {
  it("adds and removes, staying sorted", () => {
    expect(toggleWeekday([1, 3], 2)).toEqual([1, 2, 3]);
    expect(toggleWeekday([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("empties to the unrestricted set rather than an impossible one", () => {
    expect(toggleWeekday([3], 3)).toEqual([]);
  });
});

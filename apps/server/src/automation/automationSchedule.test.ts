import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";

import {
  AUTOMATION_CATCH_UP_WINDOW_MS,
  isStale,
  nextRunAtMs,
  shouldFireNow,
} from "./automationSchedule.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Local-midnight-anchored helper, so these assertions hold in any zone. */
function localInstant(daysFromEpochMonday: number, hours: number, minutes = 0): number {
  // 2026-08-17 is a Monday. Building through the Date constructor's local
  // overload keeps every assertion in the host zone, which is what the
  // scheduler itself reasons in.
  const base = DateTime.setZone(
    DateTime.makeUnsafe("2026-08-17T00:00:00Z"),
    DateTime.zoneMakeLocal(),
  );
  const day = DateTime.add(DateTime.setParts(base, { hour: 12 }), {
    days: daysFromEpochMonday,
  });
  return DateTime.toEpochMillis(
    DateTime.setParts(day, { hour: hours, minute: minutes, second: 0, millisecond: 0 }),
  );
}

const MONDAY_8AM = localInstant(0, 8);

describe("nextRunAtMs — once", () => {
  const at = DateTime.formatIso(DateTime.makeUnsafe(localInstant(0, 15)));

  it("returns the instant when it has not fired", () => {
    expect(
      nextRunAtMs({ schedule: { _tag: "once", at }, afterMs: MONDAY_8AM, lastRunAtMs: null }),
    ).toBe(localInstant(0, 15));
  });

  it("never fires twice", () => {
    expect(
      nextRunAtMs({
        schedule: { _tag: "once", at },
        afterMs: MONDAY_8AM,
        lastRunAtMs: localInstant(0, 15),
      }),
    ).toBeNull();
  });

  it("declines an unparseable instant rather than firing immediately", () => {
    expect(
      nextRunAtMs({
        schedule: { _tag: "once", at: "nope" },
        afterMs: MONDAY_8AM,
        lastRunAtMs: null,
      }),
    ).toBeNull();
  });
});

describe("nextRunAtMs — interval", () => {
  const schedule = { _tag: "interval", everyMinutes: 60 } as const;

  it("starts one interval out when it has never run", () => {
    expect(nextRunAtMs({ schedule, afterMs: MONDAY_8AM, lastRunAtMs: null })).toBe(
      MONDAY_8AM + HOUR,
    );
  });

  it("counts from the last run", () => {
    expect(
      nextRunAtMs({ schedule, afterMs: MONDAY_8AM, lastRunAtMs: MONDAY_8AM - 30 * MINUTE }),
    ).toBe(MONDAY_8AM + 30 * MINUTE);
  });

  it("fires once when it has fallen behind, not once per missed window", () => {
    // A suspend, or a turn that outran its own interval. Replaying every
    // elapsed window would stampede the provider with stale work.
    expect(
      nextRunAtMs({ schedule, afterMs: MONDAY_8AM, lastRunAtMs: MONDAY_8AM - 10 * HOUR }),
    ).toBe(MONDAY_8AM);
  });
});

describe("nextRunAtMs — daily", () => {
  const at9 = { _tag: "daily", timeOfDay: 9 * 60, weekdays: [] } as const;

  it("returns today when the time is still ahead", () => {
    expect(nextRunAtMs({ schedule: at9, afterMs: MONDAY_8AM, lastRunAtMs: null })).toBe(
      localInstant(0, 9),
    );
  });

  it("rolls to tomorrow once today's time has passed", () => {
    expect(nextRunAtMs({ schedule: at9, afterMs: localInstant(0, 10), lastRunAtMs: null })).toBe(
      localInstant(1, 9),
    );
  });

  it("treats an empty weekday set as every day", () => {
    // A form that lets you deselect every day should read as "no restriction",
    // not as "this will never run again".
    expect(nextRunAtMs({ schedule: at9, afterMs: MONDAY_8AM, lastRunAtMs: null })).not.toBeNull();
  });

  it("skips to the next selected weekday", () => {
    // Monday is 1; ask for Wednesday (3) and Friday (5).
    const schedule = { _tag: "daily", timeOfDay: 9 * 60, weekdays: [3, 5] } as const;
    expect(nextRunAtMs({ schedule, afterMs: MONDAY_8AM, lastRunAtMs: null })).toBe(
      localInstant(2, 9),
    );
  });

  it("wraps around the week", () => {
    // From Wednesday, asking only for Monday lands on the following Monday.
    const schedule = { _tag: "daily", timeOfDay: 9 * 60, weekdays: [1] } as const;
    expect(nextRunAtMs({ schedule, afterMs: localInstant(2, 10), lastRunAtMs: null })).toBe(
      localInstant(7, 9),
    );
  });

  it("keeps the stated wall-clock time on every day it returns", () => {
    // The guard against adding 24h across a daylight-saving boundary and
    // landing at 08:00 or 10:00.
    for (let day = 0; day < 8; day += 1) {
      const next = nextRunAtMs({
        schedule: at9,
        afterMs: localInstant(day, 10),
        lastRunAtMs: null,
      });
      expect(next).not.toBeNull();
      const parts = DateTime.toParts(
        DateTime.setZone(DateTime.makeUnsafe(next as number), DateTime.zoneMakeLocal()),
      );
      expect(parts.hour).toBe(9);
      expect(parts.minute).toBe(0);
    }
  });

  it("handles midnight as a time of day", () => {
    const midnight = { _tag: "daily", timeOfDay: 0, weekdays: [] } as const;
    const next = nextRunAtMs({ schedule: midnight, afterMs: MONDAY_8AM, lastRunAtMs: null });
    expect(
      DateTime.toParts(
        DateTime.setZone(DateTime.makeUnsafe(next as number), DateTime.zoneMakeLocal()),
      ).hour,
    ).toBe(0);
    expect(next).toBe(localInstant(1, 0));
  });
});

describe("shouldFireNow", () => {
  it("does not fire before the due time", () => {
    expect(shouldFireNow({ nextRunAtMs: MONDAY_8AM + MINUTE, nowMs: MONDAY_8AM })).toBe(false);
  });

  it("fires at the due time", () => {
    expect(shouldFireNow({ nextRunAtMs: MONDAY_8AM, nowMs: MONDAY_8AM })).toBe(true);
  });

  it("still fires a run the machine slept through", () => {
    expect(shouldFireNow({ nextRunAtMs: MONDAY_8AM, nowMs: MONDAY_8AM + 20 * MINUTE })).toBe(true);
  });

  it("abandons a run that is hours late", () => {
    expect(
      shouldFireNow({
        nextRunAtMs: MONDAY_8AM,
        nowMs: MONDAY_8AM + AUTOMATION_CATCH_UP_WINDOW_MS + MINUTE,
      }),
    ).toBe(false);
  });

  it("never fires when there is no due time", () => {
    expect(shouldFireNow({ nextRunAtMs: null, nowMs: MONDAY_8AM })).toBe(false);
  });
});

describe("isStale", () => {
  it("is false for a due time inside the catch-up window", () => {
    expect(isStale({ nextRunAtMs: MONDAY_8AM, nowMs: MONDAY_8AM + MINUTE })).toBe(false);
  });

  it("is true once the window has passed", () => {
    expect(
      isStale({
        nextRunAtMs: MONDAY_8AM,
        nowMs: MONDAY_8AM + AUTOMATION_CATCH_UP_WINDOW_MS + MINUTE,
      }),
    ).toBe(true);
  });

  it("is false when nothing is due", () => {
    expect(isStale({ nextRunAtMs: null, nowMs: MONDAY_8AM })).toBe(false);
  });
});

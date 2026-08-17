/**
 * When an automation fires next.
 *
 * Pure, and separated from the scheduler for one reason: every interesting
 * failure of a scheduler is a date arithmetic failure — the run that fires
 * twice across a daylight-saving change, the daily job that skips the day the
 * laptop was shut, the interval that stampedes after a suspend. Those are
 * testable here against fixed instants, and nowhere else.
 *
 * All local-time reasoning uses the host's zone, deliberately. "Every weekday
 * at 9" means nine where the machine is, and a job that drifts an hour every
 * spring is a job nobody trusts.
 *
 * @module automationSchedule
 */
import type { AutomationSchedule } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const MINUTE_MS = 60_000;

/**
 * How far behind a due time the scheduler will still fire.
 *
 * A laptop that was asleep at 09:00 should still run the morning job when it
 * wakes at 09:20 — that is the whole point of a schedule you do not babysit.
 * A laptop that was shut for a week should not wake up and run Monday's job on
 * Friday: by then the run is not late, it is wrong.
 */
export const AUTOMATION_CATCH_UP_WINDOW_MS = 2 * 60 * MINUTE_MS;

/** The host's own zone — see the module note on why this is not UTC. */
function localZoned(atMs: number): DateTime.Zoned {
  return DateTime.setZone(DateTime.makeUnsafe(atMs), DateTime.zoneMakeLocal());
}

/**
 * The instant of `timeOfDay` on the local day of `at`.
 *
 * Built by setting the wall-clock parts rather than adding milliseconds to
 * midnight, so a day that is 23 or 25 hours long still puts the job at the
 * stated time.
 */
function localTimeOnDay(at: DateTime.Zoned, timeOfDayMinutes: number): DateTime.Zoned {
  return DateTime.setParts(at, {
    hour: Math.floor(timeOfDayMinutes / 60),
    minute: timeOfDayMinutes % 60,
    second: 0,
    millisecond: 0,
  });
}

function matchesWeekday(at: DateTime.Zoned, weekdays: ReadonlyArray<number>): boolean {
  // Empty means every day: a UI that lets you deselect every weekday should
  // read as "no restriction" rather than "never runs again".
  if (weekdays.length === 0) return true;
  return weekdays.includes(DateTime.toParts(at).weekDay);
}

/**
 * The next fire time strictly after `afterMs`.
 *
 * `null` means never again — a `once` schedule that has gone, or a `daily`
 * schedule with a weekday set that cannot be satisfied.
 */
export function nextRunAtMs({
  schedule,
  afterMs,
  lastRunAtMs,
}: {
  readonly schedule: AutomationSchedule;
  readonly afterMs: number;
  /** Anchors an interval schedule. Absent means it has never run. */
  readonly lastRunAtMs: number | null;
}): number | null {
  switch (schedule._tag) {
    case "once": {
      const at = Date.parse(schedule.at);
      if (Number.isNaN(at)) return null;
      // Already fired, or fired while we were not looking.
      if (lastRunAtMs !== null && lastRunAtMs >= at) return null;
      return at;
    }

    case "interval": {
      const stepMs = schedule.everyMinutes * MINUTE_MS;
      if (lastRunAtMs === null) return afterMs + stepMs;
      const candidate = lastRunAtMs + stepMs;
      if (candidate > afterMs) return candidate;
      // Behind schedule — a suspend, or a turn that ran longer than the
      // interval. Fire once, now, rather than replaying every window that
      // elapsed: a queue of stale runs is never what the user wanted.
      return afterMs;
    }

    case "daily": {
      // Walk forward a calendar day at a time rather than adding 24 hours, so
      // a daylight-saving transition cannot shift the hour the job runs at.
      let day = localZoned(afterMs);
      for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
        const candidate = localTimeOnDay(day, schedule.timeOfDay);
        const candidateMs = DateTime.toEpochMillis(candidate);
        if (candidateMs > afterMs && matchesWeekday(candidate, schedule.weekdays)) {
          return candidateMs;
        }
        day = DateTime.add(day, { days: 1 });
      }
      // Eight days covers any weekday set that contains at least one day.
      return null;
    }
  }
}

/**
 * Whether a due automation should actually fire now.
 *
 * Split from {@link nextRunAtMs} because "when is it due" and "is it still
 * worth running" are different questions, and only the second one knows about
 * the machine having been asleep.
 */
export function shouldFireNow({
  nextRunAtMs: dueMs,
  nowMs,
}: {
  readonly nextRunAtMs: number | null;
  readonly nowMs: number;
}): boolean {
  if (dueMs === null) return false;
  if (dueMs > nowMs) return false;
  return nowMs - dueMs <= AUTOMATION_CATCH_UP_WINDOW_MS;
}

/**
 * Whether a due time is so far past that it should be abandoned rather than
 * run late.
 *
 * The caller advances the schedule past a stale due time without firing, which
 * is what stops a machine that was off for a week from running every missed
 * morning the moment it comes back.
 */
export function isStale({
  nextRunAtMs: dueMs,
  nowMs,
}: {
  readonly nextRunAtMs: number | null;
  readonly nowMs: number;
}): boolean {
  if (dueMs === null) return false;
  return nowMs - dueMs > AUTOMATION_CATCH_UP_WINDOW_MS;
}

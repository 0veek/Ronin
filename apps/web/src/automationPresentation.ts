/**
 * Reading a schedule back to the person who wrote it.
 *
 * A schedule is only trustworthy if the app can restate it in the words the
 * user would have used. "Every weekday at 09:00" is a promise; `{_tag:
 * "daily", timeOfDay: 540, weekdays: [1,2,3,4,5]}` is a shrug.
 *
 * @module automationPresentation
 */
import type { Automation, AutomationSchedule } from "@t3tools/contracts";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

/** `540` → `"09:00"`. */
export function formatTimeOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** `"09:00"` → `540`, or `null` when it is not a time. */
export function parseTimeOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function sameSet(left: ReadonlyArray<number>, right: ReadonlyArray<number>): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/** The days part of a daily schedule, phrased for a sentence. */
export function formatWeekdays(weekdays: ReadonlyArray<number>): string {
  if (weekdays.length === 0) return "every day";
  if (sameSet(weekdays, WEEKDAYS)) return "every weekday";
  if (sameSet(weekdays, WEEKEND)) return "every weekend";
  const named = [...weekdays]
    .sort()
    .map((day) => WEEKDAY_NAMES[day] ?? "?")
    .join(", ");
  return `on ${named}`;
}

function formatEveryMinutes(everyMinutes: number): string {
  if (everyMinutes % (60 * 24) === 0) {
    const days = everyMinutes / (60 * 24);
    return days === 1 ? "Every day" : `Every ${days} days`;
  }
  if (everyMinutes % 60 === 0) {
    const hours = everyMinutes / 60;
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  return `Every ${everyMinutes} minutes`;
}

function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
}

export function formatSchedule(schedule: AutomationSchedule): string {
  switch (schedule._tag) {
    case "interval":
      return formatEveryMinutes(schedule.everyMinutes);
    case "daily":
      // `formatWeekdays` is phrased to sit mid-sentence ("... on Mon, Wed"),
      // so it starts lowercase; here it opens the line instead.
      return capitalize(
        `${formatWeekdays(schedule.weekdays)} at ${formatTimeOfDay(schedule.timeOfDay)}`,
      );
    case "once":
      return "Once";
  }
}

/**
 * When it goes next, or why it does not.
 *
 * `formatter` is injected so the caller's timestamp preference decides the
 * wording, and so this stays testable without a locale.
 */
export function formatNextRun(automation: Automation, formatter: (iso: string) => string): string {
  if (!automation.enabled) return "Paused";
  if (automation.nextRunAt === null) return "Not scheduled";
  return `Next ${formatter(automation.nextRunAt)}`;
}

/**
 * Toggle a day, keeping the list sorted and unique.
 *
 * Deselecting the last day yields an empty list, which the contract reads as
 * "every day" — the same thing the form label says, so the round trip is
 * honest rather than a hidden special case.
 */
export function toggleWeekday(weekdays: ReadonlyArray<number>, day: number): ReadonlyArray<number> {
  const next = new Set(weekdays);
  if (next.has(day)) next.delete(day);
  else next.add(day);
  return [...next].sort();
}

export const WEEKDAY_OPTIONS = WEEKDAY_NAMES.map((label, day) => ({ day, label }));

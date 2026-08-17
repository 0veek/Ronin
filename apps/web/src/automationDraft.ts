/**
 * The editable shape of an automation, and the two ways it becomes one.
 *
 * The form works on a draft because a schedule is three shapes that do not
 * share fields. Saving is the only moment those fields have to be a real
 * schedule; until then the Save button stays off.
 *
 * @module automationDraft
 */
import type {
  Automation,
  AutomationCreateInput,
  AutomationId,
  AutomationSchedule,
  AutomationUpdateInput,
  ModelSelection,
  ProjectId,
  ThreadEnvMode,
} from "@t3tools/contracts";
import {
  MAX_AUTOMATION_INTERVAL_MINUTES,
  MIN_AUTOMATION_INTERVAL_MINUTES,
} from "@t3tools/contracts";

import { formatTimeOfDay, parseTimeOfDay } from "./automationPresentation";

export type ScheduleKind = AutomationSchedule["_tag"];

export interface AutomationDraftState {
  /** The automation being edited, or null when this draft is a new one. */
  readonly editing: AutomationId | null;
  readonly projectId: string;
  readonly title: string;
  readonly prompt: string;
  readonly kind: ScheduleKind;
  readonly everyMinutes: number;
  readonly timeOfDayText: string;
  readonly weekdays: ReadonlyArray<number>;
  readonly onceAtText: string;
  readonly envMode: ThreadEnvMode;
  /**
   * Null uses the project's default, exactly as a new thread would. A value
   * pins the run to that provider and model even if the project default later
   * changes.
   */
  readonly modelSelection: ModelSelection | null;
}

export const EMPTY_AUTOMATION_DRAFT: AutomationDraftState = {
  editing: null,
  projectId: "",
  title: "",
  prompt: "",
  kind: "daily",
  everyMinutes: 60,
  timeOfDayText: "09:00",
  weekdays: [1, 2, 3, 4, 5],
  onceAtText: "",
  // Worktree by default: unattended work landing in the checkout somebody is
  // using is the single worst thing an automation can do.
  envMode: "worktree",
  modelSelection: null,
};

export interface AutomationsSearch {
  readonly create?: boolean;
  readonly projectId?: string;
}

function isTruthySearchFlag(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

/** The settings-route search that opens a new draft. */
export function parseAutomationsSearch(raw: Record<string, unknown>): AutomationsSearch {
  return {
    ...(isTruthySearchFlag(raw.create) ? { create: true } : {}),
    ...(typeof raw.projectId === "string" && raw.projectId.length > 0
      ? { projectId: raw.projectId }
      : {}),
  };
}

/** Search to hand the automations page so it opens a new draft. */
export function createAutomationSearch(projectId?: string | null): AutomationsSearch {
  return {
    create: true,
    ...(projectId ? { projectId } : {}),
  };
}

/**
 * The draft as a schedule, or `null` when it is not one yet.
 *
 * Returning null rather than a partial schedule is what lets the Save button
 * stay disabled on a half-typed time instead of saving something surprising.
 */
export function draftSchedule(draft: AutomationDraftState): AutomationSchedule | null {
  switch (draft.kind) {
    case "interval": {
      if (
        !Number.isInteger(draft.everyMinutes) ||
        draft.everyMinutes < MIN_AUTOMATION_INTERVAL_MINUTES ||
        draft.everyMinutes > MAX_AUTOMATION_INTERVAL_MINUTES
      ) {
        return null;
      }
      return { _tag: "interval", everyMinutes: draft.everyMinutes };
    }
    case "daily": {
      const timeOfDay = parseTimeOfDay(draft.timeOfDayText);
      if (timeOfDay === null) return null;
      return { _tag: "daily", timeOfDay, weekdays: draft.weekdays };
    }
    case "once": {
      const at = Date.parse(draft.onceAtText);
      if (Number.isNaN(at)) return null;
      return { _tag: "once", at: new Date(at).toISOString() };
    }
  }
}

/**
 * An existing automation as an editable draft.
 *
 * The fields a schedule kind does not use keep the empty draft's defaults, so
 * switching kind mid-edit lands on something sensible rather than blank.
 */
export function draftFromAutomation(automation: Automation): AutomationDraftState {
  return {
    ...EMPTY_AUTOMATION_DRAFT,
    editing: automation.id,
    projectId: String(automation.projectId),
    title: automation.title,
    prompt: automation.prompt,
    envMode: automation.envMode,
    modelSelection: automation.modelSelection,
    kind: automation.schedule._tag,
    ...(automation.schedule._tag === "interval"
      ? { everyMinutes: automation.schedule.everyMinutes }
      : {}),
    ...(automation.schedule._tag === "daily"
      ? {
          timeOfDayText: formatTimeOfDay(automation.schedule.timeOfDay),
          weekdays: automation.schedule.weekdays,
        }
      : {}),
    ...(automation.schedule._tag === "once"
      ? { onceAtText: automation.schedule.at.slice(0, 16) }
      : {}),
  };
}

/** A new draft, optionally pinned to a project. */
export function startAutomationDraft(projectId = ""): AutomationDraftState {
  return { ...EMPTY_AUTOMATION_DRAFT, projectId };
}

/**
 * Open a new draft from a title-bar or command-palette intent.
 *
 * A requested project id is kept even if it is not in the loaded list yet —
 * the header hands us an id that exists, and waiting for the snapshot would
 * drop it. With no project id, the first loaded project is the fallback.
 */
export function startAutomationDraftFromSearch(
  search: AutomationsSearch,
  projectIds: ReadonlyArray<string>,
): AutomationDraftState | null {
  if (search.create !== true) return null;
  const requested = search.projectId ?? "";
  const projectId = requested.length > 0 ? requested : (projectIds[0] ?? "");
  return startAutomationDraft(projectId);
}

export function isDraftComplete(draft: AutomationDraftState): boolean {
  return (
    draft.projectId.length > 0 &&
    draft.title.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    draftSchedule(draft) !== null
  );
}

export function draftToCreateInput(draft: AutomationDraftState): AutomationCreateInput | null {
  const schedule = draftSchedule(draft);
  if (schedule === null || draft.projectId.length === 0) return null;
  return {
    projectId: draft.projectId as ProjectId,
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    schedule,
    envMode: draft.envMode,
    modelSelection: draft.modelSelection,
  };
}

export function draftToUpdateInput(draft: AutomationDraftState): AutomationUpdateInput | null {
  if (draft.editing === null) return null;
  const schedule = draftSchedule(draft);
  if (schedule === null) return null;
  return {
    id: draft.editing,
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    schedule,
    envMode: draft.envMode,
    modelSelection: draft.modelSelection,
  };
}

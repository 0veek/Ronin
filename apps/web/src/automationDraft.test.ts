import { describe, expect, it } from "vite-plus/test";
import type { Automation, ModelSelection } from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";

import {
  createAutomationSearch,
  draftFromAutomation,
  draftSchedule,
  draftToCreateInput,
  draftToUpdateInput,
  EMPTY_AUTOMATION_DRAFT,
  isDraftComplete,
  parseAutomationsSearch,
  startAutomationDraft,
  startAutomationDraftFromSearch,
} from "./automationDraft";

const modelSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
};

const automation = (overrides: Partial<Automation> = {}): Automation =>
  ({
    id: "auto-1",
    projectId: "proj-1",
    title: "Triage",
    prompt: "Summarise new issues.",
    schedule: { _tag: "daily", timeOfDay: 540, weekdays: [1, 2, 3, 4, 5] },
    envMode: "worktree",
    modelSelection: null,
    enabled: true,
    stopAfterConsecutiveFailures: 3,
    consecutiveFailureCount: 0,
    disabledReason: null,
    disabledAt: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: "2026-08-17T09:00:00.000Z",
    ...overrides,
  }) as Automation;

describe("parseAutomationsSearch / createAutomationSearch", () => {
  it("reads the create flag from the common truthy spellings", () => {
    expect(parseAutomationsSearch({ create: true })).toEqual({ create: true });
    expect(parseAutomationsSearch({ create: "true" })).toEqual({ create: true });
    expect(parseAutomationsSearch({ create: "1" })).toEqual({ create: true });
    expect(parseAutomationsSearch({ create: false })).toEqual({});
    expect(parseAutomationsSearch({})).toEqual({});
  });

  it("keeps a project id only when it is a non-empty string", () => {
    expect(parseAutomationsSearch({ create: true, projectId: "proj-1" })).toEqual({
      create: true,
      projectId: "proj-1",
    });
    expect(parseAutomationsSearch({ projectId: "" })).toEqual({});
  });

  it("builds the search the title bar and palette hand the page", () => {
    expect(createAutomationSearch("proj-1")).toEqual({ create: true, projectId: "proj-1" });
    expect(createAutomationSearch(null)).toEqual({ create: true });
  });
});

describe("startAutomationDraftFromSearch", () => {
  it("returns null when the page was not asked to create", () => {
    expect(startAutomationDraftFromSearch({}, ["proj-1"])).toBeNull();
  });

  it("pins to the requested project when it still exists", () => {
    expect(
      startAutomationDraftFromSearch({ create: true, projectId: "proj-2" }, ["proj-1", "proj-2"]),
    ).toEqual(startAutomationDraft("proj-2"));
  });

  it("keeps a requested project id even before the list has loaded", () => {
    expect(startAutomationDraftFromSearch({ create: true, projectId: "proj-2" }, [])).toEqual(
      startAutomationDraft("proj-2"),
    );
  });

  it("falls back to the first project when the intent has no project", () => {
    expect(startAutomationDraftFromSearch({ create: true }, ["proj-1"])).toEqual(
      startAutomationDraft("proj-1"),
    );
  });
});

describe("draftFromAutomation", () => {
  it("carries a pinned model through to the form", () => {
    const draft = draftFromAutomation(automation({ modelSelection }));
    expect(draft.editing).toBe("auto-1");
    expect(draft.modelSelection).toEqual(modelSelection);
    expect(draft.kind).toBe("daily");
    expect(draft.timeOfDayText).toBe("09:00");
  });

  it("keeps project-default as null rather than inventing a model", () => {
    expect(draftFromAutomation(automation()).modelSelection).toBeNull();
  });
});

describe("isDraftComplete / save payloads", () => {
  const complete = {
    ...EMPTY_AUTOMATION_DRAFT,
    projectId: "proj-1",
    title: "Triage",
    prompt: "Summarise new issues.",
    modelSelection,
  };

  it("requires a project, a name, a prompt, and a real schedule", () => {
    expect(isDraftComplete(complete)).toBe(true);
    expect(isDraftComplete({ ...complete, title: "  " })).toBe(false);
    expect(isDraftComplete({ ...complete, timeOfDayText: "25:00" })).toBe(false);
  });

  it("writes the pinned model on create and on update", () => {
    expect(draftToCreateInput(complete)?.modelSelection).toEqual(modelSelection);
    expect(
      draftToUpdateInput({ ...complete, editing: "auto-1" as Automation["id"] })?.modelSelection,
    ).toEqual(modelSelection);
  });

  it("writes null when the run should follow the project default", () => {
    expect(draftToCreateInput({ ...complete, modelSelection: null })?.modelSelection).toBeNull();
  });

  it("defaults to stopping after three start failures and can keep retrying", () => {
    expect(EMPTY_AUTOMATION_DRAFT.stopAfterConsecutiveFailures).toBe(3);
    expect(draftToCreateInput(complete)?.stopAfterConsecutiveFailures).toBe(3);
    expect(
      draftToCreateInput({ ...complete, stopAfterConsecutiveFailures: null })
        ?.stopAfterConsecutiveFailures,
    ).toBeNull();
  });

  it("refuses to build a schedule from an out-of-range interval", () => {
    expect(draftSchedule({ ...complete, kind: "interval", everyMinutes: 5 })).toBeNull();
  });
});

import { describe, expect, it, vi } from "vite-plus/test";
import type { Automation, ModelSelection } from "@t3tools/contracts";
import {
  AUTOMATION_MAX_TITLE_CHARS,
  AUTOMATION_MAX_PROMPT_CHARS,
  EnvironmentId,
  ProviderInstanceId,
} from "@t3tools/contracts";

import {
  createAutomationSearch,
  draftFromAutomation,
  duplicateAutomationDraft,
  draftSchedule,
  draftToCreateInput,
  draftToUpdateInput,
  EMPTY_AUTOMATION_DRAFT,
  isDraftComplete,
  parseAutomationsSearch,
  resolveAutomationEnvironmentId,
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

  it("carries both the environment and project through a remote creation intent", () => {
    const remote = EnvironmentId.make("remote");
    expect(parseAutomationsSearch({ ...createAutomationSearch("proj-1", remote) })).toEqual({
      create: true,
      projectId: "proj-1",
      environmentId: remote,
    });
    expect(parseAutomationsSearch({ environmentId: "  " })).toEqual({});
  });
});

describe("automation machine selection", () => {
  const primary = EnvironmentId.make("primary");
  const remote = EnvironmentId.make("remote");
  it("keeps a requested machine even before it loads or after it disappears", () => {
    expect(
      resolveAutomationEnvironmentId({
        requestedEnvironmentId: remote,
        primaryEnvironmentId: primary,
        environmentIds: [primary],
      }),
    ).toBe(remote);
  });
  it("defaults to the primary and supports a client with only remote machines", () => {
    expect(
      resolveAutomationEnvironmentId({
        primaryEnvironmentId: primary,
        environmentIds: [remote, primary],
      }),
    ).toBe(primary);
    expect(
      resolveAutomationEnvironmentId({ primaryEnvironmentId: null, environmentIds: [remote] }),
    ).toBe(remote);
    expect(
      resolveAutomationEnvironmentId({ primaryEnvironmentId: null, environmentIds: [] }),
    ).toBeNull();
  });
});

describe("duplicateAutomationDraft", () => {
  it("creates a new editable copy retaining execution preferences, with a unique title", () => {
    const source = automation({
      modelSelection,
      stopAfterConsecutiveFailures: null,
      schedule: { _tag: "interval", everyMinutes: 90 },
    });
    const draft = duplicateAutomationDraft(source, [
      source.title,
      "Triage (copy)",
      "TRIAGE (COPY 2)",
    ]);
    expect(draft.editing).toBeNull();
    expect(draft.title).toBe("Triage (copy 3)");
    expect(draftToUpdateInput(draft)).toBeNull();
    expect(draftToCreateInput(draft)).toMatchObject({
      projectId: source.projectId,
      prompt: source.prompt,
      schedule: source.schedule,
      envMode: source.envMode,
      modelSelection,
      stopAfterConsecutiveFailures: null,
    });
  });
  it("requires a new time for a copied one-time automation, including after it already ran", () => {
    const draft = duplicateAutomationDraft(
      automation({ schedule: { _tag: "once", at: "2026-01-01T09:00:00.000Z" }, enabled: false }),
      [],
    );
    expect(draft.kind).toBe("once");
    expect(isDraftComplete(draft)).toBe(false);
    expect(draftToCreateInput(draft)).toBeNull();
    expect(isDraftComplete({ ...draft, onceAtText: "2026-12-01T09:00" })).toBe(true);
  });
  it("reserves space for the copy suffix at the title length limit", () => {
    const draft = duplicateAutomationDraft(
      automation({ title: "x".repeat(AUTOMATION_MAX_TITLE_CHARS) }),
      [],
    );
    expect(draft.title).toHaveLength(AUTOMATION_MAX_TITLE_CHARS);
    expect(draft.title.endsWith(" (copy)")).toBe(true);
  });
});

describe("automation text limits", () => {
  it.each([
    { title: "x".repeat(AUTOMATION_MAX_TITLE_CHARS + 1) },
    { prompt: "x".repeat(AUTOMATION_MAX_PROMPT_CHARS + 1) },
    { title: "   " },
    { prompt: "   " },
  ])("rejects incomplete or oversized text before sending a command", (text) => {
    const draft = { ...draftFromAutomation(automation()), ...text };
    expect(isDraftComplete(draft)).toBe(false);
    expect(draftToCreateInput({ ...draft, editing: null })).toBeNull();
    expect(draftToUpdateInput(draft)).toBeNull();
  });

  it("accepts trimmed text exactly at the contract limits", () => {
    const draft = {
      ...startAutomationDraft("proj-1"),
      title: `  ${"x".repeat(AUTOMATION_MAX_TITLE_CHARS)}  `,
      prompt: `  ${"x".repeat(AUTOMATION_MAX_PROMPT_CHARS)}  `,
    };
    expect(isDraftComplete(draft)).toBe(true);
    expect(draftToCreateInput(draft)?.title).toHaveLength(AUTOMATION_MAX_TITLE_CHARS);
    expect(draftToCreateInput(draft)?.prompt).toHaveLength(AUTOMATION_MAX_PROMPT_CHARS);
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
  it.each(["Asia/Kolkata", "America/New_York"])(
    "keeps a one-time instant when edited in %s",
    (timezone) => {
      vi.stubEnv("TZ", timezone);
      try {
        const at = new Date(2026, 9, 5, 9, 0).toISOString();
        const draft = draftFromAutomation(automation({ schedule: { _tag: "once", at } }));
        expect(draft.onceAtText).toBe("2026-10-05T09:00");
        expect(draftToUpdateInput({ ...draft, title: "Renamed" })?.schedule).toEqual({
          _tag: "once",
          at,
        });
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
  it.each(["2026-11-01T05:30:42.123Z", "2026-11-01T06:30:00.000Z"])(
    "preserves %s during the repeated daylight-saving hour unless the time is edited",
    (at) => {
      vi.stubEnv("TZ", "America/New_York");
      try {
        const draft = draftFromAutomation(automation({ schedule: { _tag: "once", at } }));
        expect(draft.onceAtText).toBe("2026-11-01T01:30");
        expect(draftToUpdateInput({ ...draft, title: "Renamed" })?.schedule).toEqual({
          _tag: "once",
          at,
        });
        expect(draftSchedule({ ...draft, onceAtText: "2026-11-01T02:45" })).toEqual({
          _tag: "once",
          at: "2026-11-01T07:45:00.000Z",
        });
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
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

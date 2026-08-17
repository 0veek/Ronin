import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  applyAutomationEnabledChange,
  applyAutomationRunOutcome,
  Automation,
  AutomationId,
  DEFAULT_AUTOMATION_STOP_AFTER_CONSECUTIVE_FAILURES,
} from "./automation.ts";
import { ProjectId } from "./baseSchemas.ts";

const decodeAutomation = Schema.decodeUnknownSync(Automation);

const base = {
  id: AutomationId.make("auto-1"),
  projectId: ProjectId.make("proj-1"),
  title: "Triage",
  prompt: "Check issues.",
  schedule: { _tag: "interval" as const, everyMinutes: 60 },
  envMode: "worktree" as const,
  modelSelection: null,
  enabled: true,
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
  lastRunAt: null,
  nextRunAt: "2026-08-17T01:00:00.000Z",
};

describe("Automation failure policy schema", () => {
  it("defaults a missing threshold to three and an empty streak", () => {
    const decoded = decodeAutomation(base);
    expect(decoded.stopAfterConsecutiveFailures).toBe(
      DEFAULT_AUTOMATION_STOP_AFTER_CONSECUTIVE_FAILURES,
    );
    expect(decoded.consecutiveFailureCount).toBe(0);
    expect(decoded.disabledReason).toBeNull();
    expect(decoded.disabledAt).toBeNull();
  });

  it("keeps an explicit null threshold as never-stop", () => {
    expect(
      decodeAutomation({ ...base, stopAfterConsecutiveFailures: null })
        .stopAfterConsecutiveFailures,
    ).toBeNull();
  });
});

describe("applyAutomationRunOutcome", () => {
  const automation = decodeAutomation(base);

  it("ignores skips", () => {
    expect(
      applyAutomationRunOutcome({
        automation,
        outcome: "skipped",
        nowIso: "2026-08-17T02:00:00.000Z",
      }),
    ).toBe(automation);
  });

  it("increments the streak and disables at the threshold", () => {
    const afterOne = applyAutomationRunOutcome({
      automation,
      outcome: "failed",
      nowIso: "2026-08-17T02:00:00.000Z",
    });
    expect(afterOne.consecutiveFailureCount).toBe(1);
    expect(afterOne.enabled).toBe(true);

    const afterThree = applyAutomationRunOutcome({
      automation: { ...afterOne, consecutiveFailureCount: 2 },
      outcome: "failed",
      nowIso: "2026-08-17T02:01:00.000Z",
    });
    expect(afterThree.enabled).toBe(false);
    expect(afterThree.nextRunAt).toBeNull();
    expect(afterThree.consecutiveFailureCount).toBe(3);
    expect(afterThree.disabledReason).toBe("failures");
    expect(afterThree.disabledAt).toBe("2026-08-17T02:01:00.000Z");
  });

  it("never auto-disables when the threshold is null", () => {
    const next = applyAutomationRunOutcome({
      automation: { ...automation, stopAfterConsecutiveFailures: null, consecutiveFailureCount: 9 },
      outcome: "failed",
      nowIso: "2026-08-17T02:00:00.000Z",
    });
    expect(next.enabled).toBe(true);
    expect(next.consecutiveFailureCount).toBe(10);
    expect(next.disabledReason).toBeNull();
  });

  it("resets the streak on a successful start while enabled", () => {
    const next = applyAutomationRunOutcome({
      automation: { ...automation, consecutiveFailureCount: 2 },
      outcome: "started",
      nowIso: "2026-08-17T02:00:00.000Z",
    });
    expect(next.consecutiveFailureCount).toBe(0);
  });

  it("keeps evidence when a disabled row is rerun by hand", () => {
    const disabled = decodeAutomation({
      ...base,
      enabled: false,
      consecutiveFailureCount: 3,
      disabledReason: "failures",
      disabledAt: "2026-08-17T01:30:00.000Z",
      nextRunAt: null,
    });
    expect(
      applyAutomationRunOutcome({
        automation: disabled,
        outcome: "started",
        nowIso: "2026-08-17T02:00:00.000Z",
      }),
    ).toEqual(disabled);
    expect(
      applyAutomationRunOutcome({
        automation: disabled,
        outcome: "failed",
        nowIso: "2026-08-17T02:00:00.000Z",
      }),
    ).toEqual(disabled);
  });
});

describe("applyAutomationEnabledChange", () => {
  it("clears a failure stop when the user turns the switch back on", () => {
    const disabled = decodeAutomation({
      ...base,
      enabled: false,
      consecutiveFailureCount: 3,
      disabledReason: "failures",
      disabledAt: "2026-08-17T01:30:00.000Z",
      nextRunAt: null,
    });
    const next = applyAutomationEnabledChange({
      automation: disabled,
      enabled: true,
      nowIso: "2026-08-17T02:00:00.000Z",
    });
    expect(next.enabled).toBe(true);
    expect(next.consecutiveFailureCount).toBe(0);
    expect(next.disabledReason).toBeNull();
    expect(next.disabledAt).toBeNull();
  });

  it("records a user pause without wiping a previous failure streak", () => {
    const next = applyAutomationEnabledChange({
      automation: decodeAutomation({ ...base, consecutiveFailureCount: 2 }),
      enabled: false,
      nowIso: "2026-08-17T02:00:00.000Z",
    });
    expect(next.enabled).toBe(false);
    expect(next.nextRunAt).toBeNull();
    expect(next.consecutiveFailureCount).toBe(2);
    expect(next.disabledReason).toBe("user");
    expect(next.disabledAt).toBe("2026-08-17T02:00:00.000Z");
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  extractWorkLogToolLifecycleStatus,
  workEntryDisplayIndicatesToolFailure,
  workEntryIndicatesToolFailure,
  workEntryIndicatesToolSuccess,
  type WorkLogPresentationEntry,
} from "./presentation.ts";

describe("extractWorkLogToolLifecycleStatus", () => {
  it.each(["pending", "running", "waiting"] as const)("maps %s to inProgress", (status) => {
    expect(extractWorkLogToolLifecycleStatus({ status })).toBe("inProgress");
  });

  it.each(["cancelled", "interrupted"] as const)("maps %s to stopped", (status) => {
    expect(extractWorkLogToolLifecycleStatus({ status })).toBe("stopped");
  });

  it("maps idle subagent batches to stopped", () => {
    expect(extractWorkLogToolLifecycleStatus({ status: "idle", taskType: "subagent_batch" })).toBe(
      "stopped",
    );
  });

  it("leaves other idle tasks unmapped so they can resume", () => {
    expect(extractWorkLogToolLifecycleStatus({ status: "idle" })).toBeUndefined();
    expect(
      extractWorkLogToolLifecycleStatus({ status: "idle", taskType: "local_agent" }),
    ).toBeUndefined();
  });

  it.each(["inProgress", "completed", "failed", "declined", "stopped"] as const)(
    "keeps %s as-is",
    (status) => {
      expect(extractWorkLogToolLifecycleStatus({ status })).toBe(status);
    },
  );

  it("returns undefined for missing or unknown status", () => {
    expect(extractWorkLogToolLifecycleStatus(null)).toBeUndefined();
    expect(extractWorkLogToolLifecycleStatus({})).toBeUndefined();
    expect(extractWorkLogToolLifecycleStatus({ status: "unknown" })).toBeUndefined();
  });
});

describe("workEntryIndicatesToolFailure", () => {
  const base = {
    id: "w1",
    createdAt: "2026-01-01T00:00:00.000Z",
    label: "Read",
  };

  it("is true for error tone", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "error",
        detail: "nothing special",
      }),
    ).toBe(true);
  });

  it("is true when lifecycle says failed even if detail is empty", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "failed",
      }),
    ).toBe(true);
  });

  it("detects file-not-found style tool output with completed lifecycle", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "File not found: C:\\foo\\nonexistent.ts",
      }),
    ).toBe(true);
  });

  it("detects glob no files and PowerShell command errors", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Glob",
        tone: "tool",
        detail: "No files found",
      }),
    ).toBe(true);
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Bash",
        tone: "tool",
        detail:
          "The term 'this_is_not_a_command' is not recognized as the name of a cmdlet, function, script file, or operable program.",
      }),
    ).toBe(true);
  });

  it("is false for successful completed tools", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "Found 3 matching files",
      }),
    ).toBe(false);
  });

  it("does not treat error text in a command as rendered failure", () => {
    const entry = {
      label: "Ran command",
      tone: "tool",
      toolLifecycleStatus: "completed",
      command: 'rg "file not found"',
      detail: "Found 3 matches",
    } satisfies WorkLogPresentationEntry;

    expect(workEntryDisplayIndicatesToolFailure(entry)).toBe(false);
    // Older activities can store output in this field, so that path stays separate.
    expect(workEntryIndicatesToolFailure(entry)).toBe(true);
    expect(workEntryDisplayIndicatesToolFailure({ ...entry, detail: "File not found" })).toBe(true);
  });

  it("treats successful tool rows as success candidates", () => {
    expect(
      workEntryIndicatesToolSuccess({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "ok",
      }),
    ).toBe(true);
    expect(
      workEntryIndicatesToolSuccess({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "inProgress",
        detail: "…",
      }),
    ).toBe(false);
    expect(workEntryIndicatesToolSuccess({ ...base, tone: "thinking", detail: "…" })).toBe(false);
    expect(
      workEntryIndicatesToolSuccess({ ...base, tone: "tool", toolLifecycleStatus: "stopped" }),
    ).toBe(false);
  });

  it("does not run heuristics on non-tool info rows", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Context compacted",
        tone: "info",
        detail: "File not found in conversation",
      }),
    ).toBe(false);
  });
});

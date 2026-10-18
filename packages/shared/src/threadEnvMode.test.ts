import { describe, expect, it } from "vite-plus/test";

import {
  isDefaultThreadEnvModeSettled,
  resolveDefaultThreadEnvMode,
  resolveNewThreadEnvMode,
} from "./threadEnvMode.ts";

describe("resolveDefaultThreadEnvMode", () => {
  it("prefers the project setting over t3.json over the global default", () => {
    expect(
      resolveDefaultThreadEnvMode({
        projectSetting: "local",
        projectFile: "worktree",
        globalDefault: "worktree",
      }),
    ).toBe("local");
    expect(
      resolveDefaultThreadEnvMode({
        projectSetting: null,
        projectFile: "local",
        globalDefault: "worktree",
      }),
    ).toBe("local");
    expect(
      resolveDefaultThreadEnvMode({
        projectSetting: undefined,
        projectFile: null,
        globalDefault: "worktree",
      }),
    ).toBe("worktree");
  });
});

describe("isDefaultThreadEnvModeSettled", () => {
  it("settles on an explicit pick or project setting even while the file loads", () => {
    expect(
      isDefaultThreadEnvModeSettled({
        explicitMode: "local",
        projectSetting: null,
        projectFilePending: true,
      }),
    ).toBe(true);
    expect(
      isDefaultThreadEnvModeSettled({
        explicitMode: undefined,
        projectSetting: "worktree",
        projectFilePending: true,
      }),
    ).toBe(true);
  });

  it("stays unsettled only while a consulted file read is pending", () => {
    expect(
      isDefaultThreadEnvModeSettled({
        explicitMode: undefined,
        projectSetting: null,
        projectFilePending: true,
      }),
    ).toBe(false);
    expect(
      isDefaultThreadEnvModeSettled({
        explicitMode: undefined,
        projectSetting: null,
        projectFilePending: false,
      }),
    ).toBe(true);
  });
});

describe("resolveNewThreadEnvMode", () => {
  const fresh = {
    projectSetting: null,
    projectFile: null,
    globalDefault: "worktree",
    workspaceRoot: "/data/projects/example",
    newProjectsRoot: "/data/projects/",
    projectHasThreads: false,
  } as const;
  it("starts the first thread in the scaffolded project folder", () => {
    expect(resolveNewThreadEnvMode(fresh)).toBe("local");
    expect(
      resolveNewThreadEnvMode({
        ...fresh,
        workspaceRoot: "C:\\Data\\Projects\\Example",
        newProjectsRoot: "c:/data/projects",
      }),
    ).toBe("local");
  });
  it("preserves the default for existing projects and other folders", () => {
    expect(resolveNewThreadEnvMode({ ...fresh, projectHasThreads: true })).toBe("worktree");
    for (const workspaceRoot of [
      "/data/projects",
      "/data/projects/a/nested",
      "/data/projects-old/a",
    ]) {
      expect(resolveNewThreadEnvMode({ ...fresh, workspaceRoot })).toBe("worktree");
    }
    expect(resolveNewThreadEnvMode({ ...fresh, newProjectsRoot: undefined })).toBe("worktree");
  });
  it("honors explicit project and checked-in defaults", () => {
    expect(resolveNewThreadEnvMode({ ...fresh, projectSetting: "worktree" })).toBe("worktree");
    expect(resolveNewThreadEnvMode({ ...fresh, projectFile: "worktree" })).toBe("worktree");
  });
});

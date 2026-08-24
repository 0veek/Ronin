import { describe, expect, it } from "vite-plus/test";

import {
  buildSlashReviewComposerPrompt,
  getAvailableComposerSlashCommands,
  parseComposerSlashInvocation,
  parseForkSlashCommandArgs,
  shouldHideProviderNativeSlashCommand,
} from "./composerSlashCommands.ts";

describe("parseComposerSlashInvocation", () => {
  it("parses a bare built-in command", () => {
    expect(parseComposerSlashInvocation(" /status ")).toEqual({
      command: "status",
      args: "",
    });
  });

  it("parses arguments", () => {
    expect(parseComposerSlashInvocation("/review base main")).toEqual({
      command: "review",
      args: "base main",
    });
  });

  it("ignores unknown commands so provider-native text can still send", () => {
    expect(parseComposerSlashInvocation("/ui")).toBeNull();
  });
});

describe("getAvailableComposerSlashCommands", () => {
  it("keeps app-owned mode commands even when the provider lists them", () => {
    expect(
      getAvailableComposerSlashCommands({
        planModeEnabled: true,
        nativeCommandNames: ["plan", "default", "model"],
      }),
    ).toContain("plan");
  });

  it("hides app /status and /clear when the provider already owns them", () => {
    const commands = getAvailableComposerSlashCommands({
      planModeEnabled: false,
      nativeCommandNames: ["status", "clear", "compact"],
    });
    expect(commands).toEqual(["model", "debug", "default", "review", "fork", "side"]);
  });

  it("omits plan mode commands when the beta flag is off", () => {
    expect(
      getAvailableComposerSlashCommands({
        planModeEnabled: false,
        nativeCommandNames: [],
      }),
    ).not.toContain("plan");
  });

  it("offers /debug even when plan mode is off, since debug is prompt-only", () => {
    const commands = getAvailableComposerSlashCommands({
      planModeEnabled: false,
      nativeCommandNames: [],
    });
    expect(commands).toContain("debug");
    // The way back out has to come with it.
    expect(commands).toContain("default");
  });

  it("keeps /debug even when the provider lists a native debug command", () => {
    expect(
      getAvailableComposerSlashCommands({
        planModeEnabled: false,
        nativeCommandNames: ["debug"],
      }),
    ).toContain("debug");
  });
});

describe("shouldHideProviderNativeSlashCommand", () => {
  it("hides a native command only when the app is offering the same name", () => {
    expect(shouldHideProviderNativeSlashCommand("review", new Set(["review"]))).toBe(true);
    expect(shouldHideProviderNativeSlashCommand("status", new Set(["review"]))).toBe(false);
  });

  // Providers report their skills as native slash commands too, so the
  // composer folds visible skill names into the offered set and the Skills
  // row is the only entry left for that name.
  it("hides a native command shadowed by a skill of the same name", () => {
    expect(shouldHideProviderNativeSlashCommand("/Graphify", new Set(["graphify"]))).toBe(true);
  });
});

describe("review and fork argument helpers", () => {
  it("builds a base-branch review prompt", () => {
    expect(buildSlashReviewComposerPrompt("base main")).toContain("base branch");
    expect(buildSlashReviewComposerPrompt("base main")).toContain("Use main");
  });

  it("parses /fork local and /fork worktree", () => {
    expect(parseForkSlashCommandArgs("local")).toEqual({ target: "local", invalid: false });
    expect(parseForkSlashCommandArgs("worktree")).toEqual({
      target: "worktree",
      invalid: false,
    });
    expect(parseForkSlashCommandArgs("remote")).toEqual({ target: null, invalid: true });
  });
});

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
    expect(commands).toEqual(["model", "review", "fork", "side"]);
  });

  it("omits plan mode commands when the beta flag is off", () => {
    expect(
      getAvailableComposerSlashCommands({
        planModeEnabled: false,
        nativeCommandNames: [],
      }),
    ).not.toContain("plan");
  });
});

describe("shouldHideProviderNativeSlashCommand", () => {
  it("hides a native command only when the app is offering the same name", () => {
    expect(shouldHideProviderNativeSlashCommand("review", new Set(["review"]))).toBe(true);
    expect(shouldHideProviderNativeSlashCommand("status", new Set(["review"]))).toBe(false);
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

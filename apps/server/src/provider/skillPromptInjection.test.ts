import { ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shouldInlineSkillForProvider } from "./skillPromptInjection.ts";

describe("shouldInlineSkillForProvider", () => {
  it("inlines portable Ronin skills for every adapter", () => {
    expect(
      shouldInlineSkillForProvider(
        ProviderDriverKind.make("codex"),
        "/home/user/.ronin/skills/review/SKILL.md",
      ),
    ).toBe(true);
    expect(
      shouldInlineSkillForProvider(
        ProviderDriverKind.make("claudeAgent"),
        "/workspace/.ronin/skills/review/SKILL.md",
      ),
    ).toBe(true);
  });

  it("leaves Claude-native skills for Claude", () => {
    expect(
      shouldInlineSkillForProvider(
        ProviderDriverKind.make("claudeAgent"),
        "/home/user/.claude/skills/review/SKILL.md",
      ),
    ).toBe(false);
  });

  it("inlines Claude skills when Codex is selected", () => {
    expect(
      shouldInlineSkillForProvider(
        ProviderDriverKind.make("codex"),
        "/home/user/.claude/skills/review/SKILL.md",
      ),
    ).toBe(true);
  });
});

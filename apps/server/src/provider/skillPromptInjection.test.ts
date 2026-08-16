import { describe, expect, it } from "vite-plus/test";

import { resolveInvokedSkills, shouldInlineSkill } from "./skillPromptInjection.ts";

describe("resolveInvokedSkills", () => {
  const skills = [
    {
      name: "t3-sync",
      displayName: "T3 Sync",
      path: "/home/user/.ronin/skills/t3-sync/SKILL.md",
      enabled: true,
    },
    {
      name: "review",
      path: "/home/user/.codex/skills/review/SKILL.md",
      enabled: true,
    },
  ];

  it("recognizes composer tokens and plain-language skill names", () => {
    expect(
      resolveInvokedSkills("Use $t3-sync for this.", skills).map((skill) => skill.name),
    ).toEqual(["t3-sync"]);
    expect(resolveInvokedSkills("run t3-sync skill", skills).map((skill) => skill.name)).toEqual([
      "t3-sync",
    ]);
    expect(resolveInvokedSkills("Please use T3 Sync", skills).map((skill) => skill.name)).toEqual([
      "t3-sync",
    ]);
  });

  it("does not match skill names inside longer identifiers", () => {
    expect(resolveInvokedSkills("run pre-t3-sync-post", skills)).toEqual([]);
  });

  describe("built-in skills", () => {
    const builtIn = [
      {
        name: "implement",
        path: "/app/skills/mattpocock/implement/SKILL.md",
        enabled: true,
        scope: "bundled",
      },
    ];

    it("stays out of prose that happens to use its name", () => {
      expect(
        resolveInvokedSkills("Implement the login form, then implement logout", builtIn),
      ).toEqual([]);
      expect(resolveInvokedSkills("open apps/web/src/implement.ts", builtIn)).toEqual([]);
    });

    it("is invoked by a composer mention", () => {
      expect(
        resolveInvokedSkills("Use $implement here", builtIn).map((skill) => skill.name),
      ).toEqual(["implement"]);
      expect(
        resolveInvokedSkills("/implement the plan", builtIn).map((skill) => skill.name),
      ).toEqual(["implement"]);
    });
  });
});

describe("shouldInlineSkill", () => {
  it("leaves exact native copies, including portable roots, to the provider", () => {
    expect(
      shouldInlineSkill(
        "/home/user/.ronin/skills/review/SKILL.md",
        new Set(["/home/user/.ronin/skills/review/SKILL.md"]),
      ),
    ).toBe(false);
    expect(
      shouldInlineSkill(
        "/home/user/.claude/skills/review/SKILL.md",
        new Set(["/home/user/.claude/skills/review/SKILL.md"]),
      ),
    ).toBe(false);
  });

  it("inlines skills from another harness", () => {
    expect(shouldInlineSkill("/home/user/.claude/skills/review/SKILL.md", new Set())).toBe(true);
  });
});

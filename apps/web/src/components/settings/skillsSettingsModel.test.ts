import { describe, expect, it } from "vite-plus/test";

import { buildSettingsSkillSections, settingsSkillNameKey } from "./skillsSettingsModel";

describe("buildSettingsSkillSections", () => {
  it("groups duplicate names and keeps provider origins visible", () => {
    const sections = buildSettingsSkillSections([
      {
        name: "review",
        path: "/home/user/.codex/skills/review/SKILL.md",
        enabled: true,
        scope: "codex",
        description: "Review changes.",
      },
      {
        name: "review",
        path: "/home/user/.ronin/skills/review/SKILL.md",
        enabled: true,
        scope: "ronin",
        description: "Portable review.",
      },
      {
        name: "imagen",
        path: "/home/user/.codex/skills/imagen/SKILL.md",
        enabled: true,
        scope: "codex",
        description: "Make images.",
      },
    ]);

    expect(sections.map((section) => section.key)).toEqual(["shared", "codex"]);
    expect(sections[0]?.groups[0]?.displayName).toBe("review");
    expect(sections[0]?.groups[0]?.sources).toHaveLength(2);
  });

  it("normalizes disable keys case-insensitively", () => {
    expect(settingsSkillNameKey("Review")).toBe("review");
  });

  it("lists built-in skills last, under their own section", () => {
    const sections = buildSettingsSkillSections([
      {
        name: "tdd",
        path: "/app/skills/mattpocock/tdd/SKILL.md",
        enabled: true,
        scope: "bundled",
        description: "Test-driven development.",
      },
      {
        name: "imagen",
        path: "/home/user/.codex/skills/imagen/SKILL.md",
        enabled: true,
        scope: "codex",
        description: "Make images.",
      },
    ]);

    expect(sections.map((section) => section.key)).toEqual(["codex", "bundled"]);
    expect(sections[1]?.title).toBe("Built-in skills");
    expect(sections[1]?.groups[0]?.sources[0]?.originInfo.label).toBe("Built-in");
  });

  it("keeps a user copy as the primary source of a shadowed built-in skill", () => {
    const sections = buildSettingsSkillSections([
      {
        name: "tdd",
        path: "/app/skills/mattpocock/tdd/SKILL.md",
        enabled: true,
        scope: "bundled",
        description: "Built-in TDD.",
      },
      {
        name: "tdd",
        path: "/home/user/.ronin/skills/tdd/SKILL.md",
        enabled: true,
        scope: "ronin",
        description: "My own TDD.",
      },
    ]);

    expect(sections.map((section) => section.key)).toEqual(["shared"]);
    expect(sections[0]?.groups[0]?.primarySkill.scope).toBe("ronin");
  });
});

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
});

// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  discoverSkillsCatalog,
  filterDisabledSkills,
  mergeSkillSources,
  mergeSkillsIntoCatalog,
  mergeSkillsIntoProviders,
  parseSkillFrontmatter,
  roninSkillsDir,
} from "./skillsCatalog.ts";

async function writeSkill(dir: string, name: string, description: string): Promise<string> {
  const skillDir = NodePath.join(dir, name);
  await NodeFSP.mkdir(skillDir, { recursive: true });
  const skillPath = NodePath.join(skillDir, "SKILL.md");
  await NodeFSP.writeFile(
    skillPath,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf8",
  );
  return skillPath;
}

describe("parseSkillFrontmatter", () => {
  it("reads scalar name and description", () => {
    expect(
      parseSkillFrontmatter("---\nname: review\ndescription: Look closely\n---\nbody\n"),
    ).toEqual({
      name: "review",
      description: "Look closely",
    });
  });
});

describe("discoverSkillsCatalog", () => {
  it("finds portable Ronin skills and provider copies", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skills-"));
    const homeDir = NodePath.join(tempDir, "home");
    const roninBaseDir = NodePath.join(tempDir, "t3");
    await writeSkill(roninSkillsDir(homeDir), "portable", "Works everywhere.");
    await writeSkill(NodePath.join(homeDir, ".codex", "skills"), "imagen", "Codex image skill.");

    const skills = await discoverSkillsCatalog({
      homeDir,
      roninBaseDir,
      includeDuplicateOrigins: true,
      bundledSkillsDir: null,
    });

    expect(skills.map((skill) => skill.name).sort()).toEqual(["imagen", "portable"]);
    expect(skills.find((skill) => skill.name === "portable")?.scope).toBe("ronin");
    expect(skills.find((skill) => skill.name === "imagen")?.scope).toBe("codex");
  });

  it("adds built-in packs and lets a user copy shadow them", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skills-"));
    const homeDir = NodePath.join(tempDir, "home");
    const roninBaseDir = NodePath.join(tempDir, "t3");
    const bundledSkillsDir = NodePath.join(tempDir, "bundled");
    await writeSkill(NodePath.join(bundledSkillsDir, "pack"), "tdd", "Built-in TDD.");
    await writeSkill(NodePath.join(bundledSkillsDir, "pack"), "triage", "Built-in triage.");
    await writeSkill(roninSkillsDir(homeDir), "tdd", "My own TDD.");

    const skills = await discoverSkillsCatalog({
      homeDir,
      roninBaseDir,
      bundledSkillsDir,
    });

    expect(skills.map((skill) => `${skill.name}:${skill.scope}`).sort()).toEqual([
      "tdd:ronin",
      "triage:bundled",
    ]);
  });

  it("reports both copies of a shadowed built-in skill for the settings list", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skills-"));
    const homeDir = NodePath.join(tempDir, "home");
    const roninBaseDir = NodePath.join(tempDir, "t3");
    const bundledSkillsDir = NodePath.join(tempDir, "bundled");
    await writeSkill(NodePath.join(bundledSkillsDir, "pack"), "tdd", "Built-in TDD.");
    await writeSkill(roninSkillsDir(homeDir), "tdd", "My own TDD.");

    const skills = await discoverSkillsCatalog({
      homeDir,
      roninBaseDir,
      includeDuplicateOrigins: true,
      bundledSkillsDir,
    });

    expect(skills.map((skill) => skill.scope).sort()).toEqual(["bundled", "ronin"]);
  });
});

describe("merge and filter", () => {
  it("lets native skills win on name collisions", () => {
    const merged = mergeSkillsIntoCatalog({
      native: [
        {
          name: "review",
          path: "/native/review/SKILL.md",
          enabled: true,
          scope: "codex",
        },
      ],
      catalog: [
        {
          name: "review",
          path: "/portable/review/SKILL.md",
          enabled: true,
          scope: "ronin",
        },
        {
          name: "portable",
          path: "/portable/portable/SKILL.md",
          enabled: true,
          scope: "ronin",
        },
      ],
    });
    expect(merged.map((skill) => `${skill.name}:${skill.scope}`).sort()).toEqual([
      "portable:ronin",
      "review:codex",
    ]);
  });

  it("hides disabled skill names from the composer catalog", () => {
    expect(
      filterDisabledSkills(
        [
          { name: "review", path: "/a", enabled: true },
          { name: "imagen", path: "/b", enabled: true },
        ],
        ["Review"],
      ).map((skill) => skill.name),
    ).toEqual(["imagen"]);
  });

  it("adds the portable catalog to every provider without replacing native copies", () => {
    const providers = [
      {
        instanceId: "codex",
        skills: [{ name: "review", path: "/native/review/SKILL.md", enabled: true }],
      },
      {
        instanceId: "claudeAgent",
        skills: [],
      },
    ];
    const merged = mergeSkillsIntoProviders(providers as never, [
      { name: "review", path: "/portable/review/SKILL.md", enabled: true },
      { name: "portable", path: "/portable/portable/SKILL.md", enabled: true },
    ]);

    expect(merged.map((provider) => provider.skills.map((skill) => skill.path))).toEqual([
      ["/native/review/SKILL.md", "/portable/portable/SKILL.md"],
      ["/portable/review/SKILL.md", "/portable/portable/SKILL.md"],
    ]);
  });

  it("keeps distinct provider installations while removing duplicate paths", () => {
    const portable = { name: "review", path: "/portable/review/SKILL.md", enabled: true };
    expect(
      mergeSkillSources(
        [portable],
        [portable, { name: "review", path: "/custom/review/SKILL.md", enabled: true }],
      ).map((skill) => skill.path),
    ).toEqual(["/portable/review/SKILL.md", "/custom/review/SKILL.md"]);
  });
});

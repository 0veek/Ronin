// @effect-diagnostics nodeBuiltinImport:off -- the vendored packs are read straight off disk.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { BUNDLED_SKILLS_SCOPE } from "@t3tools/contracts";

import {
  collectSkillMarkdownPaths,
  readSkillDescriptor,
  resolveBundledSkillsDir,
  skillNameKey,
} from "./skillsCatalog.ts";

async function requireBundledSkillsDir(): Promise<string> {
  const dir = await resolveBundledSkillsDir();
  if (dir === null) {
    throw new Error("No bundled skills directory resolved; the packs are missing from this build.");
  }
  return dir;
}

async function bundledSkillDescriptors() {
  const skillPaths = await collectSkillMarkdownPaths(await requireBundledSkillsDir());
  return Promise.all(
    skillPaths.map(async (skillPath) => ({
      descriptor: await readSkillDescriptor({ skillPath, scope: BUNDLED_SKILLS_SCOPE }),
      skillPath,
    })),
  );
}

describe("bundled skill packs", () => {
  it("ships the Matt Pocock pack", async () => {
    const entries = await bundledSkillDescriptors();
    const names = entries.map((entry) => entry.descriptor?.name);
    expect(names).toContain("tdd");
    expect(names).toContain("grilling");
    expect(names.length).toBeGreaterThanOrEqual(25);
  });

  // See the "Local changes" section of apps/server/skills/README.md: refreshing
  // the pack from upstream reintroduces the original names unless the renames
  // are reapplied.
  it("keeps the locally renamed skills renamed", async () => {
    const names = (await bundledSkillDescriptors()).map((entry) => entry.descriptor?.name);
    expect(names).toContain("ask-ronin");
    expect(names).not.toContain("ask-matt");
    expect(names).toContain("setup-ronin-skills");
    expect(names).not.toContain("setup-matt-pocock-skills");
  });

  it("points every cross-reference at the renamed setup skill", async () => {
    const dir = await requireBundledSkillsDir();
    const entries = await NodeFSP.readdir(dir, { recursive: true, withFileTypes: true });
    const documents = entries.filter(
      (entry) =>
        entry.isFile() &&
        /\.(md|yaml|yml|sh)$/.test(entry.name) &&
        // Skip our own README at the root: it documents the rename by naming
        // the upstream skill it replaced.
        entry.parentPath !== dir,
    );
    expect(documents.length).toBeGreaterThan(25);
    for (const entry of documents) {
      const filePath = NodePath.join(entry.parentPath, entry.name);
      const contents = await NodeFSP.readFile(filePath, "utf8");
      expect(contents, `${filePath} still points at the upstream setup skill`).not.toContain(
        "setup-matt-pocock-skills",
      );
    }
  });

  it("gives every skill parseable frontmatter with a description", async () => {
    for (const entry of await bundledSkillDescriptors()) {
      expect(entry.descriptor, `${entry.skillPath} has no readable frontmatter`).not.toBeNull();
      expect(entry.descriptor?.description, `${entry.skillPath} has no description`).toBeTruthy();
    }
  });

  it("names every skill after its folder, without duplicates", async () => {
    const seen = new Set<string>();
    for (const entry of await bundledSkillDescriptors()) {
      const folder = NodePath.basename(NodePath.dirname(entry.skillPath));
      expect(entry.descriptor?.name, `${entry.skillPath} disagrees with its folder`).toBe(folder);
      const key = skillNameKey(entry.descriptor?.name ?? "");
      expect(seen.has(key), `${key} is bundled twice`).toBe(false);
      seen.add(key);
    }
  });

  it("keeps the upstream license next to the pack it covers", async () => {
    const dir = await requireBundledSkillsDir();
    const license = await NodeFSP.readFile(NodePath.join(dir, "mattpocock", "LICENSE"), "utf8");
    expect(license).toContain("MIT License");
  });
});

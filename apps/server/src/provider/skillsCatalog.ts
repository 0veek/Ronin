// @effect-diagnostics nodeBuiltinImport:off -- skill discovery walks user skill folders concurrently.
/**
 * Unified Agent Skill discovery: portable `{T3_HOME}/skills`, every
 * provider-native skills folder, and the skill packs Ronin ships with. Native
 * copies win on name collisions, then Ronin's portable copy, then the built-in
 * copy.
 *
 * @module provider/skillsCatalog
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  BUNDLED_SKILLS_SCOPE,
  type ServerProvider,
  type ServerProviderSkill,
} from "@t3tools/contracts";

export interface SkillRoot {
  readonly path: string;
  readonly scope: string;
}

type FrontmatterValue = string | boolean;

function stripYamlQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseYamlScalar(value: string): FrontmatterValue {
  const unquoted = stripYamlQuotes(value);
  const normalized = unquoted.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return unquoted;
}

export function parseSkillFrontmatter(markdown: string): Record<string, FrontmatterValue> {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(normalized);
  if (!match) {
    return {};
  }

  const record: Record<string, FrontmatterValue> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }
    record[key] = parseYamlScalar(value);
  }
  return record;
}

function readStringField(
  frontmatter: Record<string, FrontmatterValue>,
  keys: ReadonlyArray<string>,
): string | undefined {
  for (const key of keys) {
    const value = frontmatter[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function skillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function roninSkillsDir(homeDir: string): string {
  return NodePath.join(homeDir, ".ronin", "skills");
}

/**
 * Where the packs from `apps/server/skills` end up, packaged first: the build
 * copies them next to the bundled entrypoint, so `dist/skills` is what both the
 * npm package and the desktop app carry. Running from source falls through to
 * the checked-in tree.
 */
function bundledSkillsDirCandidates(): string[] {
  return [
    NodePath.resolve(import.meta.dirname, "skills"),
    NodePath.resolve(import.meta.dirname, "../../skills"),
  ];
}

let bundledSkillsDirPromise: Promise<string | null> | undefined;

/**
 * Resolve the built-in skills root once per process. Returns null when the
 * packs are missing, which keeps discovery working on a partial build.
 */
export async function resolveBundledSkillsDir(): Promise<string | null> {
  bundledSkillsDirPromise ??= (async () => {
    for (const candidate of bundledSkillsDirCandidates()) {
      try {
        const stat = await NodeFSP.stat(candidate);
        if (stat.isDirectory()) {
          return candidate;
        }
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  })();
  return bundledSkillsDirPromise;
}

/**
 * The roots discovery scans when the caller does not override them: the shipped
 * packs, or nothing at all on a partial build.
 */
async function defaultBundledSkillsDirs(): Promise<string[]> {
  const dir = await resolveBundledSkillsDir();
  return dir ? [dir] : [];
}

const ensuredRoninSkillsDirs = new Set<string>();

export async function ensureRoninSkillsDir(homeDir: string): Promise<string> {
  const dir = roninSkillsDir(homeDir);
  if (ensuredRoninSkillsDirs.has(dir)) {
    return dir;
  }
  try {
    await NodeFSP.mkdir(dir, { recursive: true });
    ensuredRoninSkillsDirs.add(dir);
  } catch {
    // Discovery still works if the folder cannot be created.
  }
  return dir;
}

export function clearSkillsCatalogCacheForTests(): void {
  ensuredRoninSkillsDirs.clear();
  bundledSkillsDirPromise = undefined;
}

async function readdirOrEmpty(path: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await NodeFSP.readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function collectSkillMarkdownPaths(rootPath: string): Promise<string[]> {
  async function visit(dir: string, depth: number): Promise<string[]> {
    const skillPath = NodePath.join(dir, "SKILL.md");
    try {
      const stat = await NodeFSP.stat(skillPath);
      if (stat.isFile()) {
        return [skillPath];
      }
    } catch {
      // This directory may be a namespace rather than a skill.
    }

    if (depth >= 2) {
      return [];
    }

    const dirents = await readdirOrEmpty(dir);
    const subdirNames = dirents
      .filter((dirent) => dirent.isDirectory() || dirent.isSymbolicLink())
      .map((dirent) => dirent.name)
      .sort();
    const nested = await Promise.all(
      subdirNames.map((name) => visit(NodePath.join(dir, name), depth + 1)),
    );
    return nested.flat();
  }

  return visit(rootPath, 0);
}

export async function readSkillDescriptor(input: {
  readonly skillPath: string;
  readonly scope: string;
}): Promise<ServerProviderSkill | null> {
  let raw: string;
  try {
    raw = await NodeFSP.readFile(input.skillPath, "utf8");
  } catch {
    return null;
  }

  const frontmatter = parseSkillFrontmatter(raw);
  const fallbackName = NodePath.basename(NodePath.dirname(input.skillPath));
  const name = readStringField(frontmatter, ["name"]) ?? fallbackName;
  if (!name) {
    return null;
  }
  const description = readStringField(frontmatter, ["description"]);
  const displayName = readStringField(frontmatter, ["display-name", "displayName", "title"]);
  const shortDescription = readStringField(frontmatter, [
    "short-description",
    "shortDescription",
    "summary",
  ]);

  return {
    name,
    path: input.skillPath,
    enabled: true,
    scope: input.scope,
    ...(description ? { description } : {}),
    ...(displayName ? { displayName } : {}),
    ...(shortDescription ? { shortDescription } : {}),
  };
}

export async function collectSkillsFromRoots(
  roots: ReadonlyArray<SkillRoot>,
): Promise<ServerProviderSkill[]> {
  const skillsPerRoot = await Promise.all(
    roots.map(async (root) => {
      const skillPaths = await collectSkillMarkdownPaths(root.path);
      const descriptors = await Promise.all(
        skillPaths.map((skillPath) =>
          readSkillDescriptor({
            skillPath,
            scope: root.scope,
          }),
        ),
      );
      return descriptors.filter((skill) => skill !== null);
    }),
  );
  return skillsPerRoot.flat();
}

const HOME_ORIGIN_ORDER = [
  "ronin",
  "codex",
  "claude",
  "cursor",
  "grok",
  "opencode",
  "kilo",
  "antigravity",
  "droid",
  "pi",
  "agents",
] as const;

export type SkillsCatalogOrigin =
  | (typeof HOME_ORIGIN_ORDER)[number]
  | "project"
  | typeof BUNDLED_SKILLS_SCOPE;

export interface SkillsCatalogDiscoveryInput {
  readonly cwd?: string | null;
  readonly homeDir: string;
  readonly roninBaseDir: string;
  readonly includeDuplicateOrigins?: boolean;
  /**
   * Test seam: the built-in skill roots to scan, `[]` for none. Omit it and
   * discovery uses the packs Ronin ships with.
   */
  readonly bundledSkillsDirs?: ReadonlyArray<string>;
}

function homeRootsForOrigin(
  origin: (typeof HOME_ORIGIN_ORDER)[number],
  input: SkillsCatalogDiscoveryInput,
): string[] {
  switch (origin) {
    case "ronin":
      return [roninSkillsDir(input.homeDir)];
    case "codex":
      return [NodePath.join(input.homeDir, ".codex", "skills")];
    case "claude":
      return [NodePath.join(input.homeDir, ".claude", "skills")];
    case "cursor":
      return [
        NodePath.join(input.homeDir, ".cursor", "skills-cursor"),
        NodePath.join(input.homeDir, ".cursor", "skills"),
      ];
    case "grok":
      return [NodePath.join(input.homeDir, ".grok", "skills")];
    case "opencode":
      return [NodePath.join(input.homeDir, ".config", "opencode", "skills")];
    case "kilo":
      return [NodePath.join(input.homeDir, ".kilo", "skills")];
    case "antigravity":
      return [NodePath.join(input.homeDir, ".gemini", "antigravity", "skills")];
    case "droid":
      return [NodePath.join(input.homeDir, ".factory", "skills")];
    case "pi":
      return [NodePath.join(input.homeDir, ".pi", "agent", "skills")];
    case "agents":
      return [NodePath.join(input.homeDir, ".agents", "skills")];
  }
}

function projectRootNamesForOrigin(origin: (typeof HOME_ORIGIN_ORDER)[number]): readonly string[] {
  switch (origin) {
    case "ronin":
      return [".ronin"];
    case "codex":
      return [".codex"];
    case "claude":
      return [".claude"];
    case "cursor":
      return [".cursor"];
    case "grok":
      return [".grok"];
    case "opencode":
      return [".opencode"];
    case "kilo":
      return [".kilo"];
    case "antigravity":
      return [".gemini"];
    case "droid":
      return [".factory"];
    case "pi":
      return [".pi"];
    case "agents":
      return [".agents"];
  }
}

function ancestorsFromDeepest(cwd: string): string[] {
  const resolved = NodePath.resolve(cwd);
  const ancestors: string[] = [];
  let current = resolved;
  while (true) {
    ancestors.push(current);
    const parent = NodePath.dirname(current);
    if (parent === current) {
      return ancestors;
    }
    current = parent;
  }
}

export function skillsCatalogRoots(input: SkillsCatalogDiscoveryInput): SkillRoot[] {
  const homeRoots = HOME_ORIGIN_ORDER.flatMap((origin) =>
    homeRootsForOrigin(origin, input).map((path) => ({
      path,
      scope: origin,
    })),
  );
  const homeRootPaths = new Set(homeRoots.map((root) => NodePath.resolve(root.path)));
  const projectRoots: SkillRoot[] = [];
  const cwd = input.cwd?.trim();
  if (cwd) {
    for (const ancestor of ancestorsFromDeepest(cwd)) {
      const seen = new Set<string>();
      for (const origin of HOME_ORIGIN_ORDER) {
        for (const rootName of projectRootNamesForOrigin(origin)) {
          if (seen.has(rootName)) continue;
          seen.add(rootName);
          const rootPath = NodePath.join(ancestor, rootName, "skills");
          if (homeRootPaths.has(NodePath.resolve(rootPath))) {
            continue;
          }
          projectRoots.push({ path: rootPath, scope: "project" });
        }
      }
    }
  }
  return [...projectRoots, ...homeRoots];
}

export async function discoverSkillsCatalog(
  input: SkillsCatalogDiscoveryInput,
): Promise<ServerProviderSkill[]> {
  await ensureRoninSkillsDir(input.homeDir);
  const bundledSkillsDirs = input.bundledSkillsDirs ?? (await defaultBundledSkillsDirs());
  const skills = await collectSkillsFromRoots([
    ...skillsCatalogRoots(input),
    // Last, so a user's own copy or a provider-native copy of the same skill
    // shadows the built-in one.
    ...bundledSkillsDirs.map((path) => ({ path, scope: BUNDLED_SKILLS_SCOPE })),
  ]);
  if (input.includeDuplicateOrigins) {
    return skills;
  }
  const byName = new Map<string, ServerProviderSkill>();
  for (const skill of skills) {
    const key = skillNameKey(skill.name);
    if (!byName.has(key)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}

export function mergeSkillsIntoCatalog(input: {
  readonly native: ReadonlyArray<ServerProviderSkill>;
  readonly catalog: ReadonlyArray<ServerProviderSkill>;
}): ServerProviderSkill[] {
  const byName = new Map<string, ServerProviderSkill>();
  for (const skill of [...input.native, ...input.catalog]) {
    const key = skillNameKey(skill.name);
    if (!byName.has(key)) {
      byName.set(key, skill);
    }
  }
  return [...byName.values()];
}

export function mergeSkillsIntoProviders(
  providers: ReadonlyArray<ServerProvider>,
  catalog: ReadonlyArray<ServerProviderSkill>,
): ServerProvider[] {
  return providers.map((provider) => ({
    ...provider,
    skills: mergeSkillsIntoCatalog({
      native: provider.skills,
      catalog,
    }),
  }));
}

export function mergeSkillSources(
  ...sources: ReadonlyArray<ReadonlyArray<ServerProviderSkill>>
): ServerProviderSkill[] {
  const skillsByPath = new Map<string, ServerProviderSkill>();
  for (const skill of sources.flat()) {
    const key = NodePath.normalize(skill.path);
    if (!skillsByPath.has(key)) {
      skillsByPath.set(key, skill);
    }
  }
  return [...skillsByPath.values()];
}

export function filterDisabledSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
  disabledNames: ReadonlyArray<string>,
): ServerProviderSkill[] {
  if (disabledNames.length === 0) {
    return [...skills];
  }
  const disabled = new Set(disabledNames.map((name) => skillNameKey(name)));
  return skills.filter((skill) => !disabled.has(skillNameKey(skill.name)));
}

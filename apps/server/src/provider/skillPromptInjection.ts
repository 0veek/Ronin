// @effect-diagnostics nodeBuiltinImport:off -- inlining reads SKILL.md files next to the invoked token.
/**
 * Resolves named skills and inlines instructions that the active provider does
 * not own. Portable Ronin skills are therefore passed to every adapter while
 * providers with an exact native copy can load it themselves.
 *
 * @module provider/skillPromptInjection
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ServerProviderSkill } from "@t3tools/contracts";

const MAX_INLINE_SKILL_CONTENT_CHARS = 24_000;

const INLINE_SKILLS_HEADER =
  "The user invoked the following agent skill(s) for this request. Follow each " +
  "skill's instructions. File paths referenced inside a skill are relative to its " +
  '"dir" attribute.';

function isSkillNameCharacter(value: string | undefined): boolean {
  return value !== undefined && /[a-zA-Z0-9:_-]/.test(value);
}

function containsSkillName(text: string, rawName: string): boolean {
  const name = rawName.trim().toLowerCase();
  if (!name) {
    return false;
  }
  const normalizedText = text.toLowerCase();
  let start = normalizedText.indexOf(name);
  while (start >= 0) {
    const end = start + name.length;
    if (
      !isSkillNameCharacter(normalizedText[start - 1]) &&
      !isSkillNameCharacter(normalizedText[end])
    ) {
      return true;
    }
    start = normalizedText.indexOf(name, start + 1);
  }
  return false;
}

export function resolveInvokedSkills(
  messageText: string,
  skills: ReadonlyArray<ServerProviderSkill>,
): ServerProviderSkill[] {
  return skills.filter(
    (skill) =>
      skill.enabled &&
      (containsSkillName(messageText, skill.name) ||
        (skill.displayName !== undefined && containsSkillName(messageText, skill.displayName))),
  );
}

function normalizedSkillPath(path: string): string {
  return NodePath.normalize(path);
}

export function shouldInlineSkill(
  skillPath: string,
  nativeSkillPaths: ReadonlySet<string>,
): boolean {
  const normalizedPath = normalizedSkillPath(skillPath);
  return !nativeSkillPaths.has(normalizedPath);
}

export async function buildInlineSkillInstructions(input: {
  readonly skills: ReadonlyArray<{ readonly name: string; readonly path: string }>;
  readonly nativeSkillPaths?: ReadonlyArray<string>;
  readonly maxChars: number;
}): Promise<string> {
  const nativeSkillPaths = new Set(
    (input.nativeSkillPaths ?? []).map((path) => normalizedSkillPath(path)),
  );
  const inlineSkills = input.skills.filter((skill) =>
    shouldInlineSkill(skill.path, nativeSkillPaths),
  );
  if (inlineSkills.length === 0 || input.maxChars <= 0) {
    return "";
  }

  let text = "";
  for (const skill of inlineSkills) {
    let content: string;
    try {
      content = await NodeFSP.readFile(skill.path, "utf8");
    } catch {
      continue;
    }
    let trimmed = content.trim();
    if (trimmed.length > MAX_INLINE_SKILL_CONTENT_CHARS) {
      trimmed = `${trimmed.slice(0, MAX_INLINE_SKILL_CONTENT_CHARS)}\n[skill content truncated]`;
    }
    const block = `<skill name=${JSON.stringify(skill.name)} dir=${JSON.stringify(
      NodePath.dirname(skill.path),
    )}>\n${trimmed}\n</skill>`;
    const candidate =
      text.length === 0 ? `${INLINE_SKILLS_HEADER}\n\n${block}` : `${text}\n\n${block}`;
    if (candidate.length > input.maxChars) {
      break;
    }
    text = candidate;
  }
  return text;
}

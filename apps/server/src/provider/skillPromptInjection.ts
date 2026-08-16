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

import { BUNDLED_SKILLS_SCOPE } from "./skillsCatalog.ts";

const MAX_INLINE_SKILL_CONTENT_CHARS = 24_000;

const INLINE_SKILLS_HEADER =
  "The user invoked the following agent skill(s) for this request. Follow each " +
  "skill's instructions. File paths referenced inside a skill are relative to its " +
  '"dir" attribute.';

function isSkillNameCharacter(value: string | undefined): boolean {
  return value !== undefined && /[a-zA-Z0-9:_-]/.test(value);
}

/**
 * A `$name` or `/name` the composer inserted, rather than the same characters
 * inside a path or an identifier: the sigil itself has to open a word.
 */
function isSkillMentionSigil(text: string, sigilIndex: number): boolean {
  const sigil = text[sigilIndex];
  if (sigil !== "$" && sigil !== "/") {
    return false;
  }
  const preceding = text[sigilIndex - 1];
  return preceding === undefined || /\s/.test(preceding);
}

function containsSkillName(
  text: string,
  rawName: string,
  options?: { readonly requireMentionSigil?: boolean },
): boolean {
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
      !isSkillNameCharacter(normalizedText[end]) &&
      (options?.requireMentionSigil !== true || isSkillMentionSigil(normalizedText, start - 1))
    ) {
      return true;
    }
    start = normalizedText.indexOf(name, start + 1);
  }
  return false;
}

/**
 * Skills Ronin ships with are named after everyday verbs — `implement`,
 * `research`, `teach` — so they only count as invoked when the message mentions
 * them as `$name` or `/name`. Skills the user or a provider installed keep the
 * looser match, where naming the skill in prose is enough.
 */
export function resolveInvokedSkills(
  messageText: string,
  skills: ReadonlyArray<ServerProviderSkill>,
): ServerProviderSkill[] {
  return skills.filter((skill) => {
    if (!skill.enabled) {
      return false;
    }
    const options = { requireMentionSigil: skill.scope === BUNDLED_SKILLS_SCOPE };
    return (
      containsSkillName(messageText, skill.name, options) ||
      (skill.displayName !== undefined &&
        containsSkillName(messageText, skill.displayName, options))
    );
  });
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

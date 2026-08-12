// @effect-diagnostics nodeBuiltinImport:off -- inlining reads SKILL.md files next to the invoked token.
/**
 * Inlines portable skill instructions for providers that cannot natively load
 * the referenced SKILL.md files. This is what makes `~/.ronin/skills` work
 * on every adapter.
 *
 * @module provider/skillPromptInjection
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { ProviderDriverKind } from "@t3tools/contracts";

const MAX_INLINE_SKILL_CONTENT_CHARS = 24_000;

const INLINE_SKILLS_HEADER =
  "The user invoked the following agent skill(s) for this request. Follow each " +
  "skill's instructions. File paths referenced inside a skill are relative to its " +
  '"dir" attribute.';

function pathSegments(path: string): Set<string> {
  return new Set(NodePath.normalize(path).split(/[\\/]+/));
}

export function shouldInlineSkillForProvider(
  provider: ProviderDriverKind,
  skillPath: string,
): boolean {
  const segments = pathSegments(skillPath);
  switch (provider) {
    case "codex":
      return [".claude", ".cursor", ".ronin", ".agents"].some((dir) => segments.has(dir));
    case "cursor":
      return segments.has(".ronin");
    case "claudeAgent":
      return !segments.has(".claude");
    default:
      return true;
  }
}

export async function buildInlineSkillInstructions(input: {
  readonly provider: ProviderDriverKind;
  readonly skills: ReadonlyArray<{ readonly name: string; readonly path: string }>;
  readonly maxChars: number;
}): Promise<string> {
  const inlineSkills = input.skills.filter((skill) =>
    shouldInlineSkillForProvider(input.provider, skill.path),
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

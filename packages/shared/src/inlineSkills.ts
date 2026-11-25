import type { ServerProviderSkill } from "@t3tools/contracts";

export type InlineSkill = Pick<ServerProviderSkill, "name" | "displayName">;

export function formatProviderSkillDisplayName(
  skill: Pick<ServerProviderSkill, "name"> & { readonly displayName?: string | null | undefined },
): string {
  return skill.displayName?.trim() || skill.name;
}

const SKILL_TOKEN_REGEX =
  /(^|\s)\$(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/gu;

export function* matchInlineSkills(text: string, skills: readonly InlineSkill[]) {
  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const name = match[2] ?? "";
    const skill = skills.find((candidate) => candidate.name === name);
    if (!skill) continue;
    const start = match.index + (match[1]?.length ?? 0);
    yield { start, end: match.index + match[0].length, skill, rawText: `$${name}` };
  }
}

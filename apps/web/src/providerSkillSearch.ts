import type { ServerProviderSkill } from "@t3tools/contracts";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";

import { formatProviderSkillDisplayName } from "./providerSkillPresentation";

function providerSkillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function mergeProviderSkillCatalogs(
  nativeSkills: ReadonlyArray<ServerProviderSkill>,
  discoveredSkills: ReadonlyArray<ServerProviderSkill>,
): ServerProviderSkill[] {
  const skillsByName = new Map<string, ServerProviderSkill>();
  for (const skill of [...nativeSkills, ...discoveredSkills]) {
    const key = providerSkillNameKey(skill.name);
    if (!skillsByName.has(key)) {
      skillsByName.set(key, skill);
    }
  }
  return [...skillsByName.values()];
}

function scoreProviderSkill(skill: ServerProviderSkill, query: string): number | null {
  const normalizedName = skill.name.toLowerCase();
  const normalizedLabel = formatProviderSkillDisplayName(skill).toLowerCase();
  const normalizedShortDescription = skill.shortDescription?.toLowerCase() ?? "";
  const normalizedDescription = skill.description?.toLowerCase() ?? "";
  const normalizedScope = skill.scope?.toLowerCase() ?? "";

  const scores = [
    scoreQueryMatch({
      value: normalizedName,
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    scoreQueryMatch({
      value: normalizedLabel,
      query,
      exactBase: 1,
      prefixBase: 3,
      boundaryBase: 5,
      includesBase: 7,
      fuzzyBase: 110,
    }),
    scoreQueryMatch({
      value: normalizedShortDescription,
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
    scoreQueryMatch({
      value: normalizedDescription,
      query,
      exactBase: 30,
      prefixBase: 32,
      boundaryBase: 34,
      includesBase: 36,
    }),
    scoreQueryMatch({
      value: normalizedScope,
      query,
      exactBase: 40,
      prefixBase: 42,
      includesBase: 44,
    }),
  ].filter((score): score is number => score !== null);

  if (scores.length === 0) {
    return null;
  }

  return Math.min(...scores);
}

/**
 * One skill name can be defined in more than one scope (a personal copy and a
 * project copy, say). The menus offer a name, not a file, so only the first
 * enabled definition is offered.
 */
export function dedupeProviderSkillsByName(
  skills: ReadonlyArray<ServerProviderSkill>,
): ServerProviderSkill[] {
  const seenNames = new Set<string>();
  return skills.filter((skill) => {
    const key = providerSkillNameKey(skill.name);
    if (seenNames.has(key)) {
      return false;
    }
    seenNames.add(key);
    return true;
  });
}

export function searchProviderSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
  query: string,
  limit = Number.POSITIVE_INFINITY,
): ServerProviderSkill[] {
  const enabledSkills = dedupeProviderSkillsByName(skills.filter((skill) => skill.enabled));
  const normalizedQuery = normalizeSearchQuery(query, { trimLeadingPattern: /^\$+/ });

  if (!normalizedQuery) {
    return enabledSkills;
  }

  const ranked: Array<{
    item: ServerProviderSkill;
    score: number;
    tieBreaker: string;
  }> = [];

  for (const skill of enabledSkills) {
    const score = scoreProviderSkill(skill, normalizedQuery);
    if (score === null) {
      continue;
    }

    insertRankedSearchResult(
      ranked,
      {
        item: skill,
        score,
        tieBreaker: `${formatProviderSkillDisplayName(skill).toLowerCase()}\u0000${skill.name}`,
      },
      limit,
    );
  }

  return ranked.map((entry) => entry.item);
}

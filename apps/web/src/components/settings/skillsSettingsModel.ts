import { DRIVER_LABEL } from "@t3tools/shared/providerVocabulary";
import { ProviderDriverKind, type ServerProviderSkill } from "@t3tools/contracts";

export interface SkillOriginInfo {
  readonly label: string;
  readonly provider: ProviderDriverKind | null;
}

export interface SettingsSkillSource {
  readonly skill: ServerProviderSkill;
  readonly origin: string;
  readonly originInfo: SkillOriginInfo;
}

export interface SettingsSkillGroup {
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly primarySkill: ServerProviderSkill;
  readonly providers: ReadonlyArray<ProviderDriverKind>;
  readonly sources: ReadonlyArray<SettingsSkillSource>;
  readonly section: string;
}

export interface SettingsSkillSection {
  readonly key: string;
  readonly title: string;
  readonly groups: ReadonlyArray<SettingsSkillGroup>;
}

const SHARED_SKILLS_SECTION = "shared";
const PERSONAL_ORIGIN = "personal";
export const ORIGIN_SECTION_ORDER = [
  "ronin",
  "codex",
  "claude",
  "cursor",
  "grok",
  "opencode",
  "agents",
  "project",
] as const;

export function skillOriginInfo(scope: string | undefined): SkillOriginInfo {
  switch (scope) {
    case "ronin":
      return { label: "Ronin", provider: null };
    case "codex":
      return { label: DRIVER_LABEL.codex, provider: ProviderDriverKind.make("codex") };
    case "claude":
      return { label: DRIVER_LABEL.claudeAgent, provider: ProviderDriverKind.make("claudeAgent") };
    case "cursor":
      return { label: DRIVER_LABEL.cursor, provider: ProviderDriverKind.make("cursor") };
    case "grok":
      return { label: DRIVER_LABEL.grok, provider: ProviderDriverKind.make("grok") };
    case "opencode":
      return { label: DRIVER_LABEL.opencode, provider: ProviderDriverKind.make("opencode") };
    case "agents":
      return { label: "Shared (.agents)", provider: null };
    case "project":
      return { label: "Project", provider: null };
    default:
      return { label: scope ?? "Personal", provider: null };
  }
}

export function settingsSkillNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function skillDisplayName(skill: ServerProviderSkill): string {
  return skill.displayName ?? skill.name;
}

function originRank(origin: string): number {
  const index = (ORIGIN_SECTION_ORDER as readonly string[]).indexOf(origin);
  return index >= 0 ? index : ORIGIN_SECTION_ORDER.length;
}

function sectionTitle(section: string): string {
  if (section === SHARED_SKILLS_SECTION) {
    return "Shared skills";
  }
  return `From ${skillOriginInfo(section).label}`;
}

function sectionRank(section: string): number {
  if (section === SHARED_SKILLS_SECTION) {
    return -1;
  }
  return originRank(section);
}

export function buildSettingsSkillGroups(
  skills: ReadonlyArray<ServerProviderSkill>,
): SettingsSkillGroup[] {
  const groups = new Map<string, SettingsSkillSource[]>();
  for (const skill of skills) {
    const key = settingsSkillNameKey(skill.name);
    const origin = skill.scope ?? PERSONAL_ORIGIN;
    const source: SettingsSkillSource = {
      skill,
      origin,
      originInfo: skillOriginInfo(origin),
    };
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }

  return [...groups.entries()]
    .map(([key, unsortedSources]): SettingsSkillGroup | null => {
      const sources = unsortedSources.toSorted((left, right) =>
        `${originRank(left.origin).toString().padStart(2, "0")}\u0000${left.skill.path}`.localeCompare(
          `${originRank(right.origin).toString().padStart(2, "0")}\u0000${right.skill.path}`,
        ),
      );
      const primarySkill = sources[0]?.skill;
      if (!primarySkill) {
        return null;
      }
      const providers = sources
        .map((source) => source.originInfo.provider)
        .filter((provider): provider is ProviderDriverKind => provider !== null)
        .filter((provider, index, all) => all.indexOf(provider) === index);
      const section =
        sources.length > 1 ? SHARED_SKILLS_SECTION : (sources[0]?.origin ?? PERSONAL_ORIGIN);
      return {
        key,
        displayName: skillDisplayName(primarySkill),
        description: primarySkill.shortDescription ?? primarySkill.description ?? "No description.",
        primarySkill,
        providers,
        sources,
        section,
      };
    })
    .filter((group): group is SettingsSkillGroup => group !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function buildSettingsSkillSections(
  skills: ReadonlyArray<ServerProviderSkill>,
): SettingsSkillSection[] {
  const sections = new Map<string, SettingsSkillGroup[]>();
  for (const group of buildSettingsSkillGroups(skills)) {
    sections.set(group.section, [...(sections.get(group.section) ?? []), group]);
  }

  return [...sections.entries()]
    .map(([key, groups]) => ({
      key,
      title: sectionTitle(key),
      groups,
    }))
    .sort((left, right) => sectionRank(left.key) - sectionRank(right.key));
}

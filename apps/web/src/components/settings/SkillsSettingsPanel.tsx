import { BoxesIcon } from "lucide-react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useSkillsCatalog } from "../../state/skillsCatalog";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import {
  buildSettingsSkillGroups,
  buildSettingsSkillSections,
  settingsSkillNameKey,
} from "./skillsSettingsModel";

export function SkillsSettingsPanel() {
  const catalog = useSkillsCatalog();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const disabledSkillNames = new Set(
    (settings.skills?.disabled ?? []).map((name) => settingsSkillNameKey(name)),
  );
  const skillGroups = buildSettingsSkillGroups(catalog.skills);
  const skillSections = buildSettingsSkillSections(catalog.skills);
  const totalSkills = skillGroups.length;
  const enabledSkills = skillGroups.filter((group) => !disabledSkillNames.has(group.key)).length;

  const setSkillEnabled = (skillName: string, enabled: boolean) => {
    const next = new Set(
      (settings.skills?.disabled ?? []).map((name) => settingsSkillNameKey(name)),
    );
    const key = settingsSkillNameKey(skillName);
    if (enabled) {
      next.delete(key);
    } else {
      next.add(key);
    }
    updateSettings({
      skills: { disabled: [...next].sort() },
    });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection id="agent-skills" title="Portable skills">
        <SettingsRow
          title="Ronin skills folder"
          description="Skills placed here are available on every provider. When a provider already ships its own copy of a skill, that copy is used; otherwise Ronin's copy is the fallback."
          status={
            catalog.roninSkillsDir ? (
              <code className="break-all text-[11px] text-secondary-label">
                {catalog.roninSkillsDir}
              </code>
            ) : null
          }
          control={
            <span className="text-xs font-medium text-secondary-label">
              {catalog.isPending
                ? "Scanning…"
                : `${enabledSkills} of ${totalSkills} skill${totalSkills === 1 ? "" : "s"} enabled`}
            </span>
          }
        />
      </SettingsSection>

      {catalog.error ? (
        <SettingsSection title="Skills">
          <SettingsRow
            title="Skill discovery failed"
            description="Ronin could not scan the skill folders. Retry after checking that the server is running."
          />
        </SettingsSection>
      ) : null}

      {!catalog.isPending && !catalog.error && totalSkills === 0 ? (
        <SettingsSection title="Skills">
          <SettingsRow
            title="No skills found"
            description="Add a folder containing a SKILL.md to the Ronin skills folder above, or install skills for any supported provider."
          />
        </SettingsSection>
      ) : null}

      {skillSections.map((section) => (
        <SettingsSection key={section.key} title={section.title}>
          {section.groups.map((group) => {
            const enabled = !disabledSkillNames.has(group.key);
            return (
              <SettingsRow
                key={group.key}
                title={
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <BoxesIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{group.displayName}</span>
                  </span>
                }
                description={group.description}
                status={
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-[11px] text-secondary-label">
                      {group.sources.map((source) => source.originInfo.label).join(" · ")}
                    </span>
                    {group.sources.map((source) => (
                      <code
                        key={source.skill.path}
                        className="truncate text-[11px] text-secondary-label"
                      >
                        {source.skill.path}
                      </code>
                    ))}
                  </span>
                }
                control={
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) =>
                      setSkillEnabled(group.primarySkill.name, Boolean(checked))
                    }
                    aria-label={`Enable the ${group.displayName} skill`}
                  />
                }
              />
            );
          })}
        </SettingsSection>
      ))}
    </SettingsPageContainer>
  );
}

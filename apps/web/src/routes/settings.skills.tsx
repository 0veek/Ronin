import { createFileRoute } from "@tanstack/react-router";

import { SkillsSettingsPanel } from "../components/settings/SkillsSettingsPanel";

function SettingsSkillsRoute() {
  return <SkillsSettingsPanel />;
}

export const Route = createFileRoute("/settings/skills")({
  component: SettingsSkillsRoute,
});

import { createFileRoute } from "@tanstack/react-router";

import { parseBuildSystemsSearch } from "../buildSystemDraft";
import { BuildSystemsSettingsPanel } from "../components/settings/BuildSystemsSettingsPanel";

function SettingsBuildSystemsRoute() {
  const search = Route.useSearch();
  return <BuildSystemsSettingsPanel createIntent={search} />;
}

export const Route = createFileRoute("/settings/build-systems")({
  validateSearch: parseBuildSystemsSearch,
  component: SettingsBuildSystemsRoute,
});

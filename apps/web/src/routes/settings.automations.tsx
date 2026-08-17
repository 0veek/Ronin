import { createFileRoute } from "@tanstack/react-router";

import { parseAutomationsSearch } from "../automationDraft";
import { AutomationsSettingsPanel } from "../components/settings/AutomationsSettingsPanel";

function SettingsAutomationsRoute() {
  const search = Route.useSearch();
  return <AutomationsSettingsPanel createIntent={search} />;
}

export const Route = createFileRoute("/settings/automations")({
  validateSearch: parseAutomationsSearch,
  component: SettingsAutomationsRoute,
});

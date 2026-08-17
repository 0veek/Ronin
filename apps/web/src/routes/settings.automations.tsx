import { createFileRoute } from "@tanstack/react-router";

import { AutomationsSettingsPanel } from "../components/settings/AutomationsSettingsPanel";

function SettingsAutomationsRoute() {
  return <AutomationsSettingsPanel />;
}

export const Route = createFileRoute("/settings/automations")({
  component: SettingsAutomationsRoute,
});

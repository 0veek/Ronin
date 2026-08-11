import { createFileRoute } from "@tanstack/react-router";

import { SpeechToTextSettingsPanel } from "../components/settings/SpeechToTextSettings";

export const Route = createFileRoute("/settings/speech-to-text")({
  component: SpeechToTextSettingsPanel,
});

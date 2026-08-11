import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  DEFAULT_SPEECH_TO_TEXT_MODELS,
  SPEECH_TO_TEXT_PROVIDERS,
  type SpeechToTextKeyStatus,
  type SpeechToTextProvider,
} from "@t3tools/contracts";
import { CheckIcon, MicIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * Speech-to-text configuration.
 *
 * The keys are the reason this page exists rather than the models: a key is
 * write-only from here on. It goes to the server's secret store, never into
 * settings.json, and the only thing that comes back is whether one is saved.
 * That is why there is no "show key" affordance -- there is nothing to show.
 */
const PROVIDER_LABEL: Record<SpeechToTextProvider, string> = {
  deepgram: "Deepgram",
  groq: "Groq",
  openrouter: "OpenRouter",
};

const PROVIDER_NOTE: Record<SpeechToTextProvider, string> = {
  deepgram: "Purpose-built speech API. Fast and punctuated.",
  groq: "Whisper, hosted. OpenAI-compatible transcription.",
  openrouter:
    "No transcription endpoint: audio is sent to a multimodal chat model with an instruction to transcribe. The model must accept audio input.",
};

const KEY_PLACEHOLDER: Record<SpeechToTextProvider, string> = {
  deepgram: "Deepgram API key",
  groq: "gsk_…",
  openrouter: "sk-or-…",
};

const EMPTY_STATUS: SpeechToTextKeyStatus = {
  deepgram: false,
  groq: false,
  openrouter: false,
};

function ProviderKeyRow({
  provider,
  configured,
  onSaved,
}: {
  readonly provider: SpeechToTextProvider;
  readonly configured: boolean;
  readonly onSaved: (status: SpeechToTextKeyStatus) => void;
}) {
  const environmentId = usePrimaryEnvironmentId();
  const setKey = useAtomCommand(serverEnvironment.setSpeechToTextKey, "save speech-to-text key");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (apiKey: string | null) => {
      if (environmentId === null) return;
      setBusy(true);
      try {
        const result = await setKey({ environmentId, input: { provider, apiKey } });
        if (result._tag === "Success") {
          onSaved(result.value);
          setDraft("");
        }
      } finally {
        setBusy(false);
      }
    },
    [environmentId, onSaved, provider, setKey],
  );

  const trimmed = draft.trim();

  return (
    <SettingsRow
      description={PROVIDER_NOTE[provider]}
      id={searchableSetting(`speech-to-text-${provider}`).id}
      status={
        configured ? (
          <span className="inline-flex items-center gap-1 text-success">
            <CheckIcon className="size-3" />
            Key saved
          </span>
        ) : (
          "No key saved"
        )
      }
      title={PROVIDER_LABEL[provider]}
      control={
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input
            aria-label={`${PROVIDER_LABEL[provider]} API key`}
            autoComplete="off"
            className="w-full font-mono text-xs sm:w-56"
            onChange={(event) => setDraft(event.target.value)}
            placeholder={configured ? "Replace saved key" : KEY_PLACEHOLDER[provider]}
            spellCheck={false}
            // A password field keeps the key out of shoulder-view and out of
            // screen recordings while it is being pasted.
            type="password"
            value={draft}
          />
          <Button
            disabled={busy || trimmed.length === 0 || environmentId === null}
            onClick={() => void submit(trimmed)}
            size="sm"
            type="button"
            variant="secondary"
          >
            Save
          </Button>
          {configured ? (
            <Button
              disabled={busy || environmentId === null}
              onClick={() => void submit(null)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Clear
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

function ModelRow({ provider }: { readonly provider: SpeechToTextProvider }) {
  const model = usePrimarySettings((settings) => settings.speechToText.models[provider]);
  const updateSettings = useUpdatePrimarySettings();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? model;

  const commit = useCallback(() => {
    const next = value.trim();
    setDraft(null);
    // An empty box means "use the default" rather than "no model", which would
    // make the provider reject every clip.
    updateSettings({
      speechToText: {
        models: { [provider]: next.length > 0 ? next : DEFAULT_SPEECH_TO_TEXT_MODELS[provider] },
      },
    });
  }, [provider, updateSettings, value]);

  return (
    <SettingsRow
      description={`Default: ${DEFAULT_SPEECH_TO_TEXT_MODELS[provider]}`}
      title={`${PROVIDER_LABEL[provider]} model`}
      control={
        <Input
          aria-label={`${PROVIDER_LABEL[provider]} model`}
          autoComplete="off"
          className="w-full font-mono text-xs sm:w-56"
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          spellCheck={false}
          value={value}
        />
      }
    />
  );
}

export function SpeechToTextSettingsPanel() {
  const environmentId = usePrimaryEnvironmentId();
  const settings = usePrimarySettings((current) => current.speechToText);
  const updateSettings = useUpdatePrimarySettings();

  const statusResult = useAtomValue(
    environmentId === null
      ? serverEnvironment.speechToTextKeyStatus({
          environmentId: "" as never,
          input: {},
        })
      : serverEnvironment.speechToTextKeyStatus({ environmentId, input: {} }),
  );
  const [override, setOverride] = useState<SpeechToTextKeyStatus | null>(null);
  const configured = override ?? Option.getOrNull(AsyncResult.value(statusResult)) ?? EMPTY_STATUS;

  return (
    <SettingsPageContainer>
      <SettingsSection
        icon={<MicIcon className="size-4" />}
        id={searchableSetting("speech-to-text").id}
        title="Dictation"
      >
        <SettingsRow
          description="Hold the mic button in the composer, or the dictation shortcut, to speak. Release to transcribe."
          title="Enable dictation"
          control={
            <Switch
              aria-label="Enable dictation"
              checked={settings.enabled}
              onCheckedChange={(checked) =>
                updateSettings({ speechToText: { enabled: Boolean(checked) } })
              }
            />
          }
        />

        <SettingsRow
          description="Which service transcribes your recordings."
          title="Provider"
          control={
            <Select
              onValueChange={(next) =>
                updateSettings({
                  speechToText: { provider: next as SpeechToTextProvider },
                })
              }
              value={settings.provider}
            >
              <SelectTrigger aria-label="Transcription provider" className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {SPEECH_TO_TEXT_PROVIDERS.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {PROVIDER_LABEL[provider]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          description="A BCP-47 code such as en or de. Leave empty to let the provider detect it."
          title="Language"
          control={
            <Input
              aria-label="Spoken language"
              autoComplete="off"
              className="w-full font-mono text-xs sm:w-56"
              onChange={(event) =>
                updateSettings({ speechToText: { language: event.target.value } })
              }
              placeholder="auto"
              spellCheck={false}
              value={settings.language}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="API keys">
        {SPEECH_TO_TEXT_PROVIDERS.map((provider) => (
          <ProviderKeyRow
            configured={configured[provider]}
            key={provider}
            onSaved={setOverride}
            provider={provider}
          />
        ))}
      </SettingsSection>

      <SettingsSection title="Models">
        {SPEECH_TO_TEXT_PROVIDERS.map((provider) => (
          <ModelRow key={provider} provider={provider} />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

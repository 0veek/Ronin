import { AuthSettingsWriteScope, type EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentScope } from "../../state/session";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveReviewGuideModelSelection } from "@t3tools/shared/serverSettings";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId, useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow } from "./settingsLayout";

/** Guides belong to the selected environment, including its model and instructions. */
export function ReviewGuideSettings() {
  const primaryId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    environments.find((environment) => environment.environmentId === selectedId) ??
    environments.find((environment) => environment.environmentId === primaryId) ??
    environments[0];
  const connected = selected?.connection.phase === "connected" && selected.serverConfig !== null;
  return (
    <>
      {environments.length > 1 ? (
        <SettingsRow
          title="Review guide environment"
          description="Guides, models, and instructions are shared by everyone using this environment."
          control={
            <Select value={selected?.environmentId ?? ""} onValueChange={setSelectedId}>
              <SelectTrigger aria-label="Review guide environment">
                <SelectValue>{selected?.label ?? "Select environment"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {environments.map((environment) => (
                  <SelectItem key={environment.environmentId} value={environment.environmentId}>
                    {environment.label}
                    {environment.connection.phase === "connected" ? "" : " · Offline"}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      {connected && selected ? (
        <ReviewGuideEnvironmentSettings
          key={selected.environmentId}
          environmentId={selected.environmentId}
        />
      ) : (
        <p className="py-3 text-sm text-muted-foreground">
          Connect an environment to configure review guides.
        </p>
      )}
    </>
  );
}

function ReviewGuideEnvironmentSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? [];
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const edited = useRef(false);
  const available = providers.filter(
    (provider) =>
      provider.enabled && (provider.driver === "codex" || provider.driver === "claudeAgent"),
  );
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(available), settings),
  );
  const selected = resolveReviewGuideModelSelection(settings, providers);
  const options = getCustomModelOptionsByInstance(
    settings,
    available,
    selected.instanceId,
    selected.model,
  );

  return (
    <fieldset disabled={!canWrite} className="min-w-0">
      <SettingsRow
        {...searchableSetting("review-guides")}
        description="Adds an optional Guide tab to pull requests. Write a tour of the change using Claude or Codex."
        control={
          <Switch
            aria-label="Review guides"
            checked={settings.reviewGuidesEnabled}
            onCheckedChange={(checked) => updateSettings({ reviewGuidesEnabled: Boolean(checked) })}
          />
        }
      />
      {settings.reviewGuidesEnabled ? (
        <>
          <SettingsRow
            {...searchableSetting("review-guide-model")}
            description="Model that reads a temporary checkout to write the guide. Without a separate model, uses the source control writer. Guides require Claude or Codex."
            control={
              <div className="flex flex-wrap items-center justify-end gap-2">
                {settings.reviewGuideModelSelection !== null ? (
                  <ProviderModelPicker
                    environmentId={environmentId}
                    activeInstanceId={selected.instanceId}
                    model={selected.model}
                    lockedProvider={null}
                    instanceEntries={entries}
                    modelOptionsByInstance={options}
                    triggerVariant="outline"
                    triggerAriaLabel="Review guide model"
                    onInstanceModelChange={(instanceId, model) =>
                      updateSettings({
                        reviewGuideModelSelection: createModelSelection(instanceId, model),
                      })
                    }
                  />
                ) : null}
                <Switch
                  aria-label="Use a separate review guide model"
                  checked={settings.reviewGuideModelSelection !== null}
                  disabled={settings.reviewGuideModelSelection === null && available.length === 0}
                  onCheckedChange={(checked) => {
                    const provider =
                      available.find((candidate) => candidate.instanceId === selected.instanceId) ??
                      available[0];
                    if (!checked) updateSettings({ reviewGuideModelSelection: null });
                    else if (provider) {
                      const model =
                        provider.instanceId === selected.instanceId
                          ? selected.model
                          : provider.models[0]?.slug;
                      if (model)
                        updateSettings({
                          reviewGuideModelSelection: createModelSelection(
                            provider.instanceId,
                            model,
                          ),
                        });
                    }
                  }}
                />
              </div>
            }
          />
          <SettingsRow
            {...searchableSetting("review-guide-instructions")}
            description="Choose what guides dwell on, skip, or show first. The format and coverage remain the same."
          >
            <div className="mt-3 max-w-2xl pb-3.5">
              <Textarea
                key={`${environmentId}:${settings.reviewGuideInstructions}`}
                aria-label="Review guide instructions"
                rows={4}
                defaultValue={settings.reviewGuideInstructions}
                placeholder="Show service interfaces before implementations. Keep summaries to two sentences."
                onChange={() => {
                  edited.current = true;
                }}
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (edited.current && value !== settings.reviewGuideInstructions)
                    updateSettings({ reviewGuideInstructions: value });
                  edited.current = false;
                }}
              />
            </div>
          </SettingsRow>
        </>
      ) : null}
    </fieldset>
  );
}

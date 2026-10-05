/**
 * Provider and model for an automation draft.
 *
 * Null is a first-class choice: it means "whatever this project starts new
 * threads with", so a later change to the project default moves the schedule
 * with it. Pinning a model is the other door, and it has to be obvious how
 * to walk back.
 *
 * @module AutomationModelField
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ModelSelection, ProviderDriverKind } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useMemo } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";

export function AutomationModelField({
  environmentId,
  modelSelection,
  projectDefaultModelSelection,
  disabled = false,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly modelSelection: ModelSelection | null;
  readonly projectDefaultModelSelection: ModelSelection | null;
  readonly disabled?: boolean;
  readonly onChange: (selection: ModelSelection | null) => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const serverProviders =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
      ),
    [serverProviders, settings],
  );
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, serverProviders),
    [serverProviders, settings],
  );
  const resolvedSelection = resolveDefaultProviderModelSelection(
    serverProviders,
    projectDefaultModelSelection,
  );
  const pickerSelection = modelSelection;
  const activeEntry = instanceEntries.find(
    (entry) =>
      entry.instanceId === pickerSelection?.instanceId && entry.enabled && entry.isAvailable,
  );
  const usesOverride = modelSelection !== null;

  const pinResolvedDefault = () => {
    const next = resolveDefaultProviderModelSelection(
      serverProviders,
      projectDefaultModelSelection,
    );
    if (disabled || next === null) return;
    onChange(createModelSelection(next.instanceId, next.model, next.options));
  };

  return (
    <div className="space-y-1.5">
      <span className="font-medium text-xs">Model</span>
      {usesOverride && pickerSelection && activeEntry ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <ProviderModelPicker
            disabled={disabled}
            preserveMissingModel
            activeInstanceId={pickerSelection.instanceId}
            model={pickerSelection.model}
            lockedProvider={null}
            instanceEntries={instanceEntries}
            modelOptionsByInstance={modelOptionsByInstance}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            triggerAriaLabel="Automation model"
            onInstanceModelChange={(instanceId, model) => {
              if (!disabled) onChange(createModelSelection(instanceId, model));
            }}
          />
          <TraitsPicker
            disabled={disabled}
            provider={activeEntry.driverKind as ProviderDriverKind}
            models={activeEntry.models}
            model={pickerSelection.model}
            prompt=""
            onPromptChange={() => {}}
            modelOptions={pickerSelection.options ?? []}
            allowPromptInjectedEffort={false}
            planModeEnabled={settings.planModeEnabled}
            triggerVariant="outline"
            triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
            onModelOptionsChange={(nextOptions) => {
              if (disabled) return;
              onChange(
                createModelSelection(
                  pickerSelection.instanceId,
                  pickerSelection.model,
                  nextOptions,
                ),
              );
            }}
          />
          <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            Use project default
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-muted-foreground">
            {usesOverride
              ? "Saved model is no longer available"
              : projectDefaultModelSelection === null
                ? "No project default"
                : "Project default"}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || resolvedSelection === null}
            onClick={pinResolvedDefault}
          >
            Choose a model
          </Button>
          {usesOverride ? (
            <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
              Use project default
            </Button>
          ) : null}
        </div>
      )}
      <p className="text-2xs text-secondary-label">
        {usesOverride && pickerSelection && activeEntry
          ? "This automation always uses this provider and model."
          : usesOverride
            ? "The pinned provider is unavailable. Pick another, or go back to the project default."
            : projectDefaultModelSelection === null
              ? resolvedSelection === null
                ? "This project has no default model. Add a provider, then choose a model."
                : "This project has no default model. Choose a model before saving."
              : "Uses whatever this project starts new threads with."}
      </p>
    </div>
  );
}

/**
 * Choosing who races.
 *
 * One row per configured provider instance, each with its own model and its
 * own checkbox, because that is the shape of the decision: not "pick a model"
 * but "pick which of my subscriptions should try this". A row is checked into
 * the race and keeps its model choice while unchecked, so toggling one off to
 * reconsider does not throw away the model you already picked for it.
 *
 * @module SecondOpinionDialog
 */
import { useAtomValue } from "@effect/atom-react";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { SplitIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { usePrimarySettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import {
  SECOND_OPINION_MAX_ENTRANTS,
  secondOpinionSelectionError,
  type SecondOpinionEntrant,
} from "~/secondOpinion";
import { primaryServerProvidersAtom } from "~/state/server";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function SecondOpinionDialog({
  onOpenChange,
  onStart,
  open,
  prompt,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onStart: (entrants: ReadonlyArray<SecondOpinionEntrant>) => void;
  readonly open: boolean;
  readonly prompt: string;
}) {
  const settings = usePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, serverProviders),
    [serverProviders, settings],
  );
  const entries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
        // Only an instance that is switched on and actually usable can race.
      ).filter((entry) => entry.enabled && entry.isAvailable),
    [serverProviders, settings],
  );

  const [checkedInstanceIds, setCheckedInstanceIds] = useState<ReadonlySet<string>>(new Set());
  const [modelByInstanceId, setModelByInstanceId] = useState<Readonly<Record<string, string>>>({});

  const modelsFor = useCallback(
    (instanceId: string) => {
      const entry = entries.find((candidate) => candidate.instanceId === instanceId);
      const custom = modelOptionsByInstance.get(instanceId as ProviderInstanceId) ?? [];
      const slugs = new Set<string>();
      const options: Array<{ slug: string; name: string }> = [];
      for (const model of [...(entry?.models ?? []), ...custom]) {
        if (slugs.has(model.slug)) continue;
        slugs.add(model.slug);
        options.push({ slug: model.slug, name: model.name });
      }
      return options;
    },
    [entries, modelOptionsByInstance],
  );

  const resolveModel = useCallback(
    (instanceId: string) => {
      const chosen = modelByInstanceId[instanceId];
      if (chosen !== undefined) return chosen;
      const options = modelsFor(instanceId);
      const entry = entries.find((candidate) => candidate.instanceId === instanceId);
      const preferred = entry?.models.find((model) => model.isDefault === true)?.slug;
      return preferred ?? options[0]?.slug ?? null;
    },
    [entries, modelByInstanceId, modelsFor],
  );

  const entrants = useMemo((): ReadonlyArray<SecondOpinionEntrant> => {
    const chosen: SecondOpinionEntrant[] = [];
    for (const entry of entries) {
      if (!checkedInstanceIds.has(entry.instanceId)) continue;
      const model = resolveModel(entry.instanceId);
      if (model === null) continue;
      chosen.push({
        modelSelection: createModelSelection(entry.instanceId, model) as ModelSelection,
        label: entry.displayName,
      });
    }
    return chosen;
  }, [checkedInstanceIds, entries, resolveModel]);

  const selectionError = secondOpinionSelectionError(entrants);
  const atCap = entrants.length >= SECOND_OPINION_MAX_ENTRANTS;

  const toggle = (instanceId: string, checked: boolean) => {
    setCheckedInstanceIds((current) => {
      const next = new Set(current);
      if (checked) next.add(instanceId);
      else next.delete(instanceId);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>Get a second opinion</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Send this prompt to more than one model. Each answers in its own thread and its own
            worktree, so their edits never mix.
          </p>
          <blockquote className="max-h-24 overflow-auto whitespace-pre-wrap rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-foreground/85 text-xs">
            {prompt}
          </blockquote>
          {entries.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground text-sm">
              No providers are available to compare. Enable at least two in Settings &rarr;
              Providers.
            </p>
          ) : (
            <ul className="space-y-1">
              {entries.map((entry) => {
                const checked = checkedInstanceIds.has(entry.instanceId);
                const options = modelsFor(entry.instanceId);
                const model = resolveModel(entry.instanceId);
                return (
                  <li
                    className="flex items-center gap-2.5 rounded-md border border-border/60 px-2.5 py-2"
                    key={entry.instanceId}
                  >
                    <Checkbox
                      checked={checked}
                      // A full field must not look clickable-but-dead: rows
                      // already in the race stay toggleable so you can swap one
                      // out without unchecking everything first.
                      disabled={!checked && atCap}
                      onCheckedChange={(next) => toggle(entry.instanceId, Boolean(next))}
                      aria-label={`Compare with ${entry.displayName}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{entry.displayName}</span>
                    <Select
                      value={model ?? ""}
                      onValueChange={(value) => {
                        if (value === null) return;
                        setModelByInstanceId((current) => ({
                          ...current,
                          [entry.instanceId]: value,
                        }));
                      }}
                    >
                      <SelectTrigger
                        className="w-44 shrink-0"
                        aria-label={`Model for ${entry.displayName}`}
                      >
                        <SelectValue>
                          {options.find((option) => option.slug === model)?.name ?? "Default"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup align="end" alignItemWithTrigger={false}>
                        {options.map((option) => (
                          <SelectItem hideIndicator key={option.slug} value={option.slug}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter className="items-center justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
            {selectionError ?? `${entrants.length} models will answer this prompt.`}
          </span>
          <Button
            type="button"
            disabled={selectionError !== null}
            onClick={() => {
              onStart(entrants);
              onOpenChange(false);
            }}
          >
            <SplitIcon className="size-3.5" />
            Compare
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

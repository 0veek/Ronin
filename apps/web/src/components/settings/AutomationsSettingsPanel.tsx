/**
 * Settings → Automations.
 *
 * A schedule that runs an agent unattended is a promise the app makes on the
 * user's behalf, so this page is written to make the promise legible: every
 * row restates its own schedule in words, says when it goes next, and can be
 * paused without being deleted. The run history below answers the question a
 * scheduler always eventually raises — "did it actually run?"
 *
 * @module AutomationsSettingsPanel
 */
import type { Automation, ModelSelection } from "@t3tools/contracts";
import {
  MAX_AUTOMATION_INTERVAL_MINUTES,
  MIN_AUTOMATION_INTERVAL_MINUTES,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { ClockIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  type AutomationDraftState,
  type AutomationsSearch,
  draftFromAutomation,
  draftSchedule,
  draftToCreateInput,
  draftToUpdateInput,
  isDraftComplete,
  startAutomationDraft,
  startAutomationDraftFromSearch,
} from "~/automationDraft";
import {
  formatSchedule,
  formatNextRun,
  formatTimeOfDay,
  parseTimeOfDay,
  toggleWeekday,
  WEEKDAY_OPTIONS,
} from "~/automationPresentation";
import {
  automationFailurePolicyOptions,
  automationFailurePolicyValue,
  stopAfterConsecutiveFailuresFromPolicyValue,
} from "~/lib/automationFailurePolicy";
import { useClientSettings } from "~/hooks/useSettings";
import { useProjects } from "~/state/entities";
import { useAutomations } from "~/state/automations";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { AutomationModelField } from "./AutomationModelField";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

export function AutomationsSettingsPanel({
  createIntent,
}: {
  readonly createIntent?: AutomationsSearch;
} = {}) {
  const { environmentId, automations, runs, create, update, remove, runNow } = useAutomations();
  const projects = useProjects();
  const navigate = useNavigate();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [draft, setDraft] = useState<AutomationDraftState | null>(null);
  const createKey = createIntent?.create === true ? `create:${createIntent.projectId ?? ""}` : null;
  const [appliedCreateKey, setAppliedCreateKey] = useState<string | null>(null);
  if (createKey !== null && createKey !== appliedCreateKey) {
    const next = startAutomationDraftFromSearch(
      createIntent ?? {},
      projects.map((project) => String(project.id)),
    );
    if (next !== null) {
      setDraft(next);
      setAppliedCreateKey(createKey);
    }
  }

  const projectTitleById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title])),
    [projects],
  );
  const automationTitleById = useMemo(
    () => new Map(automations.map((automation) => [automation.id, automation.title])),
    [automations],
  );

  const formatInstant = (iso: string) => formatDayAwareTimestamp(iso, timestampFormat);

  useEffect(() => {
    if (createIntent?.create !== true || appliedCreateKey === null) return;
    void navigate({ to: "/settings/automations", search: {}, replace: true });
  }, [appliedCreateKey, createIntent?.create, navigate]);

  const startDraft = () => {
    setDraft(startAutomationDraft(projects[0]?.id ?? ""));
  };

  const saveDraft = async () => {
    if (draft === null) return;
    if (draft.editing === null) {
      const input = draftToCreateInput(draft);
      if (input === null) return;
      await create(input);
    } else {
      // Project is deliberately not patchable: moving an automation between
      // projects would change which checkout it writes to, which is a new
      // automation rather than an edit.
      const input = draftToUpdateInput(draft);
      if (input === null) return;
      await update(input);
    }
    setDraft(null);
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("automations")}
        headerAction={
          draft === null && projects.length > 0 ? (
            <Button size="xs" variant="outline" onClick={startDraft}>
              <PlusIcon className="size-3.5" />
              New automation
            </Button>
          ) : null
        }
      >
        {projects.length === 0 ? (
          <SettingsRow
            title="No projects yet"
            description="Add a project first — an automation runs its prompt in one."
          />
        ) : null}

        {draft !== null ? (
          <AutomationDraftForm
            draft={draft}
            projects={projects.map((project) => ({
              id: String(project.id),
              title: project.title,
              defaultModelSelection: project.defaultModelSelection,
            }))}
            onChange={setDraft}
            onCancel={() => setDraft(null)}
            onSave={() => void saveDraft()}
          />
        ) : null}

        {automations.length === 0 && draft === null && projects.length > 0 ? (
          <SettingsRow
            title="Nothing scheduled"
            description="An automation sends a saved prompt to a project on a schedule. Each run opens its own thread, so you can read what it did."
          />
        ) : null}

        {automations.map((automation) => (
          <AutomationRow
            key={automation.id}
            automation={automation}
            projectTitle={projectTitleById.get(automation.projectId) ?? "Unknown project"}
            nextRunLabel={formatNextRun(automation, formatInstant)}
            onToggle={(enabled) => void update({ id: automation.id, enabled })}
            onEdit={() => setDraft(draftFromAutomation(automation))}
            onRunNow={() => void runNow(automation.id)}
            onDelete={() => void remove(automation.id)}
          />
        ))}
      </SettingsSection>

      {runs.length > 0 ? (
        <SettingsSection id="automation-history" title="Recent runs">
          {runs.map((run) => {
            // Narrowed once here so the click handler closes over a
            // non-null id instead of re-narrowing inside the callback.
            const openableThreadId = run.threadId;
            return (
              <SettingsRow
                key={run.id}
                title={automationTitleById.get(run.automationId) ?? "Deleted automation"}
                description={
                  run.detail ??
                  (run.outcome === "started"
                    ? "Started a thread."
                    : run.outcome === "skipped"
                      ? "Skipped."
                      : "Did not start.")
                }
                status={
                  <span className="text-2xs text-secondary-label">
                    {formatInstant(run.startedAt)}
                  </span>
                }
                control={
                  openableThreadId !== null && environmentId !== null ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        void navigate({
                          to: "/$environmentId/$threadId",
                          params: buildThreadRouteParams(
                            scopeThreadRef(environmentId, openableThreadId),
                          ),
                        });
                      }}
                    >
                      Open thread
                    </Button>
                  ) : (
                    <span
                      className={cn(
                        "text-xs",
                        run.outcome === "failed" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {run.outcome === "failed" ? "Failed" : "Skipped"}
                    </span>
                  )
                }
              />
            );
          })}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}

function AutomationRow({
  automation,
  projectTitle,
  nextRunLabel,
  onToggle,
  onEdit,
  onRunNow,
  onDelete,
}: {
  readonly automation: Automation;
  readonly projectTitle: string;
  readonly nextRunLabel: string;
  readonly onToggle: (enabled: boolean) => void;
  readonly onEdit: () => void;
  readonly onRunNow: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <SettingsRow
      title={automation.title}
      description={`${projectTitle} · ${formatSchedule(automation.schedule)}${
        automation.envMode === "worktree" ? " · new worktree" : " · current checkout"
      }${automation.modelSelection === null ? "" : ` · ${automation.modelSelection.model}`}`}
      status={
        <span className="inline-flex items-center gap-1.5 text-2xs text-secondary-label">
          <ClockIcon aria-hidden className="size-3" />
          {nextRunLabel}
        </span>
      }
      control={
        <div className="flex items-center gap-1.5">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Edit ${automation.title}`}
            onClick={onEdit}
          >
            <PencilIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Run ${automation.title} now`}
            onClick={onRunNow}
          >
            <PlayIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Delete ${automation.title}`}
            onClick={onDelete}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
          <Switch
            checked={automation.enabled}
            onCheckedChange={(checked) => onToggle(Boolean(checked))}
            aria-label={`Enable ${automation.title}`}
          />
        </div>
      }
    />
  );
}

function AutomationDraftForm({
  draft,
  projects,
  onChange,
  onCancel,
  onSave,
}: {
  readonly draft: AutomationDraftState;
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly defaultModelSelection: ModelSelection | null;
  }>;
  readonly onChange: (draft: AutomationDraftState) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  const schedule = draftSchedule(draft);
  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-muted/10 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="font-medium text-xs">Name</span>
          <Input
            value={draft.title}
            placeholder="Triage new issues"
            onChange={(event) => onChange({ ...draft, title: event.currentTarget.value })}
          />
        </label>
        <label className="space-y-1.5">
          <span className="font-medium text-xs">Project</span>
          <Select
            value={draft.projectId}
            disabled={draft.editing !== null}
            onValueChange={(value) => onChange({ ...draft, projectId: String(value) })}
          >
            <SelectTrigger className="w-full" aria-label="Project">
              <SelectValue>
                {projects.find((project) => project.id === draft.projectId)?.title ??
                  "Choose a project"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {projects.map((project) => (
                <SelectItem hideIndicator key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="font-medium text-xs">Prompt</span>
        <Textarea
          rows={4}
          value={draft.prompt}
          placeholder="Check for new issues assigned to me and summarise what changed since yesterday."
          onChange={(event) => onChange({ ...draft, prompt: event.currentTarget.value })}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="font-medium text-xs">Repeats</span>
          <Select
            value={draft.kind}
            onValueChange={(value) => {
              if (value === "interval" || value === "daily" || value === "once") {
                onChange({ ...draft, kind: value });
              }
            }}
          >
            <SelectTrigger className="w-full" aria-label="Schedule kind">
              <SelectValue>
                {draft.kind === "interval"
                  ? "On an interval"
                  : draft.kind === "daily"
                    ? "At a time of day"
                    : "Once"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="daily">
                At a time of day
              </SelectItem>
              <SelectItem hideIndicator value="interval">
                On an interval
              </SelectItem>
              <SelectItem hideIndicator value="once">
                Once
              </SelectItem>
            </SelectPopup>
          </Select>
        </label>

        <label className="space-y-1.5">
          <span className="font-medium text-xs">Runs in</span>
          <Select
            value={draft.envMode}
            onValueChange={(value) => {
              if (value === "local" || value === "worktree") {
                onChange({ ...draft, envMode: value });
              }
            }}
          >
            <SelectTrigger className="w-full" aria-label="Where it runs">
              <SelectValue>
                {draft.envMode === "worktree" ? "A new worktree" : "The current checkout"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="worktree">
                A new worktree
              </SelectItem>
              <SelectItem hideIndicator value="local">
                The current checkout
              </SelectItem>
            </SelectPopup>
          </Select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="font-medium text-xs">On failure</span>
        <Select
          value={automationFailurePolicyValue(draft.stopAfterConsecutiveFailures)}
          onValueChange={(value) =>
            onChange({
              ...draft,
              stopAfterConsecutiveFailures: stopAfterConsecutiveFailuresFromPolicyValue(
                String(value),
              ),
            })
          }
        >
          <SelectTrigger className="w-full sm:max-w-72" aria-label="On failure">
            <SelectValue>
              {
                automationFailurePolicyOptions(
                  automationFailurePolicyValue(draft.stopAfterConsecutiveFailures),
                ).find(
                  (option) =>
                    option.value ===
                    automationFailurePolicyValue(draft.stopAfterConsecutiveFailures),
                )?.label
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {automationFailurePolicyOptions(
              automationFailurePolicyValue(draft.stopAfterConsecutiveFailures),
            ).map((option) => (
              <SelectItem hideIndicator key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <span className="text-2xs text-secondary-label">
          Counts runs that never started. A successful start resets the count; hitting the limit
          pauses the schedule until you turn it back on.
        </span>
      </label>

      <AutomationModelField
        modelSelection={draft.modelSelection}
        projectDefaultModelSelection={
          projects.find((project) => project.id === draft.projectId)?.defaultModelSelection ?? null
        }
        onChange={(modelSelection) => onChange({ ...draft, modelSelection })}
      />

      {draft.kind === "daily" ? (
        <div className="space-y-2">
          <label className="block max-w-40 space-y-1.5">
            <span className="font-medium text-xs">At</span>
            <Input
              value={draft.timeOfDayText}
              placeholder={formatTimeOfDay(540)}
              aria-invalid={parseTimeOfDay(draft.timeOfDayText) === null}
              onChange={(event) => onChange({ ...draft, timeOfDayText: event.currentTarget.value })}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_OPTIONS.map((option) => {
              const selected = draft.weekdays.length === 0 || draft.weekdays.includes(option.day);
              return (
                <Button
                  key={option.day}
                  size="xs"
                  variant={selected ? "secondary" : "ghost"}
                  aria-pressed={selected}
                  onClick={() =>
                    onChange({ ...draft, weekdays: toggleWeekday(draft.weekdays, option.day) })
                  }
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          <p className="text-2xs text-secondary-label">With no day selected it runs every day.</p>
        </div>
      ) : null}

      {draft.kind === "interval" ? (
        <label className="block max-w-48 space-y-1.5">
          <span className="font-medium text-xs">Every (minutes)</span>
          <Input
            type="number"
            min={MIN_AUTOMATION_INTERVAL_MINUTES}
            max={MAX_AUTOMATION_INTERVAL_MINUTES}
            value={String(draft.everyMinutes)}
            onChange={(event) =>
              onChange({ ...draft, everyMinutes: Number(event.currentTarget.value) })
            }
          />
          <span className="text-2xs text-secondary-label">
            At least {MIN_AUTOMATION_INTERVAL_MINUTES} minutes — a turn often runs longer than that.
          </span>
        </label>
      ) : null}

      {draft.kind === "once" ? (
        <label className="block max-w-64 space-y-1.5">
          <span className="font-medium text-xs">At</span>
          <Input
            type="datetime-local"
            value={draft.onceAtText}
            onChange={(event) => onChange({ ...draft, onceAtText: event.currentTarget.value })}
          />
        </label>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-2xs text-secondary-label">
          {schedule === null ? "Finish the schedule to save." : formatSchedule(schedule)}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="xs" disabled={!isDraftComplete(draft)} onClick={onSave}>
            {draft.editing === null ? "Save automation" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

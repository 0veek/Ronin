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
import type { Automation, AutomationRun, EnvironmentId, ModelSelection } from "@t3tools/contracts";
import {
  MAX_AUTOMATION_INTERVAL_MINUTES,
  MIN_AUTOMATION_INTERVAL_MINUTES,
  AUTOMATION_MAX_TITLE_CHARS,
  AUTOMATION_MAX_PROMPT_CHARS,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { useNavigate } from "@tanstack/react-router";
import {
  ClockIcon,
  CopyIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type AutomationDraftState,
  type AutomationsSearch,
  draftFromAutomation,
  duplicateAutomationDraft,
  draftSchedule,
  draftToCreateInput,
  draftToUpdateInput,
  isDraftComplete,
  canSaveAutomationDraft,
  startAutomationDraft,
  startAutomationDraftFromSearch,
  resolveAutomationEnvironmentId,
} from "~/automationDraft";
import { draftFromAutomationRecipe } from "~/automationRecipes";
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
import { useAutomations, type AutomationsController } from "~/state/automations";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "~/state/environments";
import { useEnvironmentSessionState } from "~/state/session";
import { isElectron } from "~/env";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { AutomationModelField } from "./AutomationModelField";
import { AutomationRecipeGallery } from "./AutomationRecipeGallery";
import { AutomationWebhookPanel } from "./AutomationWebhookPanel";
import {
  resolvePrimaryOperateAccess,
  resolveRemoteOperateAccess,
  type ProviderOperateAccess,
} from "./ProviderSettingsPanel.logic";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

export function AutomationsSettingsPanel({
  createIntent,
}: {
  readonly createIntent?: AutomationsSearch;
} = {}) {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const environmentId = resolveAutomationEnvironmentId({
    requestedEnvironmentId: createIntent?.environmentId,
    primaryEnvironmentId,
    environmentIds: environments.map((environment) => environment.environmentId),
  });
  const environment = environments.find((candidate) => candidate.environmentId === environmentId);
  const navigate = useNavigate();
  const selectEnvironment = (nextEnvironmentId: EnvironmentId) => {
    void navigate({ to: "/settings/automations", search: { environmentId: nextEnvironmentId } });
  };
  if (environment === undefined) {
    return (
      <SettingsPageContainer>
        <SettingsSection {...searchableSetting("automations")}>
          <AutomationMachinePicker
            environments={environments}
            environmentId={environmentId}
            onChange={selectEnvironment}
          />
          <SettingsRow
            title="Machine unavailable"
            description="Choose a connected machine to manage its automations, or add it in Connections."
          />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }
  return (
    <EnvironmentAutomationsSettings
      key={environment.environmentId}
      environment={environment}
      environments={environments}
      primaryEnvironmentId={primaryEnvironmentId}
      {...(createIntent === undefined ? {} : { createIntent })}
      onSelectEnvironment={selectEnvironment}
    />
  );
}

function EnvironmentAutomationsSettings({
  environment,
  environments,
  primaryEnvironmentId,
  createIntent,
  onSelectEnvironment,
}: {
  readonly environment: EnvironmentPresentation;
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly createIntent?: AutomationsSearch;
  readonly onSelectEnvironment: (environmentId: EnvironmentId) => void;
}) {
  const environmentId = environment.environmentId;
  const {
    automations,
    runs,
    isLoading,
    error,
    pendingAutomationIds,
    refresh,
    create,
    update,
    remove,
    runNow,
  } = useAutomations(environmentId);
  const session = useEnvironmentSessionState(environmentId);
  const sessionAccess = {
    session: session.data,
    isPending: session.isPending,
    hasError: session.hasError,
  };
  const operateAccess =
    environmentId === primaryEnvironmentId
      ? resolvePrimaryOperateAccess({
          ...sessionAccess,
          isPrimary: true,
          hasDesktopBridge: isElectron,
        })
      : resolveRemoteOperateAccess(sessionAccess);
  const connected = environment.connection.phase === "connected";
  const canEdit = connected && operateAccess === "granted";
  const allProjects = useProjects();
  const projects = useMemo(
    () => allProjects.filter((project) => project.environmentId === environmentId),
    [allProjects, environmentId],
  );
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { draft, setDraft, isSaving, saveDraft } = useAutomationEditor({
    environmentId,
    createIntent,
    projects,
    canEdit,
    create,
    update,
  });

  const projectTitleById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title])),
    [projects],
  );
  const formatInstant = (iso: string) => formatDayAwareTimestamp(iso, timestampFormat);

  const startDraft = () => {
    setDraft(startAutomationDraft(projects[0]?.id ?? ""));
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("automations")}
        headerAction={
          <div className="flex items-center gap-2">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh automations and runs"
              disabled={!connected || isLoading}
              onClick={refresh}
            >
              <RefreshCwIcon aria-hidden className="size-3.5" />
            </Button>
            {draft === null && projects.length > 0 && canEdit ? (
              <Button size="xs" variant="outline" onClick={startDraft}>
                <PlusIcon className="size-3.5" />
                New automation
              </Button>
            ) : null}
          </div>
        }
      >
        <AutomationMachinePicker
          environments={environments}
          environmentId={environmentId}
          disabled={draft !== null}
          onChange={onSelectEnvironment}
        />
        <AutomationStatus
          environment={environment}
          operateAccess={operateAccess}
          isLoading={isLoading}
          error={error}
          refresh={refresh}
        />

        <AutomationEmptyState
          hasProjects={projects.length > 0}
          hasAutomations={automations.length > 0}
          draftOpen={draft !== null}
          isLoading={isLoading}
          hasError={error !== null}
          connected={connected}
        />

        {draft === null && projects.length > 0 && canEdit ? (
          <AutomationRecipeGallery
            onChoose={(recipe) =>
              setDraft(draftFromAutomationRecipe(recipe, projects[0]?.id ?? ""))
            }
          />
        ) : null}

        {draft !== null ? (
          <AutomationDraftForm
            environmentId={environmentId}
            disabled={
              !canEdit ||
              isSaving ||
              (draft.editing !== null && pendingAutomationIds.has(draft.editing))
            }
            isSaving={isSaving}
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

        {automations.map((automation) => (
          <AutomationRow
            key={automation.id}
            environmentId={environmentId}
            onWebhookChange={refresh}
            automation={automation}
            disabled={!canEdit || isSaving || pendingAutomationIds.has(automation.id)}
            pending={pendingAutomationIds.has(automation.id)}
            draftOpen={draft !== null}
            beingEdited={draft?.editing === automation.id}
            projectTitle={projectTitleById.get(automation.projectId) ?? "Unknown project"}
            nextRunLabel={formatNextRun(automation, formatInstant)}
            onToggle={(enabled) => void update({ id: automation.id, enabled })}
            onEdit={() => setDraft(draftFromAutomation(automation))}
            onDuplicate={() =>
              setDraft(
                duplicateAutomationDraft(
                  automation,
                  automations.map((item) => item.title),
                ),
              )
            }
            onRunNow={() => void runNow(automation.id)}
            onDelete={() => void remove(automation.id)}
          />
        ))}
      </SettingsSection>

      <AutomationRunHistory
        environmentId={environmentId}
        automations={automations}
        runs={runs}
        formatInstant={formatInstant}
      />
    </SettingsPageContainer>
  );
}

async function saveAutomationDraft(
  draft: AutomationDraftState,
  create: (input: NonNullable<ReturnType<typeof draftToCreateInput>>) => Promise<boolean>,
  update: (input: NonNullable<ReturnType<typeof draftToUpdateInput>>) => Promise<boolean>,
) {
  if (draft.editing === null) {
    const input = draftToCreateInput(draft);
    return input !== null && (await create(input));
  } else {
    // Project is deliberately not patchable: moving an automation between
    // projects would change which checkout it writes to, which is a new
    // automation rather than an edit.
    const input = draftToUpdateInput(draft);
    return input !== null && (await update(input));
  }
}

function AutomationMachinePicker({
  environments,
  environmentId,
  disabled = false,
  onChange,
}: {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly environmentId: EnvironmentId | null;
  readonly disabled?: boolean;
  readonly onChange: (environmentId: EnvironmentId) => void;
}) {
  return (
    <SettingsRow
      title="Machine"
      description={
        disabled
          ? "Save or cancel this draft before switching machines."
          : "Schedules use this machine's projects, models, and clock."
      }
      control={
        <Select
          value={environmentId}
          disabled={disabled || environments.length === 0}
          onValueChange={(value) => {
            const selected = environments.find(
              (environment) => environment.environmentId === value,
            );
            if (selected && !disabled) onChange(selected.environmentId);
          }}
        >
          <SelectTrigger className="w-full sm:min-w-48" aria-label="Automation machine">
            <SelectValue>
              {environments.find((environment) => environment.environmentId === environmentId)
                ?.label ?? "Choose a machine"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {environments.map((environment) => (
              <SelectItem
                hideIndicator
                key={environment.environmentId}
                value={environment.environmentId}
              >
                {environment.label} · {connectionStatusText(environment.connection)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function AutomationStatus({
  environment,
  operateAccess,
  isLoading,
  error,
  refresh,
}: {
  readonly environment: EnvironmentPresentation;
  readonly operateAccess: ProviderOperateAccess;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}) {
  const connected = environment.connection.phase === "connected";
  const notice = automationAccessNotice(environment, operateAccess);
  return (
    <>
      {notice !== null ? (
        <SettingsRow title={notice.title} description={notice.description} />
      ) : null}
      {error !== null ? (
        <SettingsRow
          title="Could not load automations"
          description={error}
          control={
            <Button size="xs" variant="outline" onClick={refresh}>
              Retry
            </Button>
          }
        />
      ) : isLoading && connected ? (
        <SettingsRow
          title="Loading automations"
          description="Reading schedules from this machine."
        />
      ) : null}
    </>
  );
}

function automationAccessNotice(
  environment: EnvironmentPresentation,
  operateAccess: ProviderOperateAccess,
) {
  if (environment.connection.phase !== "connected")
    return {
      title: connectionStatusText(environment.connection),
      description:
        "Reconnect this machine to manage its schedules. Its saved automations keep running while its server is running.",
    };
  if (operateAccess === "pending")
    return {
      title: "Checking permissions",
      description: "Waiting for this machine to confirm your access.",
    };
  if (operateAccess === "denied")
    return {
      title: "Read-only access",
      description:
        "You can view automations and their runs. Creating, editing, or running one requires permission to operate this machine.",
    };
  return null;
}

function AutomationEmptyState({
  hasProjects,
  hasAutomations,
  draftOpen,
  isLoading,
  hasError,
  connected,
}: {
  readonly hasProjects: boolean;
  readonly hasAutomations: boolean;
  readonly draftOpen: boolean;
  readonly isLoading: boolean;
  readonly hasError: boolean;
  readonly connected: boolean;
}) {
  if (isLoading || hasError || !connected) return null;
  if (!hasProjects)
    return (
      <SettingsRow
        title="No projects in this environment"
        description="Add a project to this machine first — an automation runs its prompt in one."
      />
    );
  if (hasAutomations || draftOpen) return null;
  return (
    <SettingsRow
      title="Nothing scheduled"
      description="An automation sends a saved prompt to a project on a schedule. Each run opens its own thread, so you can read what it did."
    />
  );
}

function AutomationRow({
  environmentId,
  onWebhookChange,
  automation,
  projectTitle,
  nextRunLabel,
  onToggle,
  onEdit,
  onDuplicate,
  onRunNow,
  onDelete,
  disabled,
  draftOpen,
  pending,
  beingEdited,
}: {
  readonly automation: Automation;
  readonly environmentId: EnvironmentId;
  readonly onWebhookChange: () => void;
  readonly projectTitle: string;
  readonly nextRunLabel: string;
  readonly onToggle: (enabled: boolean) => void;
  readonly onEdit: () => void;
  readonly onDuplicate: () => void;
  readonly onRunNow: () => void;
  readonly onDelete: () => void;
  readonly disabled: boolean;
  readonly draftOpen: boolean;
  readonly pending: boolean;
  readonly beingEdited: boolean;
}) {
  return (
    <>
      <SettingsRow
        title={automation.title}
        description={`${projectTitle} · ${formatSchedule(automation.schedule)}${
          automation.envMode === "worktree" ? " · new worktree" : " · current checkout"
        }${automation.modelSelection === null ? "" : ` · ${automation.modelSelection.model}`}`}
        status={
          <span className="inline-flex items-center gap-1.5 text-2xs text-secondary-label">
            <ClockIcon aria-hidden className="size-3" />
            {pending ? "Working…" : nextRunLabel}
          </span>
        }
        control={
          <div className="flex items-center gap-1.5">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Edit ${automation.title}`}
              disabled={disabled || draftOpen}
              onClick={onEdit}
            >
              <PencilIcon className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Duplicate ${automation.title}`}
              disabled={disabled || draftOpen}
              onClick={onDuplicate}
            >
              <CopyIcon className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Run ${automation.title} now`}
              disabled={disabled || automation.schedule._tag === "webhook"}
              onClick={onRunNow}
            >
              <PlayIcon className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Delete ${automation.title}`}
              disabled={disabled || beingEdited}
              onClick={onDelete}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
            <Switch
              disabled={disabled}
              checked={automation.enabled}
              onCheckedChange={(checked) => onToggle(Boolean(checked))}
              aria-label={`Enable ${automation.title}`}
            />
          </div>
        }
      />
      {automation.webhook ? (
        <AutomationWebhookPanel
          automation={automation}
          environmentId={environmentId}
          disabled={disabled}
          onChange={onWebhookChange}
        />
      ) : null}
    </>
  );
}

const AUTOMATION_TRIGGER_LABELS = {
  interval: "On an interval",
  daily: "At a time of day",
  webhook: "On webhook delivery",
  once: "Once",
} satisfies Record<AutomationDraftState["kind"], string>;

function AutomationDraftForm({
  environmentId,
  disabled,
  isSaving,
  draft,
  projects,
  onChange: onDraftChange,
  onCancel,
  onSave,
}: {
  readonly environmentId: EnvironmentId;
  readonly disabled: boolean;
  readonly isSaving: boolean;
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
  const project = projects.find((candidate) => candidate.id === draft.projectId);
  const onChange = (next: AutomationDraftState) => {
    if (!disabled) onDraftChange(next);
  };
  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-muted/10 p-3 sm:p-4">
      <h3 className="text-sm font-medium">
        {draft.editing === null ? "New automation" : "Edit automation"}
      </h3>
      <fieldset disabled={disabled} className="min-w-0 space-y-3">
        {draft.editing === null && draft.title.length === 0 && draft.prompt.length === 0 ? (
          <AutomationRecipeGallery
            onChoose={(recipe) => onChange(draftFromAutomationRecipe(recipe, draft.projectId))}
          />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="font-medium text-xs">Name</span>
            <Input
              value={draft.title}
              maxLength={AUTOMATION_MAX_TITLE_CHARS}
              placeholder="Triage new issues"
              onChange={(event) => onChange({ ...draft, title: event.currentTarget.value })}
            />
          </label>
          <label className="space-y-1.5">
            <span className="font-medium text-xs">Project</span>
            <Select
              value={draft.projectId}
              disabled={disabled || draft.editing !== null}
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
            maxLength={AUTOMATION_MAX_PROMPT_CHARS}
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
              disabled={disabled}
              onValueChange={(value) => {
                if (
                  value === "interval" ||
                  value === "daily" ||
                  value === "once" ||
                  value === "webhook"
                ) {
                  onChange({ ...draft, kind: value });
                }
              }}
            >
              <SelectTrigger className="w-full" aria-label="Schedule kind">
                <SelectValue>{AUTOMATION_TRIGGER_LABELS[draft.kind]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="daily">
                  At a time of day
                </SelectItem>
                <SelectItem hideIndicator value="interval">
                  On an interval
                </SelectItem>
                <SelectItem hideIndicator value="webhook">
                  On webhook delivery
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
              disabled={disabled}
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
            disabled={disabled}
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
          disabled={disabled}
          environmentId={environmentId}
          modelSelection={draft.modelSelection}
          projectDefaultModelSelection={project?.defaultModelSelection ?? null}
          onChange={(modelSelection) => onChange({ ...draft, modelSelection })}
        />

        <AutomationScheduleFields draft={draft} onChange={onChange} />
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-2xs text-secondary-label">
          {schedule === null ? "Finish the schedule to save." : formatSchedule(schedule)}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="xs" variant="ghost" disabled={isSaving} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="xs"
            disabled={disabled || !canSaveAutomationDraft(draft, project)}
            onClick={onSave}
          >
            {isSaving ? "Saving…" : draft.editing === null ? "Save automation" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function useAutomationEditor({
  environmentId,
  createIntent,
  projects,
  canEdit,
  create,
  update,
}: {
  readonly environmentId: EnvironmentId;
  readonly createIntent: AutomationsSearch | undefined;
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly defaultModelSelection: ModelSelection | null;
  }>;
  readonly canEdit: boolean;
  readonly create: AutomationsController["create"];
  readonly update: AutomationsController["update"];
}) {
  const navigate = useNavigate();
  const projectIds = projects.map((project) => project.id);
  const [draft, setDraft] = useState<AutomationDraftState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const createKey = createIntent?.create === true ? `create:${createIntent.projectId ?? ""}` : null;
  const [appliedCreateKey, setAppliedCreateKey] = useState<string | null>(null);
  if (createKey === null && appliedCreateKey !== null) setAppliedCreateKey(null);
  if (createKey !== null && createKey !== appliedCreateKey) {
    const next = startAutomationDraftFromSearch(createIntent ?? {}, projectIds);
    if (next !== null) {
      if (draft === null) setDraft(next);
      setAppliedCreateKey(createKey);
    }
  }

  useEffect(() => {
    if (createIntent?.create !== true || appliedCreateKey === null) return;
    void navigate({ to: "/settings/automations", search: { environmentId }, replace: true });
  }, [appliedCreateKey, createIntent?.create, environmentId, navigate]);

  const saveDraft = async () => {
    if (draft === null || !canEdit || savingRef.current || !isDraftComplete(draft)) return;
    const project = projects.find((candidate) => candidate.id === draft.projectId);
    if (!canSaveAutomationDraft(draft, project)) return;
    savingRef.current = true;
    setIsSaving(true);
    const saved = await saveAutomationDraft(draft, create, update).finally(() => {
      savingRef.current = false;
      setIsSaving(false);
    });
    if (saved) setDraft((current) => (current === draft ? null : current));
  };

  return { draft, setDraft, isSaving, saveDraft };
}

function AutomationRunHistory({
  environmentId,
  automations,
  runs,
  formatInstant,
}: {
  readonly environmentId: EnvironmentId;
  readonly automations: ReadonlyArray<Automation>;
  readonly runs: ReadonlyArray<AutomationRun>;
  readonly formatInstant: (iso: string) => string;
}) {
  const navigate = useNavigate();
  const automationTitleById = useMemo(
    () => new Map(automations.map((automation) => [automation.id, automation.title])),
    [automations],
  );

  if (runs.length === 0) return null;
  return (
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
              <span className="text-2xs text-secondary-label">{formatInstant(run.startedAt)}</span>
            }
            control={
              openableThreadId !== null ? (
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
  );
}

function AutomationScheduleFields({
  draft,
  onChange,
}: {
  readonly draft: AutomationDraftState;
  readonly onChange: (draft: AutomationDraftState) => void;
}) {
  return (
    <>
      {draft.kind === "webhook" ? (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">
            A URL is created when you save. Select the request data to send to the agent with
            placeholders such as {"{{body.action}}"}, {"{{body}}"}, or {"{{request}}"} in the
            prompt.
          </p>
          <label className="flex items-center gap-2 text-xs font-medium">
            <Switch
              checked={draft.webhookSignature != null}
              onCheckedChange={(checked) =>
                onChange({
                  ...draft,
                  webhookSignature: checked
                    ? { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" }
                    : null,
                })
              }
            />
            Verify an HMAC-SHA256 signature
          </label>
          {draft.webhookSignature != null ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                Signature header
                <Input
                  value={draft.webhookSignature.header}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      webhookSignature: {
                        ...draft.webhookSignature!,
                        header: event.currentTarget.value,
                      },
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-xs">
                Prefix
                <Input
                  value={draft.webhookSignature.prefix}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      webhookSignature: {
                        ...draft.webhookSignature!,
                        prefix: event.currentTarget.value,
                      },
                    })
                  }
                />
              </label>
              <label className="space-y-1 text-xs">
                Digest encoding
                <select
                  className="block h-8 w-full rounded-md border bg-background px-2"
                  value={draft.webhookSignature.encoding}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      webhookSignature: {
                        ...draft.webhookSignature!,
                        encoding: event.currentTarget.value === "base64" ? "base64" : "hex",
                      },
                    })
                  }
                >
                  <option value="hex">Hex</option>
                  <option value="base64">Base64</option>
                </select>
              </label>
              <label className="space-y-1 text-xs">
                Signing secret
                <Input
                  type="password"
                  autoComplete="off"
                  value={draft.webhookSignature.secret ?? ""}
                  placeholder={
                    draft.webhookHasSecret
                      ? "Leave blank to keep the saved secret"
                      : "Paste the signing secret"
                  }
                  onChange={(event) => {
                    const { secret: _previous, ...signature } = draft.webhookSignature!;
                    onChange({
                      ...draft,
                      webhookSignature: {
                        ...signature,
                        ...(event.currentTarget.value.trim()
                          ? { secret: event.currentTarget.value }
                          : {}),
                      },
                    });
                  }}
                />
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                The signing secret stays on the connected environment and is never sent to the
                agent.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
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
    </>
  );
}

/**
 * Settings → Build systems.
 *
 * A team is a promise that several models will share one checkout and one
 * task. This page makes the roster legible: who leads, who does the work,
 * which roles wait for a yes, and what actually happened the last time it
 * ran.
 *
 * @module BuildSystemsSettingsPanel
 */
import type { BuildSystem, BuildSystemRun, ModelSelection } from "@t3tools/contracts";
import {
  BUILD_SYSTEM_MAX_DELEGATIONS_LIMIT,
  BUILD_SYSTEM_MAX_TEAMMATES,
  isBuildSystemRunActive,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  type BuildSystemDraftState,
  type BuildSystemsSearch,
  draftFromBuildSystem,
  draftToCreateInput,
  draftToUpdateInput,
  emptyRoleDraft,
  isBuildSystemDraftComplete,
  nextRoleDraftKey,
  startBuildSystemDraft,
  startBuildSystemDraftFromSearch,
} from "~/buildSystemDraft";
import { useClientSettings } from "~/hooks/useSettings";
import { useProjects } from "~/state/entities";
import { useBuildSystemRunHistory, useBuildSystems } from "~/state/buildSystems";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatDayAwareTimestamp } from "~/timestampFormat";
import { cn } from "~/lib/utils";
import { BuildSystemRunDialog } from "../chat/BuildSystemRunDialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { AutomationModelField } from "./AutomationModelField";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function runStatusLabel(run: BuildSystemRun): string {
  switch (run.status) {
    case "starting":
    case "orchestrating":
    case "delegating":
      return "Running";
    case "waiting-gate":
      return "Needs approval";
    case "waiting-user":
      return "Needs a reply";
    case "completed":
      return "Completed";
    case "failed":
      return run.failureDetail ?? "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function BuildSystemsSettingsPanel({
  createIntent,
}: {
  readonly createIntent?: BuildSystemsSearch;
} = {}) {
  const { environmentId, buildSystems, create, update, remove, startRun } = useBuildSystems();
  const runs = useBuildSystemRunHistory();
  const [runSystemId, setRunSystemId] = useState<string | null>(null);
  const projects = useProjects();
  const navigate = useNavigate();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [draft, setDraft] = useState<BuildSystemDraftState | null>(null);
  const createKey = createIntent?.create === true ? `create:${createIntent.projectId ?? ""}` : null;
  const [appliedCreateKey, setAppliedCreateKey] = useState<string | null>(null);
  if (createKey === null && appliedCreateKey !== null) {
    // The intent was consumed and the search stripped; the next one is new even
    // when it asks for the same project.
    setAppliedCreateKey(null);
  }
  if (createKey !== null && createKey !== appliedCreateKey) {
    const next = startBuildSystemDraftFromSearch(
      createIntent ?? {},
      projects.map((project) => String(project.id)),
    );
    if (next !== null) {
      const project = projects.find((candidate) => String(candidate.id) === next.projectId);
      setDraft({
        ...next,
        orchestratorModelSelection: project?.defaultModelSelection ?? null,
      });
      setAppliedCreateKey(createKey);
    }
  }

  const projectTitleById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.title])),
    [projects],
  );
  const systemNameById = useMemo(
    () => new Map(buildSystems.map((system) => [system.id, system.name])),
    [buildSystems],
  );

  const formatInstant = (iso: string) => formatDayAwareTimestamp(iso, timestampFormat);

  useEffect(() => {
    if (createIntent?.create !== true || appliedCreateKey === null) return;
    void navigate({ to: "/settings/build-systems", search: {}, replace: true });
  }, [appliedCreateKey, createIntent?.create, navigate]);

  const startDraft = () => {
    const project = projects[0];
    setDraft({
      ...startBuildSystemDraft(project?.id ?? ""),
      orchestratorModelSelection: project?.defaultModelSelection ?? null,
    });
  };

  const saveDraft = async () => {
    if (draft === null) return;
    if (draft.editing === null) {
      const input = draftToCreateInput(draft);
      if (input === null) return;
      if (!(await create(input))) return;
    } else {
      const input = draftToUpdateInput(draft);
      if (input === null) return;
      if (!(await update(input))) return;
    }
    setDraft(null);
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("build-systems")}
        headerAction={
          draft === null && projects.length > 0 ? (
            <Button size="xs" variant="outline" onClick={startDraft}>
              <PlusIcon className="size-3.5" />
              New build system
            </Button>
          ) : null
        }
      >
        {projects.length === 0 ? (
          <SettingsRow
            title="No projects yet"
            description="Add a project first — a team runs its work in one."
          />
        ) : null}

        {draft !== null ? (
          <BuildSystemDraftForm
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

        {buildSystems.length === 0 && draft === null && projects.length > 0 ? (
          <SettingsRow
            title="No teams yet"
            description="A build system is a named team: one model leads, the others take roles. Running it opens a thread for each role and hands work around until the lead is done."
          />
        ) : null}

        {buildSystems.map((buildSystem) => (
          <BuildSystemRow
            key={buildSystem.id}
            buildSystem={buildSystem}
            projectTitle={projectTitleById.get(buildSystem.projectId) ?? "Unknown project"}
            onEdit={() => setDraft(draftFromBuildSystem(buildSystem))}
            onRun={() => setRunSystemId(buildSystem.id)}
            onDelete={() => void remove(buildSystem.id)}
          />
        ))}
      </SettingsSection>

      {runs.length > 0 ? (
        <SettingsSection id="build-system-history" title="Recent runs">
          {runs.map((entry) => {
            const openableThreadId = entry.orchestratorThreadId;
            return (
              <SettingsRow
                key={entry.id}
                title={systemNameById.get(entry.buildSystemId) ?? "Deleted team"}
                description={entry.summary ?? entry.task}
                status={
                  <span className="text-2xs text-secondary-label">
                    {formatInstant(entry.startedAt)}
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
                      {isBuildSystemRunActive(entry.status) ? "Open run" : "Open thread"}
                    </Button>
                  ) : (
                    <span
                      className={cn(
                        "text-xs",
                        entry.status === "failed" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {runStatusLabel(entry)}
                    </span>
                  )
                }
              />
            );
          })}
        </SettingsSection>
      ) : null}

      <BuildSystemRunDialog
        open={runSystemId !== null}
        initialBuildSystemId={runSystemId}
        buildSystems={buildSystems}
        onOpenChange={(open) => {
          if (!open) setRunSystemId(null);
        }}
        onStart={(input) => {
          void startRun(input).then((started) => {
            setRunSystemId(null);
            if (
              started?.orchestratorThreadId === null ||
              started === null ||
              environmentId === null
            ) {
              return;
            }
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(
                scopeThreadRef(environmentId, started.orchestratorThreadId),
              ),
            });
          });
        }}
      />
    </SettingsPageContainer>
  );
}

function BuildSystemRow({
  buildSystem,
  projectTitle,
  onEdit,
  onRun,
  onDelete,
}: {
  readonly buildSystem: BuildSystem;
  readonly projectTitle: string;
  readonly onEdit: () => void;
  readonly onRun: () => void;
  readonly onDelete: () => void;
}) {
  const roles = [
    `lead: ${buildSystem.orchestrator.modelSelection.model}`,
    ...buildSystem.teammates.map((role) => `${role.name}${role.gate ? " (gated)" : ""}`),
  ].join(" · ");

  return (
    <SettingsRow
      title={buildSystem.name}
      description={`${projectTitle} · ${roles}`}
      control={
        <div className="flex items-center gap-1.5">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Edit ${buildSystem.name}`}
            onClick={onEdit}
          >
            <PencilIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Run ${buildSystem.name}`}
            onClick={onRun}
          >
            <PlayIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Delete ${buildSystem.name}`}
            onClick={onDelete}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      }
    />
  );
}

function BuildSystemDraftForm({
  draft,
  projects,
  onChange,
  onCancel,
  onSave,
}: {
  readonly draft: BuildSystemDraftState;
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly defaultModelSelection: ModelSelection | null;
  }>;
  readonly onChange: (draft: BuildSystemDraftState) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  const selectedProject = projects.find((project) => project.id === draft.projectId);
  const canAddTeammate = draft.teammates.length < BUILD_SYSTEM_MAX_TEAMMATES;

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-muted/10 p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="font-medium text-xs">Name</span>
          <Input
            value={draft.name}
            placeholder="Ship a feature"
            onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })}
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
              <SelectValue>{selectedProject?.title ?? "Choose a project"}</SelectValue>
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
        <span className="font-medium text-xs">Description</span>
        <Input
          value={draft.description}
          placeholder="Optional — shown on the team, not sent to the models."
          onChange={(event) => onChange({ ...draft, description: event.currentTarget.value })}
        />
      </label>

      <div className="space-y-2 rounded-md border border-border/70 p-3">
        <p className="font-medium text-xs">Orchestrator</p>
        <p className="text-muted-foreground text-2xs">
          Leads the run. It does not edit files — it decides who does.
        </p>
        <AutomationModelField
          modelSelection={draft.orchestratorModelSelection}
          projectDefaultModelSelection={selectedProject?.defaultModelSelection ?? null}
          onChange={(modelSelection) =>
            onChange({ ...draft, orchestratorModelSelection: modelSelection })
          }
        />
        <label className="block space-y-1.5">
          <span className="font-medium text-xs">Standing instructions</span>
          <Textarea
            rows={2}
            value={draft.orchestratorInstructions}
            placeholder="Optional extra rules for the lead."
            onChange={(event) =>
              onChange({ ...draft, orchestratorInstructions: event.currentTarget.value })
            }
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-xs">Teammates</p>
          <Button
            size="xs"
            variant="outline"
            disabled={!canAddTeammate}
            onClick={() =>
              onChange({
                ...draft,
                teammates: [
                  ...draft.teammates,
                  emptyRoleDraft(
                    nextRoleDraftKey(draft.teammates),
                    selectedProject?.defaultModelSelection ?? null,
                  ),
                ],
              })
            }
          >
            <PlusIcon className="size-3.5" />
            Add role
          </Button>
        </div>
        {draft.teammates.length === 0 ? (
          <p className="text-muted-foreground text-2xs">
            No teammates — the orchestrator will be told to do the work itself.
          </p>
        ) : null}
        {draft.teammates.map((role, index) => (
          <div key={role.key} className="space-y-2 rounded-md border border-border/70 p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="space-y-1.5">
                <span className="font-medium text-xs">Role name</span>
                <Input
                  value={role.name}
                  placeholder="implementer"
                  onChange={(event) => {
                    const teammates = draft.teammates.slice();
                    teammates[index] = { ...role, name: event.currentTarget.value };
                    onChange({ ...draft, teammates });
                  }}
                />
              </label>
              <div className="flex items-end justify-end gap-2">
                <label className="flex items-center gap-2 pb-2 text-xs">
                  <Switch
                    checked={role.gate}
                    onCheckedChange={(checked) => {
                      const teammates = draft.teammates.slice();
                      teammates[index] = { ...role, gate: Boolean(checked) };
                      onChange({ ...draft, teammates });
                    }}
                  />
                  Ask first
                </label>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove ${role.name || "role"}`}
                  onClick={() =>
                    onChange({
                      ...draft,
                      teammates: draft.teammates.filter((_, roleIndex) => roleIndex !== index),
                    })
                  }
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
            <AutomationModelField
              modelSelection={role.modelSelection}
              projectDefaultModelSelection={selectedProject?.defaultModelSelection ?? null}
              onChange={(modelSelection) => {
                const teammates = draft.teammates.slice();
                teammates[index] = { ...role, modelSelection };
                onChange({ ...draft, teammates });
              }}
            />
            <label className="block space-y-1.5">
              <span className="font-medium text-xs">Role instructions</span>
              <Textarea
                rows={2}
                value={role.instructions}
                placeholder="What this role is for."
                onChange={(event) => {
                  const teammates = draft.teammates.slice();
                  teammates[index] = { ...role, instructions: event.currentTarget.value };
                  onChange({ ...draft, teammates });
                }}
              />
            </label>
          </div>
        ))}
      </div>

      <label className="space-y-1.5">
        <span className="font-medium text-xs">Delegation cap</span>
        <Input
          type="number"
          min={1}
          max={BUILD_SYSTEM_MAX_DELEGATIONS_LIMIT}
          value={draft.maxDelegations}
          onChange={(event) =>
            onChange({ ...draft, maxDelegations: Number(event.currentTarget.value) })
          }
        />
      </label>

      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" disabled={!isBuildSystemDraftComplete(draft)} onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { ChevronDownIcon, FolderPlusIcon, MessageSquareDashedIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useClientSettings } from "~/hooks/useSettings";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  projectGroupsSpanEnvironments,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const NO_PROJECT_VALUE = "no-project";

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);
  const { scratchEnvironmentId, scratchWorkspaceRootFor, openScratchProject } = useScratchProject();

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  // Same-named projects on two machines are only told apart by where they
  // live, so rows on another machine carry its icon once the catalog spans
  // more than one environment; a single-machine catalog stays as it was.
  const showProjectEnvironments = useMemo(
    () => projectGroupsSpanEnvironments(projectGroups),
    [projectGroups],
  );
  const environmentMachineById = useMemo(
    () =>
      new Map(
        environments.map(
          (environment) =>
            [
              environment.environmentId,
              resolveEnvironmentMachineKind(environment.serverConfig),
            ] as const,
        ),
      ),
    [environments],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const activeProject =
    activeProjectRef === null
      ? null
      : (projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        ) ?? null);
  const scratchTargetEnvironmentId = scratchEnvironmentId(
    activeProjectRef?.environmentId ?? primaryEnvironmentId,
  );
  const scratchWorkspaceRoot = scratchWorkspaceRootFor(scratchTargetEnvironmentId);
  const isScratchDraft =
    activeProject !== null && isScratchProject(activeProject, scratchWorkspaceRoot);
  const menuEntries = projectPickerEntries.filter(
    ({ targetProject }) =>
      !isScratchProject(targetProject, scratchWorkspaceRootFor(targetProject.environmentId)),
  );
  const shouldShowProjectMenu = canChooseProject || scratchWorkspaceRoot !== null;

  const latestTargetRef = useRef({ draftId, activeProjectKey, scratchTargetEnvironmentId });
  useEffect(() => {
    latestTargetRef.current = { draftId, activeProjectKey, scratchTargetEnvironmentId };
  }, [draftId, activeProjectKey, scratchTargetEnvironmentId]);

  const selectProject = (project: (typeof projects)[number], logicalProjectKey: string) => {
    if (!draftId) return;
    latestTargetRef.current = {
      draftId,
      activeProjectKey: logicalProjectKey,
      scratchTargetEnvironmentId: project.environmentId,
    };
    const currentDraft = getComposerDraft(draftId);
    setLogicalProjectDraftThreadId(
      logicalProjectKey,
      scopeProjectRef(project.environmentId, project.id),
      draftId,
      isScratchProject(project, scratchWorkspaceRootFor(project.environmentId))
        ? { branch: null, worktreePath: null, envMode: "local", startFromOrigin: false }
        : undefined,
    );
    if (!hasExplicitComposerModelSelection(currentDraft)) {
      applyStickyState(draftId);
      if (project.defaultModelSelection) {
        setModelSelection(draftId, project.defaultModelSelection, { replaceOptions: true });
      }
    }
  };

  const startScratch = async (): Promise<boolean> => {
    if (scratchTargetEnvironmentId === null || isScratchDraft) return false;
    const requested = { draftId, activeProjectKey, scratchTargetEnvironmentId };
    const project = await openScratchProject(scratchTargetEnvironmentId);
    const latest = latestTargetRef.current;
    if (
      !project ||
      latest.draftId !== requested.draftId ||
      latest.activeProjectKey !== requested.activeProjectKey ||
      latest.scratchTargetEnvironmentId !== requested.scratchTargetEnvironmentId
    )
      return false;
    selectProject(project, deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings));
    return true;
  };

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              aria-label={hasResolvedProject ? "Change project" : "Choose a project"}
              data-draft-project-trigger=""
              className="draft-project-picker focus-ring pointer-events-auto inline-flex max-w-72 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium"
            />
          }
        >
          <span className="truncate">
            {isScratchDraft ? "No project" : (activeProjectDisplayName ?? "Choose a project")}
          </span>
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0" />
        </TooltipTrigger>
        {activeProjectDisplayName && !isScratchDraft ? (
          <TooltipPopup side="top" className="max-w-80">
            {activeProjectDisplayName}
          </TooltipPopup>
        ) : null}
      </Tooltip>
      <MenuPopup align="center" className="max-h-80 min-w-40! w-max max-w-64 overflow-y-auto">
        <MenuRadioGroup
          value={isScratchDraft ? NO_PROJECT_VALUE : activeProjectKey}
          onValueChange={(value) => {
            if (value === NO_PROJECT_VALUE) {
              void startScratch();
              return;
            }
            const entry = projectEntryByKey.get(value as string);
            if (!entry || value === activeProjectKey) {
              return;
            }
            selectProject(entry.targetProject, entry.group.projectKey);
          }}
        >
          {scratchWorkspaceRoot === null ? null : (
            <MenuRadioItem value={NO_PROJECT_VALUE} closeOnClick>
              <MessageSquareDashedIcon aria-hidden="true" className="size-4 shrink-0" />
              <span>No project</span>
            </MenuRadioItem>
          )}
          {menuEntries.map(({ group }) => {
            return (
              <MenuRadioItem
                key={group.projectKey}
                value={group.projectKey}
                closeOnClick
                className="[&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
              >
                <ProjectFavicon
                  environmentId={group.environmentId}
                  cwd={group.workspaceRoot}
                  projectName={group.displayName}
                  faviconPath={group.faviconPath}
                  projectIcon={group.projectIcon}
                  className="size-4 shrink-0"
                />
                <Tooltip>
                  <TooltipTrigger render={<span className="block min-w-0 truncate" />}>
                    {group.displayName}
                  </TooltipTrigger>
                  <TooltipPopup side="top" className="max-w-80">
                    {group.displayName}
                  </TooltipPopup>
                </Tooltip>
                {showProjectEnvironments ? (
                  <ProjectEnvironmentBadge
                    group={group}
                    primaryEnvironmentId={primaryEnvironmentId}
                    machineByEnvironmentId={environmentMachineById}
                  />
                ) : null}
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        {menuEntries.length > 0 ? <MenuSeparator /> : null}
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          Add project
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="draft-project-picker focus-ring pointer-events-auto inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium"
    >
      <FolderPlusIcon aria-hidden className="size-3.5" />
      {activeProjectTitle ?? "Add a project"}
    </button>
  );

  return (
    <div className="draft-hero mx-auto flex w-full max-w-3xl flex-col items-center text-center">
      <h1 className="draft-hero-title text-balance">Start a new thread.</h1>
      <p className="draft-hero-description">
        Choose a project and describe what you want to work on.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <span className="text-xs text-muted-foreground">Workspace</span>
        {projectSelector}
      </div>
      {scratchWorkspaceRoot === null ? null : (
        <div className="mt-2 flex h-6 items-center text-xs">
          {!isScratchDraft ? (
            <button
              type="button"
              className="pointer-events-auto text-muted-foreground underline-offset-2 hover:underline"
              onClick={async () => {
                if (await startScratch()) {
                  document.querySelector<HTMLElement>("[data-draft-project-trigger]")?.focus();
                }
              }}
            >
              or start without a project
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

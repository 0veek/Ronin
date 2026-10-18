import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { ChevronDownIcon, FolderPlusIcon, MessageSquareDashedIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useClientSettings } from "~/hooks/useSettings";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import {
  type SidebarProjectPickerEntry,
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
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
  useComboboxFilter,
} from "../ui/combobox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const NO_PROJECT_VALUE = "no-project";
const ADD_PROJECT_VALUE = "add-project";
interface PickerItem {
  readonly value: string;
  readonly label: string;
}

function DraftProjectPicker({
  entries,
  selectedKey,
  includeScratch,
  onSelect,
  children,
  showProjectEnvironments,
  primaryEnvironmentId,
  machineByEnvironmentId,
}: {
  entries: readonly SidebarProjectPickerEntry[];
  selectedKey: string;
  includeScratch: boolean;
  onSelect: (key: string) => void;
  children: ReactNode;
} & Pick<
  ComponentProps<typeof ProjectEnvironmentBadge>,
  "primaryEnvironmentId" | "machineByEnvironmentId"
> & {
    showProjectEnvironments: boolean;
  }) {
  const projectEntryByKey = new Map(entries.map((entry) => [entry.group.projectKey, entry]));
  const pickerItems = useMemo<readonly PickerItem[]>(
    () => [
      ...(!includeScratch ? [] : [{ value: NO_PROJECT_VALUE, label: "No project" }]),
      ...entries.map(({ group }) => ({ value: group.projectKey, label: group.displayName })),
      { value: ADD_PROJECT_VALUE, label: "Add project" },
    ],
    [entries, includeScratch],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerFilter = useComboboxFilter();
  const filteredPickerItems = useMemo(() => {
    const query = pickerQuery.trim();
    if (query.length === 0) return pickerItems;
    return pickerItems.filter(
      (item) =>
        item.value !== ADD_PROJECT_VALUE &&
        pickerFilter.contains(item, query, (candidate) => candidate.label),
    );
  }, [pickerFilter, pickerItems, pickerQuery]);
  const selectedPickerItem = pickerItems.find((item) => item.value === selectedKey) ?? null;

  return (
    <Combobox
      items={pickerItems}
      filteredItems={filteredPickerItems}
      autoHighlight
      itemToStringLabel={(item) => item.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      open={pickerOpen}
      onOpenChange={(open) => {
        setPickerOpen(open);
        setPickerQuery("");
      }}
      value={selectedPickerItem}
      onValueChange={(item) => {
        if (!item) return;
        setPickerOpen(false);
        onSelect(item.value);
      }}
    >
      {children}
      <ComboboxPopup align="center" className="w-72 overflow-hidden">
        <ComboboxSearchInput
          aria-label="Search projects"
          placeholder="Search projects..."
          value={pickerQuery}
          onChange={(event) => setPickerQuery(event.target.value)}
        />
        <ComboboxEmpty>No matching projects.</ComboboxEmpty>
        <ComboboxList>
          {(item: PickerItem) => {
            const entry = projectEntryByKey.get(item.value);
            return (
              <ComboboxItem key={item.value} hideIndicator value={item}>
                {item.value === ADD_PROJECT_VALUE ? (
                  <FolderPlusIcon className="size-4 shrink-0" />
                ) : item.value === NO_PROJECT_VALUE ? (
                  <MessageSquareDashedIcon className="size-4 shrink-0" />
                ) : entry ? (
                  <ProjectFavicon
                    environmentId={entry.group.environmentId}
                    cwd={entry.group.workspaceRoot}
                    projectName={entry.group.displayName}
                    faviconPath={entry.group.faviconPath}
                    projectIcon={entry.group.projectIcon}
                    className="size-4 shrink-0"
                  />
                ) : null}
                <Tooltip>
                  <TooltipTrigger render={<span className="min-w-0 flex-1 truncate text-sm" />}>
                    {item.label}
                  </TooltipTrigger>
                  <TooltipPopup side="top">{item.label}</TooltipPopup>
                </Tooltip>
                {entry && showProjectEnvironments ? (
                  <ProjectEnvironmentBadge
                    group={entry.group}
                    primaryEnvironmentId={primaryEnvironmentId}
                    machineByEnvironmentId={machineByEnvironmentId}
                  />
                ) : null}
              </ComboboxItem>
            );
          }}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

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
  const menuEntries = useMemo(
    () =>
      projectPickerEntries.filter(
        ({ targetProject }) =>
          !isScratchProject(targetProject, scratchWorkspaceRootFor(targetProject.environmentId)),
      ),
    [projectPickerEntries, scratchWorkspaceRootFor],
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
    <DraftProjectPicker
      entries={menuEntries}
      selectedKey={isScratchDraft ? NO_PROJECT_VALUE : activeProjectKey}
      includeScratch={scratchWorkspaceRoot !== null}
      showProjectEnvironments={showProjectEnvironments}
      primaryEnvironmentId={primaryEnvironmentId}
      machineByEnvironmentId={environmentMachineById}
      onSelect={(value) => {
        if (value === ADD_PROJECT_VALUE) {
          openAddProject();
          return;
        }
        if (value === NO_PROJECT_VALUE) {
          void startScratch();
          return;
        }
        const entry = projectEntryByKey.get(value);
        if (entry && value !== activeProjectKey) selectProject(entry.targetProject, value);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
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
    </DraftProjectPicker>
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

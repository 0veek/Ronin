/**
 * The editable shape of a build system.
 *
 * The form works on a draft because a teammate is several fields that only
 * have to be a real role at save time. Until then the Save button stays off.
 *
 * @module buildSystemDraft
 */
import type {
  BuildSystem,
  BuildSystemCreateInput,
  BuildSystemId,
  BuildSystemUpdateInput,
  ModelSelection,
  ProjectId,
} from "@t3tools/contracts";
import {
  BUILD_SYSTEM_MAX_TEAMMATES,
  DEFAULT_BUILD_SYSTEM_MAX_DELEGATIONS,
  duplicateBuildSystemRoleNames,
} from "@t3tools/contracts";

export interface BuildSystemRoleDraft {
  readonly key: string;
  readonly id?: string;
  readonly name: string;
  readonly instructions: string;
  readonly modelSelection: ModelSelection | null;
  readonly gate: boolean;
}

export interface BuildSystemDraftState {
  readonly editing: BuildSystemId | null;
  readonly projectId: string;
  readonly name: string;
  readonly description: string;
  readonly orchestratorModelSelection: ModelSelection | null;
  readonly orchestratorInstructions: string;
  readonly teammates: ReadonlyArray<BuildSystemRoleDraft>;
  readonly maxDelegations: number;
}

export const EMPTY_BUILD_SYSTEM_DRAFT: BuildSystemDraftState = {
  editing: null,
  projectId: "",
  name: "",
  description: "",
  orchestratorModelSelection: null,
  orchestratorInstructions: "",
  teammates: [],
  maxDelegations: DEFAULT_BUILD_SYSTEM_MAX_DELEGATIONS,
};

export interface BuildSystemsSearch {
  readonly create?: boolean;
  readonly projectId?: string;
}

function isTruthySearchFlag(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

export function parseBuildSystemsSearch(raw: Record<string, unknown>): BuildSystemsSearch {
  return {
    ...(isTruthySearchFlag(raw.create) ? { create: true } : {}),
    ...(typeof raw.projectId === "string" && raw.projectId.length > 0
      ? { projectId: raw.projectId }
      : {}),
  };
}

export function createBuildSystemSearch(projectId?: string | null): BuildSystemsSearch {
  return {
    create: true,
    ...(projectId ? { projectId } : {}),
  };
}

export function emptyRoleDraft(
  key: string,
  modelSelection: ModelSelection | null = null,
): BuildSystemRoleDraft {
  return {
    key,
    name: "",
    instructions: "",
    modelSelection,
    gate: false,
  };
}

export function draftFromBuildSystem(buildSystem: BuildSystem): BuildSystemDraftState {
  return {
    editing: buildSystem.id,
    projectId: String(buildSystem.projectId),
    name: buildSystem.name,
    description: buildSystem.description ?? "",
    orchestratorModelSelection: buildSystem.orchestrator.modelSelection,
    orchestratorInstructions: buildSystem.orchestrator.instructions ?? "",
    teammates: buildSystem.teammates.map((role) => ({
      key: role.id,
      id: role.id,
      name: role.name,
      instructions: role.instructions ?? "",
      modelSelection: role.modelSelection,
      gate: role.gate,
    })),
    maxDelegations: buildSystem.maxDelegations,
  };
}

export function startBuildSystemDraft(projectId = ""): BuildSystemDraftState {
  return { ...EMPTY_BUILD_SYSTEM_DRAFT, projectId };
}

export function startBuildSystemDraftFromSearch(
  search: BuildSystemsSearch,
  projectIds: ReadonlyArray<string>,
): BuildSystemDraftState | null {
  if (search.create !== true) return null;
  const requested = search.projectId ?? "";
  const projectId = requested.length > 0 ? requested : (projectIds[0] ?? "");
  return startBuildSystemDraft(projectId);
}

export function isBuildSystemDraftComplete(draft: BuildSystemDraftState): boolean {
  if (draft.projectId.length === 0) return false;
  if (draft.name.trim().length === 0) return false;
  if (draft.orchestratorModelSelection === null) return false;
  if (draft.teammates.length > BUILD_SYSTEM_MAX_TEAMMATES) return false;
  if (duplicateBuildSystemRoleNames(draft.teammates).length > 0) return false;
  for (const role of draft.teammates) {
    if (role.name.trim().length === 0) return false;
    if (role.modelSelection === null) return false;
  }
  return Number.isInteger(draft.maxDelegations) && draft.maxDelegations >= 1;
}

export function draftToCreateInput(draft: BuildSystemDraftState): BuildSystemCreateInput | null {
  if (!isBuildSystemDraftComplete(draft) || draft.orchestratorModelSelection === null) {
    return null;
  }
  return {
    projectId: draft.projectId as ProjectId,
    name: draft.name.trim(),
    description: draft.description.trim().length === 0 ? null : draft.description.trim(),
    orchestrator: {
      modelSelection: draft.orchestratorModelSelection,
      instructions:
        draft.orchestratorInstructions.trim().length === 0
          ? null
          : draft.orchestratorInstructions.trim(),
    },
    teammates: draft.teammates.map((role) => ({
      ...(role.id === undefined ? {} : { id: role.id as never }),
      name: role.name.trim(),
      instructions: role.instructions.trim().length === 0 ? null : role.instructions.trim(),
      modelSelection: role.modelSelection!,
      gate: role.gate,
    })),
    maxDelegations: draft.maxDelegations,
  };
}

export function draftToUpdateInput(draft: BuildSystemDraftState): BuildSystemUpdateInput | null {
  if (draft.editing === null) return null;
  const created = draftToCreateInput(draft);
  if (created === null) return null;
  return {
    id: draft.editing,
    name: created.name,
    description: created.description,
    orchestrator: created.orchestrator,
    teammates: created.teammates,
    maxDelegations: created.maxDelegations,
  };
}

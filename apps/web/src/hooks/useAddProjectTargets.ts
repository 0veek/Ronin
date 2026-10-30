import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthSourceControlWriteScope, resolveEnvironmentMachineKind } from "@t3tools/contracts";

import type { EnvironmentOption } from "../components/BranchToolbar.logic";
import { useEnvironments } from "../state/environments";
import { useEnvironmentsWithScope } from "../state/session";
import { useProjects } from "../state/entities";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { useClientSettings } from "./useSettings";

export type AddProjectTarget = Pick<EnvironmentOption, "environmentId" | "label" | "machine">;

/**
 * Connected machines that do not have the project yet and can clone it.
 * Uses the same project grouping as Run on. Projects without a git remote get none.
 */
export function useAddProjectTargets(
  project: EnvironmentProject | null,
  projectEnvironments?: readonly Pick<EnvironmentOption, "environmentId">[],
): readonly AddProjectTarget[] {
  const { environments } = useEnvironments();
  const projects = useProjects();
  const grouping = useClientSettings(selectProjectGroupingSettings);
  const canClone = useEnvironmentsWithScope(environments, AuthSourceControlWriteScope);
  if (!project?.repositoryIdentity?.locator.remoteUrl) return [];
  const hasProject = new Set([
    project.environmentId,
    ...(
      projectEnvironments ??
      projects.filter(
        (candidate) =>
          deriveLogicalProjectKeyFromSettings(candidate, grouping) ===
          deriveLogicalProjectKeyFromSettings(project, grouping),
      )
    ).map((env) => env.environmentId),
  ]);
  return environments
    .filter(
      (environment) =>
        !hasProject.has(environment.environmentId) &&
        canClone.has(environment.environmentId) &&
        canCreateProjectInEnvironment(environment.connection.phase) &&
        environment.serverConfig?.environment.capabilities.projectCloneTracking === true,
    )
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      machine: resolveEnvironmentMachineKind(environment.serverConfig),
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

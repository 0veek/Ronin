import type { ProjectId, ServerSettings } from "@t3tools/contracts";

export function resolveProjectSettings(settings: ServerSettings, _projectId: ProjectId) {
  return { settings };
}

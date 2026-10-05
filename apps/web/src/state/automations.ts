/**
 * Scheduled work, read from and written to the selected environment.
 * Its projects, scheduler clock, models, and run history all belong to that machine.
 *
 * @module state/automations
 */
import type {
  Automation,
  AutomationCreateInput,
  AutomationId,
  AutomationRun,
  AutomationUpdateInput,
  EnvironmentId,
} from "@t3tools/contracts";
import { useCallback } from "react";

import { useEnvironmentQuery } from "./query";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

const EMPTY_AUTOMATIONS: ReadonlyArray<Automation> = [];
const EMPTY_RUNS: ReadonlyArray<AutomationRun> = [];

export interface AutomationsController {
  readonly environmentId: EnvironmentId;
  readonly automations: ReadonlyArray<Automation>;
  readonly runs: ReadonlyArray<AutomationRun>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly create: (input: AutomationCreateInput) => Promise<boolean>;
  readonly update: (input: AutomationUpdateInput) => Promise<boolean>;
  readonly remove: (id: AutomationId) => Promise<void>;
  readonly runNow: (id: AutomationId) => Promise<void>;
}

/**
 * Everything the Automations page needs.
 *
 * Mutations refresh server-owned data rather than mutating a local copy: the
 * server owns `nextRunAt`, and a locally-guessed next run would be wrong the
 * moment a schedule changed — which is exactly when the user is looking at it.
 * Running or deleting an automation also refreshes its run history.
 */
export function useAutomations(environmentId: EnvironmentId): AutomationsController {
  const automationsQuery = useEnvironmentQuery(
    serverEnvironment.automations({ environmentId, input: {} }),
  );
  const runsQuery = useEnvironmentQuery(
    serverEnvironment.automationRuns({ environmentId, input: {} }),
  );
  const refreshAutomations = automationsQuery.refresh;
  const refreshRuns = runsQuery.refresh;

  const createCommand = useAtomCommand(serverEnvironment.createAutomation, "automation create");
  const updateCommand = useAtomCommand(serverEnvironment.updateAutomation, "automation update");
  const deleteCommand = useAtomCommand(serverEnvironment.deleteAutomation, "automation delete");
  const runNowCommand = useAtomCommand(serverEnvironment.runAutomationNow, "automation run now");

  const create = useCallback(
    async (input: AutomationCreateInput) => {
      const result = await createCommand({ environmentId, input });
      if (result._tag !== "Success") return false;
      refreshAutomations();
      return true;
    },
    [createCommand, environmentId, refreshAutomations],
  );

  const update = useCallback(
    async (input: AutomationUpdateInput) => {
      const result = await updateCommand({ environmentId, input });
      if (result._tag !== "Success") return false;
      refreshAutomations();
      return true;
    },
    [environmentId, refreshAutomations, updateCommand],
  );

  const remove = useCallback(
    async (id: AutomationId) => {
      await deleteCommand({ environmentId, input: { id } });
      refreshAutomations();
      // Deleting an automation drops its runs too, so the history has to
      // re-read or it keeps showing rows for something that no longer exists.
      refreshRuns();
    },
    [deleteCommand, environmentId, refreshAutomations, refreshRuns],
  );

  const runNow = useCallback(
    async (id: AutomationId) => {
      await runNowCommand({ environmentId, input: { id } });
      refreshAutomations();
      refreshRuns();
    },
    [environmentId, refreshAutomations, refreshRuns, runNowCommand],
  );

  const refresh = useCallback(() => {
    refreshAutomations();
    refreshRuns();
  }, [refreshAutomations, refreshRuns]);

  return {
    environmentId,
    automations: automationsQuery.data?.automations ?? EMPTY_AUTOMATIONS,
    runs: runsQuery.data?.runs ?? EMPTY_RUNS,
    isLoading: automationsQuery.data === null && automationsQuery.error === null,
    error: automationsQuery.error ?? runsQuery.error,
    refresh,
    create,
    update,
    remove,
    runNow,
  };
}

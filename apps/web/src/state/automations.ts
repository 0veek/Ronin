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
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useContext } from "react";

import { useEnvironmentQuery } from "./query";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

const EMPTY_AUTOMATIONS: ReadonlyArray<Automation> = [];
const EMPTY_RUNS: ReadonlyArray<AutomationRun> = [];
const EMPTY_PENDING_AUTOMATIONS: ReadonlySet<AutomationId> = new Set();
const pendingAutomationsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(EMPTY_PENDING_AUTOMATIONS).pipe(
    Atom.keepAlive,
    Atom.withLabel(`automation-pending:${environmentId}`),
  ),
);

export interface AutomationsController {
  readonly environmentId: EnvironmentId;
  readonly automations: ReadonlyArray<Automation>;
  readonly runs: ReadonlyArray<AutomationRun>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly pendingAutomationIds: ReadonlySet<AutomationId>;
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
  const { pendingAutomationIds, runMutation } = useAutomationMutationGuard(environmentId);

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
      return runMutation(input.id, async () => {
        const result = await updateCommand({ environmentId, input });
        if (result._tag !== "Success") return false;
        refreshAutomations();
        return true;
      });
    },
    [environmentId, refreshAutomations, runMutation, updateCommand],
  );

  const remove = useCallback(
    async (id: AutomationId) => {
      await runMutation(id, async () => {
        const result = await deleteCommand({ environmentId, input: { id } });
        if (result._tag !== "Success") return false;
        refreshAutomations();
        // Deleting an automation drops its runs too, so the history has to
        // re-read or it keeps showing rows for something that no longer exists.
        refreshRuns();
        return true;
      });
    },
    [deleteCommand, environmentId, refreshAutomations, refreshRuns, runMutation],
  );

  const runNow = useCallback(
    async (id: AutomationId) => {
      await runMutation(id, async () => {
        const result = await runNowCommand({ environmentId, input: { id } });
        if (result._tag !== "Success") return false;
        refreshAutomations();
        refreshRuns();
        return true;
      });
    },
    [environmentId, refreshAutomations, refreshRuns, runMutation, runNowCommand],
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
    pendingAutomationIds,
    refresh,
    create,
    update,
    remove,
    runNow,
  };
}

/** Suppress repeated or conflicting actions on one automation while its request is pending. */
function useAutomationMutationGuard(environmentId: EnvironmentId) {
  const registry = useContext(RegistryContext);
  const pendingAtom = pendingAutomationsAtom(environmentId);
  const pendingAutomationIds = useAtomValue(pendingAtom);
  const runMutation = useCallback(
    async (id: AutomationId, action: () => Promise<boolean>) => {
      const pending = registry.get(pendingAtom);
      if (pending.has(id)) return false;
      registry.set(pendingAtom, new Set([...pending, id]));
      return Promise.resolve()
        .then(action)
        .finally(() => {
          const remaining = new Set(registry.get(pendingAtom));
          remaining.delete(id);
          registry.set(pendingAtom, remaining.size === 0 ? EMPTY_PENDING_AUTOMATIONS : remaining);
        });
    },
    [pendingAtom, registry],
  );
  return { pendingAutomationIds, runMutation };
}

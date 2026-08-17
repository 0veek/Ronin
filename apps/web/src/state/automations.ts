/**
 * Scheduled work, read from and written to the primary environment.
 *
 * Scoped to the primary environment for the same reason quota is: the
 * scheduler runs on one machine's clock against one machine's projects, and a
 * merged list would offer to edit schedules the local server does not own.
 *
 * @module state/automations
 */
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type {
  Automation,
  AutomationCreateInput,
  AutomationId,
  AutomationRun,
  AutomationUpdateInput,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useCallback } from "react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { usePrimaryEnvironmentId } from "./environments";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

const EMPTY_AUTOMATIONS: ReadonlyArray<Automation> = [];
const EMPTY_RUNS: ReadonlyArray<AutomationRun> = [];

const automationsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<Automation> => {
    const result = get(serverEnvironment.automations({ environmentId, input: {} }));
    return Option.getOrNull(AsyncResult.value(result))?.automations ?? EMPTY_AUTOMATIONS;
  }).pipe(Atom.withLabel(`web-automations:${environmentId}`)),
);

const runsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<AutomationRun> => {
    const result = get(serverEnvironment.automationRuns({ environmentId, input: {} }));
    return Option.getOrNull(AsyncResult.value(result))?.runs ?? EMPTY_RUNS;
  }).pipe(Atom.withLabel(`web-automation-runs:${environmentId}`)),
);

const emptyAutomationsAtom = Atom.make((): ReadonlyArray<Automation> => EMPTY_AUTOMATIONS).pipe(
  Atom.withLabel("web-automations:none"),
);
const emptyRunsAtom = Atom.make((): ReadonlyArray<AutomationRun> => EMPTY_RUNS).pipe(
  Atom.withLabel("web-automation-runs:none"),
);

export interface AutomationsController {
  readonly environmentId: EnvironmentId | null;
  readonly automations: ReadonlyArray<Automation>;
  readonly runs: ReadonlyArray<AutomationRun>;
  readonly create: (input: Omit<AutomationCreateInput, never>) => Promise<void>;
  readonly update: (input: AutomationUpdateInput) => Promise<void>;
  readonly remove: (id: AutomationId) => Promise<void>;
  readonly runNow: (id: AutomationId) => Promise<void>;
}

/**
 * Everything the Automations page needs.
 *
 * Every mutation refreshes both lists rather than mutating a local copy: the
 * server owns `nextRunAt`, and a locally-guessed next run would be wrong the
 * moment a schedule changed — which is exactly when the user is looking at it.
 */
export function useAutomations(): AutomationsController {
  const environmentId = usePrimaryEnvironmentId();
  const automations = useAtomValue(
    environmentId === null ? emptyAutomationsAtom : automationsAtom(environmentId),
  );
  const runs = useAtomValue(environmentId === null ? emptyRunsAtom : runsAtom(environmentId));
  const refreshAutomations = useAtomRefresh(
    environmentId === null ? emptyAutomationsAtom : automationsAtom(environmentId),
  );
  const refreshRuns = useAtomRefresh(
    environmentId === null ? emptyRunsAtom : runsAtom(environmentId),
  );

  const createCommand = useAtomCommand(serverEnvironment.createAutomation, "automation create");
  const updateCommand = useAtomCommand(serverEnvironment.updateAutomation, "automation update");
  const deleteCommand = useAtomCommand(serverEnvironment.deleteAutomation, "automation delete");
  const runNowCommand = useAtomCommand(serverEnvironment.runAutomationNow, "automation run now");

  const create = useCallback(
    async (input: AutomationCreateInput) => {
      if (environmentId === null) return;
      await createCommand({ environmentId, input });
      refreshAutomations();
    },
    [createCommand, environmentId, refreshAutomations],
  );

  const update = useCallback(
    async (input: AutomationUpdateInput) => {
      if (environmentId === null) return;
      await updateCommand({ environmentId, input });
      refreshAutomations();
    },
    [environmentId, refreshAutomations, updateCommand],
  );

  const remove = useCallback(
    async (id: AutomationId) => {
      if (environmentId === null) return;
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
      if (environmentId === null) return;
      await runNowCommand({ environmentId, input: { id } });
      refreshAutomations();
      refreshRuns();
    },
    [environmentId, refreshAutomations, refreshRuns, runNowCommand],
  );

  return { environmentId, automations, runs, create, update, remove, runNow };
}

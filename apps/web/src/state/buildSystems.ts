/**
 * Per-project teams of models, read from and written to the primary environment.
 *
 * Scoped to the primary environment for the same reason automations are: a
 * team runs on one machine's providers against one machine's checkouts, and
 * a merged list would offer to edit teams another server does not own.
 *
 * @module state/buildSystems
 */
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type {
  BuildSystem,
  BuildSystemCreateInput,
  BuildSystemId,
  BuildSystemRun,
  BuildSystemRunId,
  BuildSystemUpdateInput,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { isBuildSystemRunActive } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useCallback, useContext } from "react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { usePrimaryEnvironmentId } from "./environments";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

const EMPTY_SYSTEMS: ReadonlyArray<BuildSystem> = [];
const EMPTY_RUNS: ReadonlyArray<BuildSystemRun> = [];
const buildSystemsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<BuildSystem> => {
    const result = get(serverEnvironment.buildSystems({ environmentId, input: {} }));
    return Option.getOrNull(AsyncResult.value(result))?.buildSystems ?? EMPTY_SYSTEMS;
  }).pipe(Atom.withLabel(`web-build-systems:${environmentId}`)),
);

const runsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<BuildSystemRun> => {
    const result = get(serverEnvironment.buildSystemRuns({ environmentId, input: {} }));
    return Option.getOrNull(AsyncResult.value(result))?.runs ?? EMPTY_RUNS;
  }).pipe(Atom.withLabel(`web-build-system-runs:${environmentId}`)),
);

const emptySystemsAtom = Atom.make((): ReadonlyArray<BuildSystem> => EMPTY_SYSTEMS).pipe(
  Atom.withLabel("web-build-systems:none"),
);
const emptyRunsAtom = Atom.make((): ReadonlyArray<BuildSystemRun> => EMPTY_RUNS).pipe(
  Atom.withLabel("web-build-system-runs:none"),
);

export function findBuildSystemRunForThread(
  runs: ReadonlyArray<BuildSystemRun>,
  threadId: ThreadId | string | null | undefined,
): BuildSystemRun | null {
  if (threadId === null || threadId === undefined) return null;
  return (
    runs.find(
      (run) =>
        run.orchestratorThreadId === threadId ||
        run.roleThreads.some((entry) => entry.threadId === threadId),
    ) ?? null
  );
}

export function buildSystemTeammateThreadIds(
  runs: ReadonlyArray<BuildSystemRun>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const run of runs) {
    if (!isBuildSystemRunActive(run.status)) continue;
    for (const entry of run.roleThreads) ids.add(entry.threadId);
  }
  return ids;
}

export function isBuildSystemThreadAwaitingUser(
  runs: ReadonlyArray<BuildSystemRun>,
  threadId: string,
): boolean {
  return runs.some(
    (run) =>
      (run.status === "waiting-gate" || run.status === "waiting-user") &&
      run.orchestratorThreadId === threadId,
  );
}

export interface BuildSystemsController {
  readonly environmentId: EnvironmentId | null;
  readonly buildSystems: ReadonlyArray<BuildSystem>;
  readonly runs: ReadonlyArray<BuildSystemRun>;
  readonly create: (input: BuildSystemCreateInput) => Promise<boolean>;
  readonly update: (input: BuildSystemUpdateInput) => Promise<boolean>;
  readonly remove: (id: BuildSystemId) => Promise<void>;
  readonly startRun: (input: {
    readonly buildSystemId: BuildSystemId;
    readonly task: string;
  }) => Promise<BuildSystemRun | null>;
  readonly cancelRun: (runId: BuildSystemRunId) => Promise<void>;
  readonly resolveGate: (input: {
    readonly runId: BuildSystemRunId;
    readonly approved: boolean;
    readonly note?: string | null;
  }) => Promise<void>;
  readonly replyUser: (input: {
    readonly runId: BuildSystemRunId;
    readonly reply: string;
  }) => Promise<void>;
}

export function useBuildSystems(): BuildSystemsController {
  const environmentId = usePrimaryEnvironmentId();
  const buildSystems = useAtomValue(
    environmentId === null ? emptySystemsAtom : buildSystemsAtom(environmentId),
  );
  const runs = useAtomValue(environmentId === null ? emptyRunsAtom : runsAtom(environmentId));
  const registry = useContext(RegistryContext);
  // Refresh the RPC query atoms, not the derived views. The list is SWR-cached
  // for 10s; invalidating only the derived atom re-reads that still-fresh empty
  // result and the save looks like it vanished.
  const refresh = useCallback(() => {
    if (environmentId === null) return;
    registry.refresh(serverEnvironment.buildSystems({ environmentId, input: {} }));
    registry.refresh(serverEnvironment.buildSystemRuns({ environmentId, input: {} }));
  }, [environmentId, registry]);

  const createCommand = useAtomCommand(serverEnvironment.createBuildSystem, "build system create");
  const updateCommand = useAtomCommand(serverEnvironment.updateBuildSystem, "build system update");
  const deleteCommand = useAtomCommand(serverEnvironment.deleteBuildSystem, "build system delete");
  const startCommand = useAtomCommand(serverEnvironment.startBuildSystemRun, "build system start");
  const cancelCommand = useAtomCommand(
    serverEnvironment.cancelBuildSystemRun,
    "build system cancel",
  );
  const gateCommand = useAtomCommand(
    serverEnvironment.resolveBuildSystemGate,
    "build system resolve gate",
  );
  const replyCommand = useAtomCommand(serverEnvironment.replyBuildSystemRun, "build system reply");

  const create = useCallback(
    async (input: BuildSystemCreateInput) => {
      if (environmentId === null) return false;
      const result = await createCommand({ environmentId, input });
      if (result._tag !== "Success") return false;
      refresh();
      return true;
    },
    [createCommand, environmentId, refresh],
  );

  const update = useCallback(
    async (input: BuildSystemUpdateInput) => {
      if (environmentId === null) return false;
      const result = await updateCommand({ environmentId, input });
      if (result._tag !== "Success") return false;
      refresh();
      return true;
    },
    [environmentId, refresh, updateCommand],
  );

  const remove = useCallback(
    async (id: BuildSystemId) => {
      if (environmentId === null) return;
      await deleteCommand({ environmentId, input: { id } });
      refresh();
    },
    [deleteCommand, environmentId, refresh],
  );

  const startRun = useCallback(
    async (input: { buildSystemId: BuildSystemId; task: string }) => {
      if (environmentId === null) return null;
      const result = await startCommand({ environmentId, input });
      refresh();
      return result._tag === "Success" ? result.value.run : null;
    },
    [environmentId, refresh, startCommand],
  );

  const cancelRun = useCallback(
    async (runId: BuildSystemRunId) => {
      if (environmentId === null) return;
      await cancelCommand({ environmentId, input: { runId } });
      refresh();
    },
    [cancelCommand, environmentId, refresh],
  );

  const resolveGate = useCallback(
    async (input: { runId: BuildSystemRunId; approved: boolean; note?: string | null }) => {
      if (environmentId === null) return;
      await gateCommand({ environmentId, input });
      refresh();
    },
    [environmentId, gateCommand, refresh],
  );

  const replyUser = useCallback(
    async (input: { runId: BuildSystemRunId; reply: string }) => {
      if (environmentId === null) return;
      await replyCommand({ environmentId, input });
      refresh();
    },
    [environmentId, refresh, replyCommand],
  );

  return {
    environmentId,
    buildSystems,
    runs,
    create,
    update,
    remove,
    startRun,
    cancelRun,
    resolveGate,
    replyUser,
  };
}

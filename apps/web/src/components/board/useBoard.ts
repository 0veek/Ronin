import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ChangeRequestSettleSource } from "@t3tools/client-runtime/state/thread-settled";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useMemo, useState } from "react";

import { boardDraftOrderScopeKey, useBoardUiStore } from "../../boardUiStore";
import { useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { selectProjectGroupingSettings } from "../../logicalProject";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useProjects, useServerConfigs, useThreadShells } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import type { SidebarThreadSummary } from "../../types";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import { threadChangeRequestSnapshotsAtom } from "../ThreadStatusIndicators";
import {
  buildBoard,
  type Board,
  type BoardClassifyContext,
  type BoardEnvironmentCapabilities,
} from "./board.logic";

export interface BoardData {
  readonly board: Board;
  readonly context: BoardClassifyContext;
  /** Project groups for the scope picker, in the sidebar's own order. */
  readonly projectGroups: readonly SidebarProjectSnapshot[];
  readonly scopedProjectGroup: SidebarProjectSnapshot | null;
  /** Workspace root per `environmentId:projectId`, for card favicons. */
  readonly projectCwdByKey: ReadonlyMap<string, string>;
  readonly projectFaviconPathByKey: ReadonlyMap<string, string | null | undefined>;
  readonly projectDisplayNameByKey: ReadonlyMap<string, string>;
  readonly draftOrderScopeKey: string;
}

/**
 * Everything the board renders from, derived once. The lane math itself lives
 * in board.logic; this hook only projects app state into its inputs and keeps
 * the result memoized so composer churn and unrelated store writes don't
 * rebuild six lanes of cards.
 */
export function useBoard(scopeKey: string | null, onScopeUnavailable: () => void): BoardData {
  const threads = useThreadShells();
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const sidebarProjectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const autoSettleAfterDays = useClientSettings((settings) => settings.sidebarAutoSettleAfterDays);
  const autoSettleMode = useClientSettings((settings) => settings.sidebarAutoSettleMode);
  const changeRequestSnapshotByKey = useAtomValue(threadChangeRequestSnapshotsAtom);
  const draftOrderByScopeKey = useBoardUiStore((state) => state.draftOrderByScopeKey);
  const pruneDraftOrders = useBoardUiStore((state) => state.pruneDraftOrders);

  // Quantized to the minute so the settle window's memo doesn't churn every
  // render; auto-settle thresholds are day-granular anyway.
  const nowMinute = useNowMinute();
  // A plain counter bumped exactly when the next snoozed thread is due back,
  // so a wake lands on the second rather than on the next minute boundary.
  const [snoozeWakeTick, setSnoozeWakeTick] = useState(0);

  const nextSnoozeWakeAtMs = useMemo(() => {
    let earliest = Number.POSITIVE_INFINITY;
    const nowMs = Date.now();
    for (const thread of threads) {
      if (thread.snoozedUntil == null) continue;
      const wakeMs = Date.parse(thread.snoozedUntil);
      if (Number.isNaN(wakeMs) || wakeMs <= nowMs) continue;
      if (wakeMs < earliest) earliest = wakeMs;
    }
    return Number.isFinite(earliest) ? earliest : null;
  }, [threads]);

  useEffect(() => {
    if (nextSnoozeWakeAtMs === null) return;
    // Clamped so a far-future wake doesn't overflow setTimeout's 32-bit delay
    // (it would fire immediately and spin); the minute tick covers the gap.
    const delay = Math.min(Math.max(nextSnoozeWakeAtMs - Date.now(), 0) + 250, 60_000);
    const id = window.setTimeout(() => setSnoozeWakeTick((tick) => tick + 1), delay);
    return () => window.clearTimeout(id);
  }, [nextSnoozeWakeAtMs, snoozeWakeTick]);

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
        sidebarProjectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projects,
      sidebarProjectSortOrder,
      threads,
    ],
  );

  const scopedProjectGroup = useMemo(
    () =>
      scopeKey === null
        ? null
        : (projectGroups.find((group) => group.projectKey === scopeKey) ?? null),
    [projectGroups, scopeKey],
  );

  // A project that disappeared (removed, or regrouped away) must not leave the
  // board scoped to nothing. Only once groups exist, so first paint doesn't
  // clear a valid scope before projects have loaded.
  useEffect(() => {
    if (scopeKey !== null && scopedProjectGroup === null && projectGroups.length > 0) {
      onScopeUnavailable();
    }
  }, [onScopeUnavailable, projectGroups.length, scopeKey, scopedProjectGroup]);

  const scopedProjectKeys = useMemo(
    () =>
      scopedProjectGroup === null
        ? null
        : new Set(
            scopedProjectGroup.memberProjectRefs.map(
              (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
            ),
          ),
    [scopedProjectGroup],
  );

  const capabilitiesByEnvironmentId = useMemo(() => {
    const capabilities = new Map<string, BoardEnvironmentCapabilities>();
    for (const [environmentId, config] of serverConfigs) {
      capabilities.set(environmentId, {
        settlement: config.environment.capabilities.threadSettlement === true,
        snooze: config.environment.capabilities.threadSnooze === true,
      });
    }
    return capabilities;
  }, [serverConfigs]);

  const changeRequestByThreadKey = useMemo(() => {
    const states = new Map<string, ChangeRequestSettleSource | null>();
    const threadByKey = new Map(
      threads.map((thread) => [
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        thread,
      ]),
    );
    for (const [threadKey, snapshot] of changeRequestSnapshotByKey) {
      const thread = threadByKey.get(threadKey);
      if (!thread) continue;
      // Same guard the sidebar applies: a worktree thread only inherits a PR
      // snapshot recorded for the branch it is actually on. Without this a
      // stale merged-PR snapshot auto-settles work that is still live.
      const applies = thread.worktreePath === null || snapshot.branch === thread.branch;
      states.set(threadKey, applies ? snapshot.pr : null);
    }
    return states;
  }, [changeRequestSnapshotByKey, threads]);

  const context = useMemo(
    (): BoardClassifyContext => ({
      now: `${nowMinute}:00.000Z`,
      // Snooze wake times are second-precise, so the quantized minute would
      // hold a woken thread on the shelf for up to a minute. snoozeWakeTick
      // (armed below at the exact next boundary) re-runs this memo on time.
      preciseNow: new Date().toISOString(),
      autoSettleAfterDays,
      autoSettleMode,
      capabilitiesByEnvironmentId,
      changeRequestByThreadKey,
    }),
    [
      autoSettleAfterDays,
      autoSettleMode,
      capabilitiesByEnvironmentId,
      changeRequestByThreadKey,
      nowMinute,
      snoozeWakeTick,
    ],
  );

  const draftOrderScopeKey = boardDraftOrderScopeKey(scopeKey);
  const draftOrder = draftOrderByScopeKey[draftOrderScopeKey];

  const board = useMemo(
    () =>
      buildBoard({
        threads,
        context,
        threadKeyOf: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ...(scopedProjectKeys
          ? {
              includeThread: (thread: SidebarThreadSummary) =>
                scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`),
            }
          : {}),
        ...(draftOrder ? { draftOrder } : {}),
      }),
    [context, draftOrder, scopedProjectKeys, threads],
  );

  // A project the user removed should not keep its manual draft order in
  // localStorage forever.
  useEffect(() => {
    const known = new Set<string>(["all", ...projectGroups.map((group) => group.projectKey)]);
    pruneDraftOrders(known);
  }, [projectGroups, pruneDraftOrders]);

  const projectCwdByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          `${project.environmentId}:${project.id}`,
          project.workspaceRoot,
        ]),
      ),
    [projects],
  );

  const projectFaviconPathByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [`${project.environmentId}:${project.id}`, project.faviconPath]),
      ),
    [projects],
  );

  const projectDisplayNameByKey = useMemo(
    () =>
      new Map(
        projectGroups.flatMap((group) =>
          group.memberProjects.map(
            (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
          ),
        ),
      ),
    [projectGroups],
  );

  return {
    board,
    context,
    projectGroups,
    scopedProjectGroup,
    projectCwdByKey,
    projectFaviconPathByKey,
    projectDisplayNameByKey,
    draftOrderScopeKey,
  };
}

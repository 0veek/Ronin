import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { resolveSidebarSweepKeys } from "../Sidebar.logic";
import { SidebarPointerSensor } from "../Sidebar.pointer";
import { pullRequestEntryKey, type EnvironmentPullRequestEntry } from "./pullRequestList.logic";

/** A close drag stays within its starting group and commits only on release. */
export function usePullRequestCloseSweep({
  groups,
  closingKeys,
  closeBatch,
  scrollRef,
  resetKey,
}: {
  groups: ReadonlyArray<{ key: string; entries: ReadonlyArray<EnvironmentPullRequestEntry> }>;
  closingKeys: ReadonlySet<string>;
  closeBatch: (entries: ReadonlyArray<EnvironmentPullRequestEntry>) => Promise<void>;
  scrollRef: RefObject<HTMLDivElement | null>;
  resetKey: string;
}) {
  const [sweepingKeys, setSweepingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const sensorRef = useRef<SidebarPointerSensor | null>(null);
  const rows = useMemo(
    () =>
      new Map(
        groups.flatMap((group) =>
          group.entries.map(
            (entry) => [pullRequestEntryKey(entry), { entry, groupKey: group.key }] as const,
          ),
        ),
      ),
    [groups],
  );
  const latest = useRef({ groups, rows, closingKeys, closeBatch, resetKey });
  useLayoutEffect(() => {
    if (latest.current.resetKey !== resetKey) sensorRef.current?.cancel();
    latest.current = { groups, rows, closingKeys, closeBatch, resetKey };
  }, [groups, rows, closingKeys, closeBatch, resetKey]);
  useEffect(() => () => sensorRef.current?.cancel(), []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || sensorRef.current === null) return;
      event.preventDefault();
      sensorRef.current.cancel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const startSweep = useCallback(
    (entry: EnvironmentPullRequestEntry, event: PointerEvent) => {
      sensorRef.current?.cancel();
      const originKey = pullRequestEntryKey(entry);
      const groupKey = latest.current.rows.get(originKey)?.groupKey;
      if (groupKey === undefined || latest.current.closingKeys.has(originKey)) return;
      const orderedKeys = latest.current.groups.flatMap((group) =>
        group.entries.map(pullRequestEntryKey),
      );
      const canClose = (key: string) => {
        const row = latest.current.rows.get(key);
        return (
          row?.groupKey === groupKey &&
          row.entry.state === "open" &&
          row.entry.provider === "github" &&
          !latest.current.closingKeys.has(key) &&
          !scrollRef.current?.querySelector(
            `[data-pull-request-key="${CSS.escape(key)}"] [data-pull-request-action-pending="true"]`,
          )
        );
      };
      let sweptKeys: string[] = [];
      let targetKey: string | null = null;
      const sweepTo = (key: string) => {
        if (key === targetKey) return;
        targetKey = key;
        sweptKeys = resolveSidebarSweepKeys(orderedKeys, originKey, key, canClose);
        setSweepingKeys(new Set(sweptKeys));
      };
      sensorRef.current = new SidebarPointerSensor({
        active: originKey,
        event,
        options: {
          distance: 6,
          onAttach: () => {},
          onFinish: () => {
            sensorRef.current = null;
            setSweepingKeys(new Set());
          },
        },
        onPending: () => {},
        onStart: () => sweepTo(originKey),
        onMove: ({ y }) => {
          const viewport = scrollRef.current;
          if (!viewport) return;
          const bounds = viewport.getBoundingClientRect();
          const visibleY = Math.min(Math.max(y, bounds.top), bounds.bottom - 1);
          let key: string | null = null;
          for (const row of viewport.querySelectorAll<HTMLElement>("[data-pull-request-key]")) {
            if (key !== null && row.getBoundingClientRect().top > visibleY) break;
            key = row.dataset.pullRequestKey ?? null;
          }
          if (key !== null) sweepTo(key);
        },
        onEnd: () => {
          const batch = sweptKeys.filter(canClose).flatMap((key) => {
            const row = latest.current.rows.get(key);
            return row ? [row.entry] : [];
          });
          if (batch.length > 0) void latest.current.closeBatch(batch);
        },
        onCancel: () => {},
        onAbort: () => {},
      });
    },
    [scrollRef],
  );
  return { sweepingKeys, startSweep };
}

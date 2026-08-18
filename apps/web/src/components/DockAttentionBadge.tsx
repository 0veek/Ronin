import { useEffect, useMemo, useRef } from "react";

import { useThreadShells } from "../state/entities";
import { threadNeedsYou } from "./Sidebar.logic";

/**
 * Mirrors the sidebar's "needs you" queue onto the dock badge.
 *
 * The badge answers the question the app cannot answer while it is behind
 * another window: is anything waiting on me. It counts exactly what the queue
 * counts — `threadNeedsYou` is the single definition — so the number on the
 * icon and the number in the sidebar can never disagree.
 *
 * Renders nothing. It is a component rather than a hook so it can be mounted
 * once beside the other global hosts in the root route.
 */
export function DockAttentionBadge() {
  const shells = useThreadShells();
  const lastSentRef = useRef<number | null>(null);

  const needsYouCount = useMemo(
    () => shells.reduce((total, shell) => (threadNeedsYou(shell) ? total + 1 : total), 0),
    [shells],
  );

  useEffect(() => {
    const setBadgeCount = window.desktopBridge?.setBadgeCount;
    if (typeof setBadgeCount !== "function") return;
    // Thread shells churn on every token; the badge only changes when the count
    // does, so the bridge is not called once per stream event.
    if (lastSentRef.current === needsYouCount) return;
    lastSentRef.current = needsYouCount;
    void setBadgeCount(needsYouCount);
  }, [needsYouCount]);

  // The badge is app state, not window state: leaving it set after teardown
  // would outlive the queue it describes.
  useEffect(() => {
    return () => {
      void window.desktopBridge?.setBadgeCount?.(0);
    };
  }, []);

  return null;
}

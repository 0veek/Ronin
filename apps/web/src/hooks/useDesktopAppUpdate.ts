import type { DesktopAppUpdateState } from "@t3tools/contracts";
import { useCallback, useEffect, useState } from "react";

/**
 * Drives the packaged desktop app's in-app update.
 *
 * Returns `null` whenever the running client cannot update itself -- the
 * browser, or a desktop build old enough to predate the bridge -- so callers
 * fall back to linking out to the release page.
 */
export interface DesktopAppUpdateController {
  readonly state: DesktopAppUpdateState;
  readonly check: () => void;
  readonly download: () => void;
  readonly installAndRestart: () => void;
}

function readBridge() {
  if (typeof window === "undefined") return undefined;
  return window.desktopBridge?.appUpdate;
}

export function useDesktopAppUpdate(): DesktopAppUpdateController | null {
  const bridge = readBridge();
  const [state, setState] = useState<DesktopAppUpdateState | null>(null);

  useEffect(() => {
    if (!bridge) return;

    let cancelled = false;
    void bridge.getState().then(
      (next) => {
        if (!cancelled) setState(next);
      },
      () => {
        if (!cancelled) setState({ status: "unsupported" });
      },
    );

    // The main process owns the lifecycle, so progress and terminal states
    // arrive as pushes rather than polling.
    const unsubscribe = bridge.onStateChange((next) => {
      setState(next);
    });

    // Check once on startup so a published release surfaces without the user
    // going looking for it. Downloading still waits for their consent.
    void bridge.check().catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  const check = useCallback(() => {
    void bridge?.check().catch(() => undefined);
  }, [bridge]);
  const download = useCallback(() => {
    void bridge?.download().catch(() => undefined);
  }, [bridge]);
  const installAndRestart = useCallback(() => {
    // Resolves only on failure: a successful install quits the app.
    void bridge?.installAndRestart().catch(() => undefined);
  }, [bridge]);

  if (!bridge || state === null || state.status === "unsupported") {
    return null;
  }

  return { state, check, download, installAndRestart };
}

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { APP_VERSION, HOSTED_APP_CHANNEL } from "~/branding";
import { type AppUpdateState, fetchLatestAppRelease, isAppUpdateAvailable } from "~/appUpdate";
import { isElectron } from "~/env";

const AppUpdateContext = createContext<AppUpdateState>({ status: "unavailable" });

export function AppUpdateProvider({ children }: { readonly children: ReactNode }) {
  const enabled = isElectron || HOSTED_APP_CHANNEL !== null;
  const [state, setState] = useState<AppUpdateState>(() =>
    enabled ? { status: "checking" } : { status: "unavailable" },
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    void fetchLatestAppRelease().then(
      (latestRelease) => {
        if (cancelled) return;
        setState(
          isAppUpdateAvailable(APP_VERSION, latestRelease)
            ? { status: "available", latestRelease }
            : { status: "up-to-date", latestRelease },
        );
      },
      () => {
        if (!cancelled) {
          setState({ status: "error" });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return <AppUpdateContext value={state}>{children}</AppUpdateContext>;
}

export function useAppUpdate(): AppUpdateState {
  return useContext(AppUpdateContext);
}

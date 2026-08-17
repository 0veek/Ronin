import { CircleArrowUpIcon } from "lucide-react";
import { useEffect } from "react";
import * as Schema from "effect/Schema";

import { useAppUpdate } from "./AppUpdateProvider";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useDesktopAppUpdate } from "~/hooks/useDesktopAppUpdate";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { ensureLocalApi } from "~/localApi";

export const APP_UPDATE_NOTIFICATION_STORAGE_KEY = "ronin:app-update-notification:v1";

const seenUpdateVersions = new Set<string>();

export function AppUpdateNotification() {
  const update = useAppUpdate();
  const desktopUpdate = useDesktopAppUpdate();
  const [dismissedVersion, setDismissedVersion] = useLocalStorage(
    APP_UPDATE_NOTIFICATION_STORAGE_KEY,
    "",
    Schema.String,
  );

  // A packaged desktop build installs the update itself, so it gets its own
  // download/restart toast instead of the link-out below.
  const desktopStatus = desktopUpdate?.state.status;
  const desktopVersion = desktopUpdate?.state.version;
  const desktopPercent = desktopUpdate?.state.percent;
  const desktopDownload = desktopUpdate?.download;
  const desktopInstall = desktopUpdate?.installAndRestart;

  useEffect(() => {
    if (desktopStatus === undefined || desktopStatus === "idle" || desktopStatus === "checking") {
      return;
    }
    if (desktopStatus === "error") {
      return;
    }
    if (desktopStatus === "available" && dismissedVersion === desktopVersion) {
      return;
    }

    const versionLabel = desktopVersion ? `Ronin ${desktopVersion}` : "A new version";
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "info",
        title:
          desktopStatus === "ready"
            ? "Update ready to install"
            : desktopStatus === "downloading"
              ? "Downloading update"
              : "Update available",
        description:
          desktopStatus === "ready"
            ? `${versionLabel} is ready. Ronin will restart to finish installing.`
            : desktopStatus === "downloading"
              ? `${versionLabel} is downloading${
                  typeof desktopPercent === "number" ? ` — ${desktopPercent}%` : ""
                }.`
              : `${versionLabel} is available to download.`,
        timeout: 0,
        ...(desktopStatus === "downloading"
          ? {}
          : {
              actionProps: {
                children: desktopStatus === "ready" ? "Restart now" : "Download",
                onClick: () => {
                  if (desktopStatus === "ready") {
                    desktopInstall?.();
                  } else {
                    desktopDownload?.();
                  }
                },
              },
              actionVariant: "outline" as const,
            }),
        data: {
          hideCopyButton: true,
          leadingIcon: <CircleArrowUpIcon aria-hidden="true" className="size-4 text-info" />,
          ...(desktopStatus === "available" && desktopVersion
            ? {
                onClose: () => {
                  setDismissedVersion(desktopVersion);
                },
              }
            : {}),
        },
      }),
    );

    return () => {
      toastManager.close(toastId);
    };
  }, [
    desktopStatus,
    desktopVersion,
    desktopPercent,
    desktopDownload,
    desktopInstall,
    dismissedVersion,
    setDismissedVersion,
  ]);

  useEffect(() => {
    // The desktop path above owns the notification when it can self-update.
    if (desktopUpdate) {
      return;
    }
    if (
      update.status !== "available" ||
      dismissedVersion === update.latestRelease.version ||
      seenUpdateVersions.has(update.latestRelease.version)
    ) {
      return;
    }

    const release = update.latestRelease;
    seenUpdateVersions.add(release.version);

    const dismiss = () => {
      setDismissedVersion(release.version);
    };
    const openRelease = () => {
      void ensureLocalApi()
        .shell.openExternal(release.url)
        .then(dismiss)
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not open the release",
              description: error instanceof Error ? error.message : release.url,
            }),
          );
        });
    };

    const toastId = toastManager.add(
      stackedThreadToast({
        type: "info",
        title: "Update available",
        description: `Ronin ${release.version} is available. Ronin won't download it automatically.`,
        timeout: 0,
        actionProps: {
          children: "View release",
          onClick: openRelease,
        },
        actionVariant: "outline",
        data: {
          hideCopyButton: true,
          leadingIcon: <CircleArrowUpIcon aria-hidden="true" className="size-4 text-info" />,
          onClose: dismiss,
        },
      }),
    );

    return () => {
      toastManager.close(toastId);
    };
  }, [desktopUpdate, dismissedVersion, setDismissedVersion, update]);

  return null;
}

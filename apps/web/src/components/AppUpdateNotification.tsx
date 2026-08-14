import { CircleArrowUpIcon } from "lucide-react";
import { useEffect } from "react";
import * as Schema from "effect/Schema";

import { useAppUpdate } from "./AppUpdateProvider";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { ensureLocalApi } from "~/localApi";

export const APP_UPDATE_NOTIFICATION_STORAGE_KEY = "ronin:app-update-notification:v1";

const seenUpdateVersions = new Set<string>();

export function AppUpdateNotification() {
  const update = useAppUpdate();
  const [dismissedVersion, setDismissedVersion] = useLocalStorage(
    APP_UPDATE_NOTIFICATION_STORAGE_KEY,
    "",
    Schema.String,
  );

  useEffect(() => {
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
  }, [dismissedVersion, setDismissedVersion, update]);

  return null;
}

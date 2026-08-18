import { isLinuxPlatform, isMacPlatform, isWindowsPlatform } from "./utils";

const WCO_CLASS_NAME = "wco";
const ELECTRON_CLASS_NAME = "electron";
const ELECTRON_WINDOWS_CLASS_NAME = "electron-windows";
const ELECTRON_LINUX_CLASS_NAME = "electron-linux";
const ELECTRON_MACOS_CLASS_NAME = "electron-macos";

interface WindowControlsOverlayLike {
  readonly visible: boolean;
  addEventListener(type: "geometrychange", listener: EventListener): void;
  removeEventListener(type: "geometrychange", listener: EventListener): void;
}

interface NavigatorWithWindowControlsOverlay extends Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlayLike;
}

function getWindowControlsOverlay(): WindowControlsOverlayLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  return (navigator as NavigatorWithWindowControlsOverlay).windowControlsOverlay ?? null;
}

export function syncDocumentWindowControlsOverlayClass(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const overlay = getWindowControlsOverlay();
  const update = () => {
    document.documentElement.classList.toggle(WCO_CLASS_NAME, overlay !== null && overlay.visible);
  };

  update();
  if (!overlay) {
    return () => {};
  }

  overlay.addEventListener("geometrychange", update);
  return () => {
    overlay.removeEventListener("geometrychange", update);
  };
}

/**
 * macOS used to be the unqualified `electron` case, which meant a rule could
 * only ever be written *against* Windows and Linux. Chrome that is specifically
 * macOS-shaped -- the traffic-light gutter, the OS material the sidebar rides
 * on -- needs to name the platform it is for, so it gets its own class like the
 * other two.
 */
export function getElectronPlatformClassNames(
  platform: string,
):
  | readonly [typeof ELECTRON_CLASS_NAME]
  | readonly [typeof ELECTRON_CLASS_NAME, typeof ELECTRON_WINDOWS_CLASS_NAME]
  | readonly [typeof ELECTRON_CLASS_NAME, typeof ELECTRON_LINUX_CLASS_NAME]
  | readonly [typeof ELECTRON_CLASS_NAME, typeof ELECTRON_MACOS_CLASS_NAME] {
  if (isWindowsPlatform(platform)) {
    return [ELECTRON_CLASS_NAME, ELECTRON_WINDOWS_CLASS_NAME];
  }
  if (isLinuxPlatform(platform)) {
    return [ELECTRON_CLASS_NAME, ELECTRON_LINUX_CLASS_NAME];
  }
  if (isMacPlatform(platform)) {
    return [ELECTRON_CLASS_NAME, ELECTRON_MACOS_CLASS_NAME];
  }
  return [ELECTRON_CLASS_NAME];
}

export function syncDocumentElectronPlatformClasses(platform: string): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const classNames = getElectronPlatformClassNames(platform);
  document.documentElement.classList.add(...classNames);
  return () => {
    document.documentElement.classList.remove(...classNames);
  };
}

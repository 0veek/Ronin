/**
 * Which system-drawn material, if any, sits behind the main window.
 *
 * Only macOS and Windows 11 draw one. Linux has no Electron-level equivalent --
 * blur there belongs to the compositor (KWin, Hyprland) and is the user's rule
 * to write, not ours to request -- so it resolves to `null` and the renderer
 * paints its own material instead.
 *
 * Both the window constructor and the renderer read this, and they must agree:
 * a window that asks the OS for vibrancy while the renderer paints an opaque
 * fill just looks like a normal window that wasted a compositor pass.
 */

import type { DesktopWindowVibrancy } from "@t3tools/contracts";

import type * as Electron from "electron";

export type WindowVibrancyOptions = Pick<
  Electron.BrowserWindowConstructorOptions,
  "backgroundMaterial" | "vibrancy"
>;

/** Alpha-zero, so the OS material shows through instead of this fill. */
export const TRANSPARENT_WINDOW_BACKGROUND_COLOR = "#00000000";

export function resolveWindowVibrancy(platform: NodeJS.Platform): DesktopWindowVibrancy | null {
  if (platform === "darwin") return "vibrancy";
  if (platform === "win32") return "acrylic";
  return null;
}

/**
 * `transparent: true` is deliberately absent. Electron already makes the
 * WebContents transparent when either material is set, and combining the two
 * with a hidden titlebar is the frameless-transparent bug class this app cannot
 * afford on its primary surface.
 */
export function getWindowVibrancyOptions(platform: NodeJS.Platform): WindowVibrancyOptions {
  const vibrancy = resolveWindowVibrancy(platform);
  if (vibrancy === "vibrancy") {
    // "sidebar" is the material AppKit uses for exactly this shape of chrome:
    // a standing column of navigation beside opaque content.
    return { vibrancy: "sidebar" };
  }
  if (vibrancy === "acrylic") {
    return { backgroundMaterial: "acrylic" };
  }
  return {};
}

/**
 * The window's own fill. Opaque is the correct default -- it is what the user
 * sees between window creation and first paint, and a transparent one there
 * shows a hole. Only a window with an OS material behind it wants alpha zero.
 */
export function resolveWindowBackgroundColor(input: {
  readonly opaqueColor: string;
  readonly platform: NodeJS.Platform;
}): string {
  return resolveWindowVibrancy(input.platform) === null
    ? input.opaqueColor
    : TRANSPARENT_WINDOW_BACKGROUND_COLOR;
}

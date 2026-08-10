// @effect-diagnostics nodeBuiltinImport:off - pre-ready Electron setup reads persisted settings synchronously before app services are available.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as DesktopEarlyElectronStartup from "./DesktopEarlyElectronStartup.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";

export interface DesktopPreReadyCommandLineReader {
  readonly hasSwitch: (switchName: string) => boolean;
  readonly getSwitchValue: (switchName: string) => string;
}

export function readCommandLineSwitchValue(
  commandLine: DesktopPreReadyCommandLineReader,
  switchName: string,
): string | null {
  if (!commandLine.hasSwitch(switchName)) {
    return null;
  }

  const value = commandLine.getSwitchValue(switchName).trim();
  return value.length > 0 ? value : null;
}

/**
 * Chromium's Wayland Ozone path is not compatible with Vulkan. When both are
 * active, GPU compositing for effects such as CSS `backdrop-filter` (glass
 * surfaces) fails silently while `CSS.supports('backdrop-filter', …)` still
 * returns true. Prefer OpenGL on Wayland so glass menus/composer actually blur.
 */
export function shouldDisableVulkanForLinuxGlass(env: NodeJS.ProcessEnv): boolean {
  const sessionType = env.XDG_SESSION_TYPE?.trim().toLowerCase();
  if (sessionType === "wayland") {
    return true;
  }
  return Boolean(env.WAYLAND_DISPLAY?.trim());
}

export function mergeCommandLineFeatureList(
  existing: string | null | undefined,
  features: readonly string[],
): string {
  const values = new Set<string>();
  for (const entry of existing?.split(",") ?? []) {
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      values.add(trimmed);
    }
  }
  for (const feature of features) {
    const trimmed = feature.trim();
    if (trimmed.length > 0) {
      values.add(trimmed);
    }
  }
  return [...values].join(",");
}

export function applyLinuxGlassCompositorSwitches(
  commandLine: DesktopPreReadyCommandLineReader & {
    readonly appendSwitch: (switchName: string, value?: string) => void;
  },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!shouldDisableVulkanForLinuxGlass(env)) {
    return false;
  }

  const existing = readCommandLineSwitchValue(commandLine, "disable-features");
  const merged = mergeCommandLineFeatureList(existing, ["Vulkan"]);
  commandLine.appendSwitch("disable-features", merged);
  return true;
}

export const resolveEarlyLinuxElectronOptionsFromProcess =
  (): DesktopEarlyElectronStartup.EarlyLinuxElectronOptions =>
    DesktopEarlyElectronStartup.resolveEarlyLinuxElectronOptions({
      env: process.env,
      homeDirectory: NodeOS.homedir(),
      joinPath: NodePath.posix.join,
      readFileString: (path) => NodeFS.readFileSync(path, "utf8"),
    });

export class DesktopPreReadyElectronOptions extends Context.Service<
  DesktopPreReadyElectronOptions,
  {
    readonly linux: DesktopEarlyElectronStartup.EarlyLinuxElectronOptions | null;
    readonly linuxPasswordStoreCommandLine: string | null;
    readonly linuxGlassVulkanDisabled: boolean;
  }
>()("@t3tools/desktop/app/DesktopPreReadyPlatform/DesktopPreReadyElectronOptions") {}

export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  return yield* Effect.sync((): DesktopPreReadyElectronOptions["Service"] => {
    const linuxPasswordStoreCommandLine =
      platform === "linux"
        ? readCommandLineSwitchValue(Electron.app.commandLine, "password-store")
        : null;
    const linux = platform === "linux" ? resolveEarlyLinuxElectronOptionsFromProcess() : null;
    let linuxGlassVulkanDisabled = false;

    if (linux !== null) {
      Electron.app.commandLine.appendSwitch("class", linux.linuxWmClass);
      if (linux.passwordStore !== null && linuxPasswordStoreCommandLine === null) {
        Electron.app.commandLine.appendSwitch("password-store", linux.passwordStore);
      }
      // Must run before app ready so the compositor picks OpenGL instead of the
      // broken Wayland+Vulkan path that drops backdrop-filter blur.
      linuxGlassVulkanDisabled = applyLinuxGlassCompositorSwitches(Electron.app.commandLine);
    }

    return { linux, linuxPasswordStoreCommandLine, linuxGlassVulkanDisabled };
  });
}).pipe(Effect.withSpan("desktop.electron.configureBeforeReady"));

// Keep Electron's strict pre-ready setup isolated so later runtime layers cannot
// observe app readiness before scheme privileges and command-line switches exist.
export const layer = Layer.mergeAll(
  ElectronProtocol.layerSchemePrivileges,
  Layer.effect(DesktopPreReadyElectronOptions, make),
);

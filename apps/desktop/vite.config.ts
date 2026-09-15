import { defineConfig } from "vite-plus";

import { isDesktopRuntimeExternalDependency } from "../../scripts/lib/desktop-external-packages.ts";

const shouldLaunchElectronAfterPack = process.env.T3CODE_DESKTOP_DEV === "1";

const isMainProcessExternal = (id: string) =>
  id === "electron" || id.startsWith("electron/") || isDesktopRuntimeExternalDependency(id);

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp pack",
        dependsOn: ["t3#build"],
        cache: false,
      },
      dev: {
        command: "cross-env T3CODE_DESKTOP_DEV=1 vp pack --watch",
        dependsOn: ["t3#build"],
        cache: false,
      },
      "dev:bundle": {
        command: "vp pack --watch",
        cache: false,
      },
      "dev:electron": {
        command: "node scripts/dev-electron.mjs",
        dependsOn: ["t3#build"],
        cache: false,
      },
    },
  },
  pack: [
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      outputOptions: { codeSplitting: false },
      entry: ["src/main.ts"],
      clean: true,
      deps: {
        alwaysBundle: (id) => !id.startsWith("node:") && !isMainProcessExternal(id),
        neverBundle: isMainProcessExternal,
        onlyBundle: false,
      },
      ...(shouldLaunchElectronAfterPack ? { onSuccess: "node scripts/dev-electron.mjs" } : {}),
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: [
        "src/electron/WindowsForegroundFocusWorker.ts",
        "src/snapShot/GlobalShiftShortcutWorker.ts",
        "src/snapShot/RegionSnapShotWorker.ts",
        "src/snapShot/SnapShotAccessibilityWorker.ts",
      ],
      clean: false,
      deps: {
        alwaysBundle: (id) => !id.startsWith("node:") && !isMainProcessExternal(id),
        neverBundle: isMainProcessExternal,
        onlyBundle: false,
      },
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preload.ts"],
    },
    {
      format: "cjs",
      outDir: "dist-electron",
      dts: false,
      sourcemap: true,
      outExtensions: () => ({ js: ".cjs" }),
      entry: ["src/preview-guest-preload.ts"],
    },
  ],
});

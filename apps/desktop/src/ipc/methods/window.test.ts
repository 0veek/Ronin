import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { getLocalEnvironmentBootstraps, getWindowFullscreenState } from "./window.ts";

const readyPrimaryConfig: DesktopBackendManager.DesktopBackendStartConfig = {
  executablePath: process.execPath,
  args: ["/app/bin.mjs", "--bootstrap-fd", "3"],
  entryPath: "/app/bin.mjs",
  cwd: "/app",
  env: { ELECTRON_RUN_AS_NODE: "1" },
  extendEnv: true,
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3773,
    host: "127.0.0.1",
    desktopBootstrapToken: "bootstrap-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  bootstrapDelivery: "fd3",
  httpBaseUrl: new URL("http://127.0.0.1:3773"),
  captureOutput: true,
  preflightFailure: Option.none(),
};

const primaryInstance: DesktopBackendManager.DesktopBackendInstance = {
  id: DesktopBackendManager.PRIMARY_INSTANCE_ID,
  label: Effect.succeed("Local environment"),
  start: Effect.void,
  stop: () => Effect.void,
  currentConfig: Effect.succeed(Option.some(readyPrimaryConfig)),
  snapshot: Effect.succeed({
    desiredRunning: true,
    ready: true,
    activePid: Option.some(123),
    restartAttempt: 0,
    restartScheduled: false,
  }),
  waitForReady: () => Effect.succeed(true),
};

const secondaryInstance: DesktopBackendManager.DesktopBackendInstance = {
  id: DesktopBackendManager.BackendInstanceId("secondary"),
  label: Effect.succeed("Secondary environment"),
  start: Effect.void,
  stop: () => Effect.void,
  currentConfig: Effect.succeed(
    Option.some({
      ...readyPrimaryConfig,
      httpBaseUrl: new URL("http://127.0.0.1:3774"),
      bootstrap: {
        ...readyPrimaryConfig.bootstrap,
        port: 3774,
      },
    }),
  ),
  snapshot: Effect.succeed({
    desiredRunning: true,
    ready: true,
    activePid: Option.some(456),
    restartAttempt: 0,
    restartScheduled: false,
  }),
  waitForReady: () => Effect.succeed(true),
};

describe("getLocalEnvironmentBootstraps", () => {
  it.effect("publishes ready backend endpoints with the instance label", () =>
    Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();

      assert.deepEqual(result, [
        {
          id: "primary",
          label: "Local environment",
          runningDistro: null,
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
          bootstrapToken: "bootstrap-token",
        },
        {
          id: "secondary",
          label: "Secondary environment",
          runningDistro: null,
          httpBaseUrl: "http://127.0.0.1:3774/",
          wsBaseUrl: "ws://127.0.0.1:3774/",
          bootstrapToken: "bootstrap-token",
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([primaryInstance, secondaryInstance]))),
  );

  it.effect("publishes a pending bootstrap only while a transient retry is scheduled", () => {
    const retryingConfig: DesktopBackendManager.DesktopBackendStartConfig = {
      ...readyPrimaryConfig,
      preflightFailure: Option.some({
        reason: "toolchain probe timed out",
        fatal: false,
        retryLimit: 12,
      }),
    };
    const retryingSecondary: DesktopBackendManager.DesktopBackendInstance = {
      ...secondaryInstance,
      currentConfig: Effect.succeed(Option.some(retryingConfig)),
      snapshot: Effect.succeed({
        desiredRunning: true,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 2,
        restartScheduled: true,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, [
        {
          id: "primary",
          label: "Local environment",
          runningDistro: null,
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
          bootstrapToken: "bootstrap-token",
        },
        {
          id: "secondary",
          label: "Secondary environment",
          runningDistro: null,
          httpBaseUrl: null,
          wsBaseUrl: null,
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([primaryInstance, retryingSecondary])));
  });

  it.effect("omits a bounded transient bootstrap after retries stop", () => {
    const stoppedSecondary: DesktopBackendManager.DesktopBackendInstance = {
      ...secondaryInstance,
      currentConfig: Effect.succeed(
        Option.some({
          ...readyPrimaryConfig,
          preflightFailure: Option.some({
            reason: "toolchain probe timed out",
            fatal: false,
            retryLimit: 12,
          }),
        }),
      ),
      snapshot: Effect.succeed({
        desiredRunning: false,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 12,
        restartScheduled: false,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, [
        {
          id: "primary",
          label: "Local environment",
          runningDistro: null,
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
          bootstrapToken: "bootstrap-token",
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([primaryInstance, stoppedSecondary])));
  });
});

describe("getWindowFullscreenState", () => {
  it.effect("reads the current native window state", () => {
    const window = { isFullScreen: () => true } as Electron.BrowserWindow;

    return Effect.gen(function* () {
      assert.isTrue(yield* getWindowFullscreenState.handler());
    }).pipe(
      Effect.provide(
        Layer.mock(ElectronWindow.ElectronWindow)({
          currentMainOrFirst: Effect.succeed(Option.some(window)),
        }),
      ),
    );
  });
});

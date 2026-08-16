/**
 * AntigravityDriver — `ProviderDriver` for Google's Antigravity CLI (`agy`).
 *
 * There is no long-lived agent process: every turn is its own `agy -p` print
 * run that rejoins the thread through `--conversation` and takes its model on
 * the spawn line. Model catalog and version come from the managed provider
 * status check, which shells out to `agy models` and `agy --version`.
 *
 * Text generation reuses print mode in `plan` mode inside `agy`'s sandbox, so
 * a headless commit-message run cannot touch the repository.
 *
 * @module provider/Drivers/AntigravityDriver
 */
import { AntigravitySettings, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeAntigravityTextGeneration } from "../../textGeneration/AntigravityTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeAntigravityAdapter } from "../Layers/AntigravityAdapter.ts";
import {
  buildInitialAntigravityProviderSnapshot,
  checkAntigravityProviderStatus,
  enrichAntigravitySnapshot,
} from "../Layers/AntigravityProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import {
  makeProviderMaintenanceCapabilities,
  type ProviderMaintenanceCapabilitiesResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "../providerUpdateSettings.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);
const DRIVER_KIND = ProviderDriverKind.make("antigravity");
// `agy update` updates in place. There is no package to read a latest version
// from — Antigravity ships a downloaded binary, and the plausible npm names are
// unrelated placeholders — so the card offers the update without claiming to
// know whether one is waiting.
const UPDATE: ProviderMaintenanceCapabilitiesResolver = {
  resolve: (options) =>
    makeProviderMaintenanceCapabilities({
      provider: DRIVER_KIND,
      packageName: null,
      updateExecutable: options?.binaryPath?.trim() || "agy",
      updateArgs: ["update"],
      updateLockKey: "agy",
    }),
};

export type AntigravityDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const AntigravityDriver: ProviderDriver<AntigravitySettings, AntigravityDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Antigravity",
    supportsMultipleInstances: true,
  },
  configSchema: AntigravitySettings,
  defaultConfig: (): AntigravitySettings => decodeAntigravitySettings({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const httpClient = yield* HttpClient.HttpClient;
      const serverSettings = yield* ServerSettingsService;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies AntigravitySettings;
      const maintenanceCapabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
        binaryPath: effectiveConfig.binaryPath,
        env: processEnv,
      });

      const adapter = yield* makeAntigravityAdapter(effectiveConfig, {
        environment: processEnv,
        instanceId,
      });
      const textGeneration = yield* makeAntigravityTextGeneration(effectiveConfig, processEnv);

      const checkProvider = checkAntigravityProviderStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

      const snapshotSettings = makeProviderSnapshotSettingsSource(effectiveConfig, serverSettings);
      const snapshot = yield* makeManagedServerProvider<
        ProviderSnapshotSettings<AntigravitySettings>
      >({
        maintenanceCapabilities,
        getSettings: snapshotSettings.getSettings,
        streamSettings: snapshotSettings.streamSettings,
        haveSettingsChanged: haveProviderSnapshotSettingsChanged,
        initialSnapshot: (settings) =>
          buildInitialAntigravityProviderSnapshot(settings.provider).pipe(
            Effect.map(stampIdentity),
          ),
        checkProvider,
        enrichSnapshot: ({ settings, snapshot: currentSnapshot, publishSnapshot }) =>
          enrichAntigravitySnapshot({
            snapshot: currentSnapshot,
            maintenanceCapabilities,
            enableProviderUpdateChecks: settings.enableProviderUpdateChecks,
            publishSnapshot,
            httpClient,
          }),
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Antigravity snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};

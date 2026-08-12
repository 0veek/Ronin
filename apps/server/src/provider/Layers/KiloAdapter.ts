/**
 * KiloAdapter — Kilo's CLI/server API is OpenCode-compatible, so the live
 * adapter reuses the OpenCode implementation with Kilo process settings.
 *
 * @module KiloAdapter
 */
import { type KiloSettings, type OpenCodeSettings, ProviderDriverKind } from "@t3tools/contracts";

import { KILO_CLI_SPEC } from "../opencodeRuntime.ts";
import { makeOpenCodeAdapter, type OpenCodeAdapterLiveOptions } from "./OpenCodeAdapter.ts";

const PROVIDER = ProviderDriverKind.make("kilo");

export function kiloSettingsAsOpenCode(settings: KiloSettings): OpenCodeSettings {
  return {
    enabled: settings.enabled,
    binaryPath: settings.binaryPath,
    serverUrl: settings.serverUrl,
    serverPassword: settings.serverPassword,
    customModels: settings.customModels,
  };
}

export function makeKiloAdapter(kiloSettings: KiloSettings, options?: OpenCodeAdapterLiveOptions) {
  return makeOpenCodeAdapter(kiloSettingsAsOpenCode(kiloSettings), {
    ...options,
    provider: options?.provider ?? PROVIDER,
    cliSpec: options?.cliSpec ?? KILO_CLI_SPEC,
  });
}

import { type KiloSettings, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { kiloSettingsAsOpenCode } from "./KiloAdapter.ts";
import { checkOpenCodeProviderStatus, makePendingOpenCodeProvider } from "./OpenCodeProvider.ts";
import { KILO_CLI_SPEC } from "../opencodeRuntime.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";

const KILO_PRESENTATION = {
  displayName: "Kilo",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
} as const;

/**
 * Kilo speaks OpenCode's server API, so it reuses OpenCode's probe. What it
 * does not share is OpenCode's release train: `KILO_CLI_SPEC` carries Kilo's
 * own binary name, config env var, server auth username and version floor, so
 * the probe reports on Kilo rather than describing OpenCode under a new label.
 */
function stampKiloPresentation(snapshot: ServerProviderDraft): ServerProviderDraft {
  return {
    ...snapshot,
    ...KILO_PRESENTATION,
    auth: {
      ...snapshot.auth,
      type: "kilo",
    },
  };
}

export function makePendingKiloProvider(
  kiloSettings: KiloSettings,
): Effect.Effect<ServerProviderDraft> {
  return makePendingOpenCodeProvider(kiloSettingsAsOpenCode(kiloSettings), KILO_CLI_SPEC).pipe(
    Effect.map(stampKiloPresentation),
  );
}

export const checkKiloProviderStatus = (
  kiloSettings: KiloSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof checkOpenCodeProviderStatus> =>
  checkOpenCodeProviderStatus(
    kiloSettingsAsOpenCode(kiloSettings),
    cwd,
    environment,
    KILO_CLI_SPEC,
  ).pipe(Effect.map(stampKiloPresentation));

export type { ServerProvider };

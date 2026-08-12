import { type KiloSettings, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { kiloSettingsAsOpenCode } from "./KiloAdapter.ts";
import { checkOpenCodeProviderStatus, makePendingOpenCodeProvider } from "./OpenCodeProvider.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";

const KILO_PRESENTATION = {
  displayName: "Kilo",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
} as const;

function stampKiloPresentation(snapshot: ServerProviderDraft): ServerProviderDraft {
  const message = snapshot.message?.replaceAll("OpenCode", "Kilo").replaceAll("opencode", "kilo");
  return {
    ...snapshot,
    ...KILO_PRESENTATION,
    auth: {
      ...snapshot.auth,
      type: "kilo",
    },
    ...(message ? { message } : {}),
  };
}

export function makePendingKiloProvider(
  kiloSettings: KiloSettings,
): Effect.Effect<ServerProviderDraft> {
  return makePendingOpenCodeProvider(kiloSettingsAsOpenCode(kiloSettings)).pipe(
    Effect.map(stampKiloPresentation),
  );
}

export const checkKiloProviderStatus = (
  kiloSettings: KiloSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof checkOpenCodeProviderStatus> =>
  checkOpenCodeProviderStatus(kiloSettingsAsOpenCode(kiloSettings), cwd, environment).pipe(
    Effect.map(stampKiloPresentation),
  );

export type { ServerProvider };

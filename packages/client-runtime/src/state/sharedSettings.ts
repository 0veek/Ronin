/**
 * Shared server settings.
 *
 * Every server keeps its own `settings.json`, but some keys are user
 * preferences that only live on the server because the server has to act on
 * them (auto-settlement runs with no client attached). A user does not want
 * those to differ per machine. Clients write these keys to every connected
 * environment, and warn when a connected environment still holds a different
 * value so the user can push their current value out.
 */
import type { EnvironmentId, ServerSettings, ServerSettingsPatch } from "@t3tools/contracts";
import { isModelSelectionProviderEnabled } from "@t3tools/shared/serverSettings";
import * as Equal from "effect/Equal";
import * as Struct from "effect/Struct";

/** Server keys that hold a user preference rather than machine config. */
export const SHARED_SERVER_SETTING_KEYS = [
  "sidebarAutoSettleAfterDays",
  "sidebarAutoSettleOnMerge",
  "defaultThreadEnvMode",
  "newWorktreesStartFromOrigin",
  "sourceControlWritingStyle",
  "textGenerationModelSelection",
] as const satisfies ReadonlyArray<keyof ServerSettings & keyof ServerSettingsPatch>;

export type SharedServerSettingKey = (typeof SHARED_SERVER_SETTING_KEYS)[number];

const SHARED_KEY_SET = new Set<string>(SHARED_SERVER_SETTING_KEYS);

/** Split a server patch into the keys every environment should receive and the primary-only rest. */
export function splitSharedServerPatch(patch: ServerSettingsPatch): {
  sharedPatch: ServerSettingsPatch;
  localPatch: ServerSettingsPatch;
} {
  const sharedPatch: Record<string, unknown> = {};
  const localPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SHARED_KEY_SET.has(key)) {
      sharedPatch[key] = value;
    } else {
      localPatch[key] = value;
    }
  }
  return {
    sharedPatch: sharedPatch as ServerSettingsPatch,
    localPatch: localPatch as ServerSettingsPatch,
  };
}

/** The shared subset of one environment's settings, as a patch that can be written elsewhere. */
export function pickSharedServerSettings(settings: ServerSettings): ServerSettingsPatch {
  return Struct.pick(settings, SHARED_SERVER_SETTING_KEYS);
}

/** A model choice only crosses to a machine where the same provider is enabled. */
export function filterSharedServerPatch(
  patch: ServerSettingsPatch,
  settings?: ServerSettings,
  sourceSettings = settings,
  targetIsSource = false,
): ServerSettingsPatch {
  const instanceId =
    patch.textGenerationModelSelection?.instanceId ??
    sourceSettings?.textGenerationModelSelection.instanceId;
  if (
    !targetIsSource &&
    patch.textGenerationModelSelection &&
    (!settings ||
      (instanceId !== undefined &&
        (sourceSettings?.providerInstances[instanceId]?.driver ?? instanceId) !==
          (settings.providerInstances[instanceId]?.driver ?? instanceId)) ||
      !isModelSelectionProviderEnabled(settings, {
        ...settings.textGenerationModelSelection,
        ...patch.textGenerationModelSelection,
      }))
  ) {
    return Struct.omit(patch, ["textGenerationModelSelection"]);
  }
  return patch;
}

export interface SharedSettingsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly settings: ServerSettings | null;
}

/**
 * Connected environments whose shared settings differ from the primary
 * environment's. Offline environments are skipped: nothing can be read from
 * or written to them, and the warning would never clear. With no primary
 * settings loaded there is nothing to compare against, so nothing is
 * reported. Callers must pass the real loaded settings, never a default
 * fallback, or "apply to all" would push defaults over real values.
 */
export function findSharedSettingsMismatches(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly primarySettings: ServerSettings | null;
  readonly environments: ReadonlyArray<SharedSettingsEnvironment>;
}): ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }> {
  if (input.primaryEnvironmentId === null || input.primarySettings === null) {
    return [];
  }
  const primarySettings = input.primarySettings;
  const expected = pickSharedServerSettings(primarySettings);
  return input.environments.flatMap((environment) => {
    if (
      environment.environmentId === input.primaryEnvironmentId ||
      !environment.connected ||
      environment.settings === null
    ) {
      return [];
    }
    const expectedForTarget = filterSharedServerPatch(
      expected,
      environment.settings,
      primarySettings,
    );
    let actual = filterSharedServerPatch(
      pickSharedServerSettings(environment.settings),
      environment.settings,
    );
    if (!expectedForTarget.textGenerationModelSelection) {
      actual = Struct.omit(actual, ["textGenerationModelSelection"]);
    }
    return Equal.equals(actual, expectedForTarget)
      ? []
      : [{ environmentId: environment.environmentId, label: environment.label }];
  });
}

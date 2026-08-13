import {
  DEFAULT_MODEL_BY_PROVIDER,
  type GrokSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");
import type * as EffectAcpSchema from "effect-acp/schema";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import { makeGrokAcpRuntime, resolveGrokAcpBaseModelId } from "../acp/GrokAcpSupport.ts";

const GROK_PRESENTATION = {
  displayName: "Grok",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;
/**
 * Grok exposes reasoning effort as a process-start CLI flag
 * (`--reasoning-effort`), not via session/set_model. Same levels Synara ships.
 */
const GROK_REASONING_EFFORT_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    buildSelectOptionDescriptor({
      id: "reasoningEffort",
      label: "Reasoning",
      options: [
        { value: "none", label: "None" },
        { value: "low", label: "Low", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    }),
  ],
});

type ModelInfoMeta = EffectAcpSchema.ModelInfo["_meta"];

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const GROK_ACP_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * Shown only until ACP discovery answers, and whenever the CLI cannot be
 * probed. The installed Grok is the source of truth for both the model list
 * and each model's reasoning-effort menu — see
 * `buildGrokDiscoveredModelsFromSessionModelState` — so anything hardcoded
 * here goes stale the moment xAI ships a new build.
 */
/**
 * One entry, and only until the CLI answers.
 *
 * Deliberately not a curated list: a hardcoded catalog is what put retired
 * models (`Grok Build 0.1`, `Grok 4.3`) in the picker long after Grok Build
 * stopped offering them. Anything selectable comes from
 * `buildGrokDiscoveredModelsFromSessionModelState`, which reads what the
 * installed CLI advertises. This placeholder exists so the picker is not empty
 * before the first probe, and shares its slug with the alias table in
 * contracts so there is a single name to update.
 */
const GROK_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: DEFAULT_MODEL_BY_PROVIDER[GROK_DRIVER_KIND] ?? "grok-4.6",
    name: "Grok",
    isCustom: false,
    capabilities: GROK_REASONING_EFFORT_CAPABILITIES,
  },
];

interface GrokAdvertisedReasoningEffort {
  readonly value: string;
  readonly label: string;
  readonly isDefault: boolean;
}

function readGrokAdvertisedReasoningEfforts(
  meta: ModelInfoMeta,
): ReadonlyArray<GrokAdvertisedReasoningEffort> {
  const raw = meta?.reasoningEfforts;
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const efforts: Array<GrokAdvertisedReasoningEffort> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const value = typeof record.value === "string" ? record.value.trim() : "";
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const label = typeof record.label === "string" ? record.label.trim() : "";
    efforts.push({ value, label: label || value, isDefault: record.default === true });
  }
  return efforts;
}

/**
 * Grok marks more than one effort as `default` (4.6 flags both `xhigh` and
 * `high`), but a select descriptor takes exactly one current value. Keep the
 * first, which is the order Grok itself presents.
 */
function grokCapabilitiesFromAdvertisedEfforts(
  efforts: ReadonlyArray<GrokAdvertisedReasoningEffort>,
): ModelCapabilities {
  if (efforts.length === 0) {
    return GROK_REASONING_EFFORT_CAPABILITIES;
  }

  const defaultValue = efforts.find((effort) => effort.isDefault)?.value;
  return createModelCapabilities({
    optionDescriptors: [
      buildSelectOptionDescriptor({
        id: "reasoningEffort",
        label: "Reasoning",
        options: efforts.map((effort) => ({
          value: effort.value,
          label: effort.label,
          ...(effort.value === defaultValue ? { isDefault: true } : {}),
        })),
      }),
    ],
  });
}

export function buildInitialGrokProviderSnapshot(
  grokSettings: GrokSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = grokModelsFromSettings(grokSettings.customModels);

    if (!grokSettings.enabled) {
      return buildServerProvider({
        presentation: GROK_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Grok is disabled in Ronin settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Grok CLI availability...",
      },
    });
  });
}

function grokModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
  builtInModels: ReadonlyArray<ServerProviderModel> = GROK_BUILT_IN_MODELS,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    builtInModels,
    customModels ?? [],
    GROK_REASONING_EFFORT_CAPABILITIES,
  );
}

export function buildGrokDiscoveredModelsFromSessionModelState(
  modelState: EffectAcpSchema.SessionModelState | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (!modelState || modelState.availableModels.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  return modelState.availableModels
    .map((model): ServerProviderModel | undefined => {
      const slug = resolveGrokAcpBaseModelId(model.modelId);
      if (!slug || seen.has(slug)) {
        return undefined;
      }
      seen.add(slug);
      return {
        slug,
        name: model.name.trim() || slug,
        isCustom: false,
        // Per model: 4.6 advertises xhigh, 4.5 does not.
        capabilities: grokCapabilitiesFromAdvertisedEfforts(
          readGrokAdvertisedReasoningEfforts(model._meta),
        ),
      };
    })
    .filter((model): model is ServerProviderModel => model !== undefined);
}

const discoverGrokModelsViaAcp = (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acp = yield* makeGrokAcpRuntime({
      grokSettings,
      environment,
      childProcessSpawner,
      cwd: process.cwd(),
      runtimeMode: "approval-required",
      clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
    });
    const started = yield* acp.start();
    return buildGrokDiscoveredModelsFromSessionModelState(started.sessionSetupResult.models);
  }).pipe(Effect.scoped);

const runGrokVersionCommand = (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const command = grokSettings.binaryPath || "grok";
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

export const checkGrokProviderStatus = Effect.fn("checkGrokProviderStatus")(function* (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = grokModelsFromSettings(grokSettings.customModels);

  if (!grokSettings.enabled) {
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Grok is disabled in Ronin settings.",
      },
    });
  }

  const versionResult = yield* runGrokVersionCommand(grokSettings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    yield* Effect.logWarning("Grok CLI health check failed.", {
      errorTag: error._tag,
    });
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Grok CLI (`grok`) is not installed or not on PATH."
          : "Failed to execute Grok CLI health check.",
      },
    });
  }

  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Grok CLI is installed but timed out while running `grok --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    yield* Effect.logWarning("Grok CLI version probe exited with a non-zero status.", {
      exitCode: versionOutput.code,
      stdoutLength: versionOutput.stdout.length,
      stderrLength: versionOutput.stderr.length,
    });
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Grok CLI is installed but failed to run.",
      },
    });
  }

  const discoveryExit = yield* discoverGrokModelsViaAcp(grokSettings, environment).pipe(
    Effect.timeoutOption(GROK_ACP_MODEL_DISCOVERY_TIMEOUT_MS),
    Effect.exit,
  );
  if (Exit.isFailure(discoveryExit)) {
    yield* Effect.logWarning("Grok ACP model discovery failed", {
      errorTag: causeErrorTag(discoveryExit.cause),
    });
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Grok CLI is installed but ACP startup failed. Check server logs for details.",
      },
    });
  }
  if (Option.isNone(discoveryExit.value)) {
    yield* Effect.logWarning(
      `Grok ACP model discovery timed out after ${GROK_ACP_MODEL_DISCOVERY_TIMEOUT_MS}ms.`,
    );
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `Grok CLI is installed but ACP startup timed out after ${GROK_ACP_MODEL_DISCOVERY_TIMEOUT_MS}ms.`,
      },
    });
  }
  const discoveredModels = discoveryExit.value.value;
  const models =
    discoveredModels.length > 0
      ? grokModelsFromSettings(grokSettings.customModels, discoveredModels)
      : fallbackModels;

  return buildServerProvider({
    presentation: GROK_PRESENTATION,
    enabled: grokSettings.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "unknown" },
    },
  });
});

export const enrichGrokSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> => {
  const { snapshot, publishSnapshot } = input;

  return enrichProviderSnapshotWithVersionAdvisory(snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Grok version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
};

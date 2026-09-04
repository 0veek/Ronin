/**
 * GrokProvider — snapshot for the Grok Build CLI (`grok`).
 *
 * One ACP startup answers three questions at once: whether the CLI runs,
 * whether it is signed in, and which models it advertises. The model list and
 * each model's reasoning-effort menu come from that probe rather than a
 * hand-maintained catalog.
 *
 * @module provider/Layers/GrokProvider
 */
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type GrokSettings,
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import type * as EffectAcpErrors from "effect-acp/errors";
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
  COMPACT_SLASH_COMMAND,
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
import {
  describeGrokAuthMethod,
  isGrokCredentialsMissingError,
  isValidGrokReasoningEffortToken,
  makeGrokAcpRuntime,
  resolveGrokAcpAuthMethodId,
  resolveGrokAcpBaseModelId,
} from "../acp/GrokAcpSupport.ts";
import { discoverGrokSkills } from "../Drivers/GrokSkills.ts";

const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");

const GROK_PRESENTATION = {
  displayName: "Grok",
  showInteractionModeToggle: false,
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

/** A model that reports no effort dial gets no control, not the default list. */
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const GROK_ACP_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

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
  readonly description: string | undefined;
  readonly isDefault: boolean;
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

/**
 * Reads the effort levels one model advertises, or none when it says it has
 * no such control.
 *
 * `supportsReasoningEffort: false` is the CLI telling us this model has no
 * effort dial at all, which is not the same as advertising nothing: the first
 * must show no control, the second falls back to the levels Grok has always
 * shipped. Values arrive as `value` on current builds and `id` on older ones,
 * and either key can carry a token that has no business on a command line, so
 * both are validated before they can reach `--reasoning-effort`.
 */
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
    const candidate = trimmedString(record.value) ?? trimmedString(record.id);
    const value =
      candidate !== undefined && isValidGrokReasoningEffortToken(candidate) ? candidate : undefined;
    if (value === undefined || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const description = trimmedString(record.description);
    efforts.push({
      value,
      label: trimmedString(record.label) ?? value,
      description,
      isDefault: record.default === true || record.isDefault === true,
    });
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
          ...(effort.description ? { description: effort.description } : {}),
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
        // Per model: 4.6 advertises xhigh, 4.5 does not, and a model can say it
        // has no effort dial at all.
        capabilities:
          model._meta?.supportsReasoningEffort === false
            ? EMPTY_CAPABILITIES
            : grokCapabilitiesFromAdvertisedEfforts(
                readGrokAdvertisedReasoningEfforts(model._meta),
              ),
      };
    })
    .filter((model): model is ServerProviderModel => model !== undefined);
}

/**
 * What one ACP startup told us: the models the CLI advertises, or that nobody
 * is signed in. Grok authenticates during `initialize`, so the same probe that
 * reads the model list is also the only place the sign-in state is observable.
 */
type GrokAcpProbe =
  | {
      readonly _tag: "ready";
      readonly models: ReadonlyArray<ServerProviderModel>;
      readonly authLabel: string | undefined;
    }
  | { readonly _tag: "unauthenticated"; readonly detail: string };

const probeGrokViaAcp = (
  grokSettings: GrokSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.Effect<
  GrokAcpProbe,
  EffectAcpErrors.AcpError,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto
> =>
  Effect.gen(function* () {
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acp = yield* makeGrokAcpRuntime({
      grokSettings,
      environment,
      childProcessSpawner,
      cwd: process.cwd(),
      runtimeMode: "approval-required",
      clientInfo: { name: "ronin-provider-probe", version: "0.0.0" },
    });
    const started = yield* acp.start();
    // Startup already authenticated with this method; resolving it again names
    // the credential the card shows without a second round trip.
    const authMethodId = yield* resolveGrokAcpAuthMethodId(
      started.initializeResult,
      environment,
    ).pipe(Effect.orElseSucceed(() => undefined));
    return {
      _tag: "ready",
      models: buildGrokDiscoveredModelsFromSessionModelState(started.sessionSetupResult.models),
      authLabel: authMethodId ? describeGrokAuthMethod(authMethodId) : undefined,
    } as const;
  }).pipe(
    Effect.scoped,
    Effect.catch((cause) =>
      isGrokCredentialsMissingError(cause)
        ? Effect.succeed({ _tag: "unauthenticated", detail: cause.message } as const)
        : Effect.fail(cause),
    ),
  );

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
  cwd?: string,
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

  const skills = yield* discoverGrokSkills(grokSettings, environment, cwd);

  const discoveryExit = yield* probeGrokViaAcp(grokSettings, environment).pipe(
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
      skills,
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
      skills,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: `Grok CLI is installed but ACP startup timed out after ${GROK_ACP_MODEL_DISCOVERY_TIMEOUT_MS}ms.`,
      },
    });
  }
  const probe = discoveryExit.value.value;
  if (probe._tag === "unauthenticated") {
    return buildServerProvider({
      presentation: GROK_PRESENTATION,
      enabled: grokSettings.enabled,
      checkedAt,
      models: fallbackModels,
      skills,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: probe.detail,
      },
    });
  }
  const models =
    probe.models.length > 0
      ? grokModelsFromSettings(grokSettings.customModels, probe.models)
      : fallbackModels;

  return buildServerProvider({
    presentation: GROK_PRESENTATION,
    enabled: grokSettings.enabled,
    checkedAt,
    models,
    skills,
    slashCommands: [COMPACT_SLASH_COMMAND],
    probe: {
      installed: true,
      version,
      status: "ready",
      // Startup completed the ACP `authenticate` handshake, so the CLI holds a
      // credential Ronin can actually run turns with.
      auth: { status: "authenticated", ...(probe.authLabel ? { type: probe.authLabel } : {}) },
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

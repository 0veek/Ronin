import {
  type ModelCapabilities,
  type OpenCodeSettings,
  type ServerProviderModel,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { createModelCapabilities } from "@t3tools/shared/model";
import { compareSemverVersions } from "@t3tools/shared/semver";
import {
  buildServerProvider,
  nonEmptyTrimmed,
  parseGenericCliVersion,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  OPENCODE_CLI_SPEC,
  OpenCodeRuntime,
  openCodeRuntimeErrorDetail,
  type OpenCodeCompatibleCliSpec,
  type OpenCodeInventory,
} from "../opencodeRuntime.ts";
import type { Agent, ProviderListResponse } from "@opencode-ai/sdk/v2";
import * as OpenCodeServerOwner from "../OpenCodeServerOwner.ts";

const OPENCODE_PRESENTATION = {
  displayName: "OpenCode",
  showInteractionModeToggle: false,
} as const;
const OPENCODE_VERSION_PROBE_TIMEOUT = "4 seconds";

class OpenCodeProbeError extends Data.TaggedError("OpenCodeProbeError")<{
  readonly cause?: unknown;
  readonly detail: string;
}> {}

function normalizeProbeMessage(message: string): string | undefined {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (
    trimmed === "An error occurred in Effect.tryPromise" ||
    trimmed === "An error occurred in Effect.try"
  ) {
    return undefined;
  }
  return trimmed;
}

function normalizedErrorMessage(cause: unknown): string | undefined {
  if (cause instanceof OpenCodeProbeError) {
    return normalizeProbeMessage(cause.detail);
  }

  if (!(cause instanceof Error)) {
    return undefined;
  }

  return normalizeProbeMessage(cause.message);
}

function formatOpenCodeProbeError(input: {
  readonly cause: unknown;
  readonly isExternalServer: boolean;
  readonly phase: "version" | "inventory";
  readonly serverUrl: string;
  readonly cliSpec: OpenCodeCompatibleCliSpec;
}): { readonly installed: boolean; readonly message: string } {
  const detail = normalizedErrorMessage(input.cause);
  const lower = detail?.toLowerCase() ?? "";
  const cli = input.cliSpec.displayName;
  const binary = input.cliSpec.defaultBinaryPath;

  if (input.isExternalServer) {
    if (
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden")
    ) {
      return {
        installed: true,
        message: `${cli} server rejected authentication. Check the server URL and password.`,
      };
    }

    if (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("fetch failed") ||
      lower.includes("networkerror") ||
      lower.includes("timed out") ||
      lower.includes("timeout") ||
      lower.includes("socket hang up")
    ) {
      return {
        installed: true,
        message: `Couldn't reach the configured ${cli} server at ${input.serverUrl}. Check that the server is running and the URL is correct.`,
      };
    }

    return {
      installed: true,
      message: detail ?? `Failed to connect to the configured ${cli} server.`,
    };
  }

  if (lower.includes("enoent") || lower.includes("notfound")) {
    return {
      installed: false,
      message: `${cli} CLI (\`${binary}\`) is not installed or not on PATH.`,
    };
  }

  if (lower.includes("quarantine")) {
    return {
      installed: true,
      message: `macOS is blocking the ${cli} binary (quarantine). Run \`xattr -d com.apple.quarantine $(which ${binary})\` to fix this.`,
    };
  }

  if (lower.includes("invalid code signature") || lower.includes("corrupted")) {
    return {
      installed: true,
      message: `macOS killed the ${cli} process due to an invalid code signature. The binary may be corrupted — try reinstalling ${cli}.`,
    };
  }

  const failureLabel =
    input.phase === "inventory"
      ? `Failed to load ${cli} provider inventory`
      : `Failed to execute ${cli} CLI health check`;
  return {
    installed: true,
    message: detail ? `${failureLabel}: ${detail}` : `${failureLabel}.`,
  };
}

function titleCaseSlug(value: string): string {
  const segments: Array<string> = [];
  for (const segment of value.split(/[-_/]+/)) {
    if (segment.length > 0) {
      segments.push(segment.charAt(0).toUpperCase() + segment.slice(1));
    }
  }
  return segments.join(" ");
}

function inferDefaultVariant(
  providerID: string,
  variants: ReadonlyArray<string>,
): string | undefined {
  if (variants.length === 1) {
    return variants[0];
  }
  if (providerID === "anthropic" || providerID.startsWith("google")) {
    return variants.includes("high") ? "high" : undefined;
  }
  if (providerID === "openai" || providerID === "opencode") {
    return variants.includes("medium") ? "medium" : variants.includes("high") ? "high" : undefined;
  }
  return undefined;
}

function inferDefaultAgent(agents: ReadonlyArray<Agent>): string | undefined {
  return agents.find((agent) => agent.name === "build")?.name ?? agents[0]?.name ?? undefined;
}

const DEFAULT_OPENCODE_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "variant",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      currentValue: "medium",
    },
    {
      id: "agent",
      label: "Agent",
      type: "select",
      options: [
        { id: "build", label: "Build", isDefault: true },
        { id: "plan", label: "Plan" },
      ],
      currentValue: "build",
    },
  ],
});

function openCodeCapabilitiesForModel(input: {
  readonly providerID: string;
  readonly model: ProviderListResponse["all"][number]["models"][string];
  readonly agents: ReadonlyArray<Agent>;
}): ModelCapabilities {
  const rawVariantValues = Object.keys(input.model.variants ?? {});
  // When a model advertises no variants, synthesize the standard reasoning
  // levels so the composer still offers a Reasoning selector (mirrors the
  // Codex/Grok experience where reasoning is always configurable). The set
  // covers the common OpenCode variant spectrum; `inferDefaultVariant`
  // picks the provider-appropriate default (e.g. medium for openai/opencode).
  const variantValues =
    rawVariantValues.length > 0 ? rawVariantValues : ["low", "medium", "high", "xhigh"];
  const defaultVariant = inferDefaultVariant(input.providerID, variantValues);
  const variantOptions = variantValues.map((value) =>
    defaultVariant === value
      ? { id: value, label: titleCaseSlug(value), isDefault: true as const }
      : { id: value, label: titleCaseSlug(value) },
  );
  const primaryAgents = input.agents.filter(
    (agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
  );
  const defaultAgent = inferDefaultAgent(primaryAgents);
  const agentOptions = primaryAgents.map((agent) =>
    defaultAgent === agent.name
      ? { id: agent.name, label: titleCaseSlug(agent.name), isDefault: true as const }
      : { id: agent.name, label: titleCaseSlug(agent.name) },
  );
  return createModelCapabilities({
    optionDescriptors: [
      ...(variantOptions.length > 0
        ? [
            {
              id: "variant",
              label: "Reasoning",
              type: "select" as const,
              options: variantOptions,
              ...(defaultVariant ? { currentValue: defaultVariant } : {}),
            },
          ]
        : []),
      ...(agentOptions.length > 0
        ? [
            {
              id: "agent",
              label: "Agent",
              type: "select" as const,
              options: agentOptions,
              ...(defaultAgent ? { currentValue: defaultAgent } : {}),
            },
          ]
        : []),
    ],
  });
}

function flattenOpenCodeModels(input: OpenCodeInventory): ReadonlyArray<ServerProviderModel> {
  const connected = new Set(input.providerList.connected);
  const models: Array<ServerProviderModel> = [];

  for (const provider of input.providerList.all) {
    if (!connected.has(provider.id)) {
      continue;
    }

    for (const model of Object.values(provider.models)) {
      const name = nonEmptyTrimmed(model.name);
      if (!name) {
        continue;
      }

      const subProvider = nonEmptyTrimmed(provider.name);
      models.push({
        slug: `${provider.id}/${model.id}`,
        name,
        ...(subProvider ? { subProvider } : {}),
        isCustom: false,
        capabilities: openCodeCapabilitiesForModel({
          providerID: provider.id,
          model,
          agents: input.agents,
        }),
      });
    }
  }

  return models.toSorted((left, right) => left.name.localeCompare(right.name));
}

function trimOptional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function flattenOpenCodeSkills(input: OpenCodeInventory): ReadonlyArray<ServerProviderSkill> {
  const skills: ServerProviderSkill[] = [];
  for (const skill of input.skills ?? []) {
    const name = trimOptional(skill.name);
    const path = trimOptional(skill.location);
    if (!name || !path) {
      continue;
    }

    const description = trimOptional(skill.description);
    skills.push({
      name,
      path,
      enabled: true,
      ...(description ? { description, shortDescription: description } : {}),
    });
  }

  return skills.toSorted((left, right) => left.name.localeCompare(right.name));
}

export const makePendingOpenCodeProvider = (
  openCodeSettings: OpenCodeSettings,
  cliSpec: OpenCodeCompatibleCliSpec = OPENCODE_CLI_SPEC,
): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const cli = cliSpec.displayName;
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = providerModelsFromSettings(
      [],
      openCodeSettings.customModels,
      DEFAULT_OPENCODE_MODEL_CAPABILITIES,
    );

    if (!openCodeSettings.enabled) {
      return buildServerProvider({
        presentation: OPENCODE_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message:
            openCodeSettings.serverUrl.trim().length > 0
              ? `${cli} is disabled in Ronin settings. A server URL is configured.`
              : `${cli} is disabled in Ronin settings.`,
        },
      });
    }

    return buildServerProvider({
      presentation: OPENCODE_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: `${cli} provider status has not been checked in this session yet.`,
      },
    });
  });

export const checkOpenCodeProviderStatus = Effect.fn("checkOpenCodeProviderStatus")(function* (
  openCodeSettings: OpenCodeSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  cliSpec: OpenCodeCompatibleCliSpec = OPENCODE_CLI_SPEC,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  OpenCodeRuntime | OpenCodeServerOwner.OpenCodeServerOwner
> {
  const openCodeRuntime = yield* OpenCodeRuntime;
  const serverOwner = yield* OpenCodeServerOwner.OpenCodeServerOwner;
  const cli = cliSpec.displayName;
  const resolvedEnvironment = environment ?? process.env;
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const customModels = openCodeSettings.customModels;
  const isExternalServer = openCodeSettings.serverUrl.trim().length > 0;

  const fallback = (
    cause: unknown,
    version: string | null = null,
    phase: "version" | "inventory" = "version",
  ) => {
    const failure = formatOpenCodeProbeError({
      cause,
      isExternalServer,
      phase,
      serverUrl: openCodeSettings.serverUrl,
      cliSpec,
    });
    return buildServerProvider({
      presentation: OPENCODE_PRESENTATION,
      enabled: openCodeSettings.enabled,
      checkedAt,
      models: providerModelsFromSettings([], customModels, DEFAULT_OPENCODE_MODEL_CAPABILITIES),
      probe: {
        installed: failure.installed,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: failure.message,
      },
    });
  };

  if (!openCodeSettings.enabled) {
    return buildServerProvider({
      presentation: OPENCODE_PRESENTATION,
      enabled: false,
      checkedAt,
      models: providerModelsFromSettings([], customModels, DEFAULT_OPENCODE_MODEL_CAPABILITIES),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: isExternalServer
          ? `${cli} is disabled in Ronin settings. A server URL is configured.`
          : `${cli} is disabled in Ronin settings.`,
      },
    });
  }

  let version: string | null = null;
  if (!isExternalServer) {
    const versionExit = yield* Effect.exit(
      openCodeRuntime
        .runOpenCodeCommand({
          binaryPath: openCodeSettings.binaryPath,
          args: ["--version"],
          environment: resolvedEnvironment,
        })
        .pipe(
          Effect.mapError(
            (cause) => new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
          ),
          Effect.timeoutOrElse({
            duration: OPENCODE_VERSION_PROBE_TIMEOUT,
            orElse: () =>
              Effect.fail(
                new OpenCodeProbeError({
                  detail: `OpenCode CLI version probe timed out after ${OPENCODE_VERSION_PROBE_TIMEOUT}.`,
                }),
              ),
          }),
        ),
    );
    if (versionExit._tag === "Failure") {
      return fallback(Cause.squash(versionExit.cause));
    }
    version = parseGenericCliVersion(versionExit.value.stdout) ?? null;

    const minimumVersion = cliSpec.minimumVersion;
    // A CLI with no known floor is only version-probed for display. Refusing to
    // start because its `--version` output was unreadable would take the whole
    // provider down over a cosmetic field.
    if (minimumVersion !== null) {
      if (!version) {
        return fallback(
          new Error(
            `Unable to determine ${cli} version from \`${cliSpec.defaultBinaryPath} --version\` output. Ronin requires ${cli} v${minimumVersion} or newer.`,
          ),
          null,
        );
      }
      if (compareSemverVersions(version, minimumVersion) < 0) {
        return buildServerProvider({
          presentation: OPENCODE_PRESENTATION,
          enabled: openCodeSettings.enabled,
          checkedAt,
          models: providerModelsFromSettings([], customModels, DEFAULT_OPENCODE_MODEL_CAPABILITIES),
          probe: {
            installed: true,
            version,
            status: "error",
            auth: { status: "unknown" },
            message: `${cli} v${version} is too old. Upgrade to v${minimumVersion} or newer.`,
          },
        });
      }
    }
  }

  const loadInventory = (server: {
    readonly url: string;
    readonly serverPassword?: string;
    readonly version: string;
  }) =>
    openCodeRuntime
      .loadOpenCodeInventory(
        openCodeRuntime.createOpenCodeSdkClient({
          baseUrl: server.url,
          directory: cwd,
          cliSpec,
          ...(server.serverPassword !== undefined ? { serverPassword: server.serverPassword } : {}),
        }),
      )
      .pipe(Effect.map((inventory) => ({ inventory, version: server.version })));
  const inventoryEffect = isExternalServer
    ? openCodeRuntime
        .connectToOpenCodeServer({
          binaryPath: openCodeSettings.binaryPath,
          directory: cwd,
          serverUrl: openCodeSettings.serverUrl,
          environment: resolvedEnvironment,
          cliSpec,
          ...(openCodeSettings.serverPassword
            ? { serverPassword: openCodeSettings.serverPassword }
            : {}),
        })
        .pipe(Effect.flatMap(loadInventory), Effect.scoped)
    : serverOwner.withServer(loadInventory);
  const inventoryExit = yield* Effect.exit(
    inventoryEffect.pipe(
      Effect.mapError(
        (cause) => new OpenCodeProbeError({ cause, detail: openCodeRuntimeErrorDetail(cause) }),
      ),
    ),
  );
  if (inventoryExit._tag === "Failure") {
    return fallback(Cause.squash(inventoryExit.cause), version, "inventory");
  }

  version = inventoryExit.value.version;

  const models = providerModelsFromSettings(
    flattenOpenCodeModels(inventoryExit.value.inventory),
    customModels,
    DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  );
  const skills = flattenOpenCodeSkills(inventoryExit.value.inventory);
  const connectedCount = inventoryExit.value.inventory.providerList.connected.length;
  return buildServerProvider({
    presentation: OPENCODE_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    skills,
    probe: {
      installed: true,
      version,
      status: connectedCount > 0 ? "ready" : "warning",
      auth: {
        status: connectedCount > 0 ? "authenticated" : "unknown",
        type: "opencode",
      },
      message:
        connectedCount > 0
          ? `${connectedCount} upstream provider${connectedCount === 1 ? "" : "s"} connected through ${isExternalServer ? "the configured OpenCode server" : "OpenCode"}.`
          : isExternalServer
            ? "Connected to the configured OpenCode server, but it did not report any connected upstream providers."
            : "OpenCode is available, but it did not report any connected upstream providers.",
    },
  });
});

// @effect-diagnostics nodeBuiltinImport:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  type ModelCapabilities,
  type PiSettings,
  type ServerProviderModel,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import { loadPiCodingAgentModule } from "../piRuntime.ts";
import { collectSkillsFromRoots, nativeSkillRootsForProvider } from "../skillsCatalog.ts";

const PI_PRESENTATION = {
  displayName: "Pi",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: false,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const RUNTIME_PROBE_TIMEOUT_MS = 4_000;

const PI_BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [];

function piModelsFromSettings(
  customModels: ReadonlyArray<string> | undefined,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(PI_BUILT_IN_MODELS, customModels ?? [], EMPTY_CAPABILITIES);
}

export function buildInitialPiProviderSnapshot(
  settings: PiSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = piModelsFromSettings(settings.customModels);
    if (!settings.enabled) {
      return buildServerProvider({
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi is disabled in Ronin settings.",
        },
      });
    }
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Pi coding agent availability...",
      },
    });
  });
}

/**
 * Skills Pi loads for itself, so the reactor stops inlining them into the
 * prompt on top of what the agent already read from `~/.pi/agent/skills`.
 */
const discoverPiSkills = (
  settings: PiSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string | undefined,
) => {
  const roots = nativeSkillRootsForProvider("pi", {
    homeDir: environment.HOME ?? NodeOS.homedir(),
    ...(cwd ? { cwd } : {}),
  });
  // `agentDir` names the agent directory itself, not a home to derive one from,
  // so a configured one replaces the default `~/.pi/agent` root rather than
  // being joined onto it.
  const agentDir = settings.agentDir.trim();
  const resolvedRoots = agentDir
    ? [
        ...roots.filter((root) => root.scope === "project"),
        { path: NodePath.join(agentDir, "skills"), scope: "pi" },
      ]
    : roots;
  return Effect.tryPromise(() => collectSkillsFromRoots(resolvedRoots)).pipe(
    Effect.orElseSucceed((): ReadonlyArray<ServerProviderSkill> => []),
  );
};

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  settings: PiSettings,
  environment: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = piModelsFromSettings(settings.customModels);

  if (!settings.enabled) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi is disabled in Ronin settings.",
      },
    });
  }

  // Only after the enabled check: a provider the user turned off should not
  // be walking the filesystem on every health refresh.
  const skills = yield* discoverPiSkills(settings, environment, cwd);

  // Sessions never spawn the CLI — `PiAdapter` imports the coding-agent module
  // in-process. Whether that import resolves is the only thing that decides if
  // a session can start, so it decides the card too. `pi --version` is asked
  // afterwards, for a version string and nothing else.
  const runtimeResult = yield* Effect.tryPromise(() => loadPiCodingAgentModule()).pipe(
    Effect.timeoutOption(RUNTIME_PROBE_TIMEOUT_MS),
    Effect.result,
  );
  const runtimeReady = Result.isSuccess(runtimeResult) && Option.isSome(runtimeResult.success);

  if (!runtimeReady) {
    yield* Effect.logWarning("Pi coding-agent runtime is unavailable", {
      errorTag: Result.isFailure(runtimeResult) ? runtimeResult.failure._tag : "timeout",
    });
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: Result.isFailure(runtimeResult)
          ? "Pi coding agent is not installed. Add `@earendil-works/pi-coding-agent` to this environment."
          : "Pi coding agent timed out while loading.",
      },
    });
  }

  const command = settings.binaryPath || "pi";
  const versionResult = yield* Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], { env: environment });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  }).pipe(Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS), Effect.result);

  // The CLI is optional next to the library, so a missing or slow `pi` binary
  // only costs the version string. The runtime already answered the question
  // that matters.
  const versionOutput =
    Result.isSuccess(versionResult) && Option.isSome(versionResult.success)
      ? versionResult.success.value
      : undefined;
  const version =
    versionOutput && versionOutput.code === 0
      ? parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`)
      : null;

  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: fallbackModels,
    skills,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "unknown" },
    },
  });
});

export const enrichPiSnapshot = (input: {
  readonly snapshot: import("@t3tools/contracts").ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (
    snapshot: import("@t3tools/contracts").ServerProvider,
  ) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> =>
  enrichProviderSnapshotWithVersionAdvisory(input.snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) => input.publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Pi version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );

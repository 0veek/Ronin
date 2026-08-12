/**
 * Droid ACP support — builds Factory Droid `droid exec --output-format acp`
 * and applies model / reasoning / mode over session config options.
 *
 * @module DroidAcpSupport
 */
// @effect-diagnostics nodeBuiltinImport:off
import { existsSync } from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";

import { type DroidSettings, ProviderDriverKind } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";

export const DROID_DRIVER_KIND = ProviderDriverKind.make("droid");
const DROID_MODEL_CONFIG_ID = "model";
const DROID_REASONING_EFFORT_CONFIG_ID = "reasoning_effort";
const DROID_AUTONOMY_CONFIG_ID = "autonomy_level";
const DROID_DEFAULT_MODE_ID = "normal";
const DROID_PLAN_MODE_ID = "spec";
const DROID_API_KEY_AUTH_METHOD_ID = "factory-api-key";
const DROID_DEVICE_PAIRING_AUTH_METHOD_ID = "device-pairing";
const DROID_API_KEY_ENV_KEYS = ["FACTORY_API_KEY"] as const;

export interface DroidAcpRuntimeSettings {
  readonly appendSystemPrompt?: string;
  readonly binaryPath?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
}

export interface DroidAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly droidSettings: DroidAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export function getDroidApiKeyEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of DROID_API_KEY_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function hasDroidApiKeyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return getDroidApiKeyEnv(env) !== undefined;
}

/** Honors PATH first, then falls back to Factory's common `~/.local/bin` install. */
export function resolveDroidCliBinaryPath(binaryPath?: string | null): string {
  const configured = binaryPath?.trim();
  if (configured) {
    return configured;
  }
  const name = "droid";
  const searchPath = process.env.PATH ?? "";
  for (const directory of searchPath.split(nodePath.delimiter)) {
    if (!directory.trim()) {
      continue;
    }
    const candidate = nodePath.join(directory, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  if (process.platform !== "win32") {
    const localBin = nodePath.join(nodeOs.homedir(), ".local", "bin", name);
    if (existsSync(localBin)) {
      return localBin;
    }
  }
  return name;
}

export function buildDroidAcpSpawnInput(
  droidSettings: DroidAcpRuntimeSettings | null | undefined,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  const args = ["exec", "--output-format", "acp"];
  const appendSystemPrompt = droidSettings?.appendSystemPrompt?.trim();
  if (appendSystemPrompt) {
    args.push("--append-system-prompt", appendSystemPrompt);
  }
  const model = droidSettings?.model?.trim();
  if (model) {
    args.push("-m", model);
  }
  const reasoningEffort = droidSettings?.reasoningEffort?.trim();
  if (reasoningEffort) {
    args.push("-r", reasoningEffort);
  }

  return {
    command: resolveDroidCliBinaryPath(droidSettings?.binaryPath),
    args,
    cwd,
    ...(environment ? { env: environment } : {}),
  };
}

export function resolveDroidAcpAuthMethodId(environment?: NodeJS.ProcessEnv): string {
  return hasDroidApiKeyEnv(environment)
    ? DROID_API_KEY_AUTH_METHOD_ID
    : DROID_DEVICE_PAIRING_AUTH_METHOD_ID;
}

export const makeDroidAcpRuntime = (
  input: DroidAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildDroidAcpSpawnInput(input.droidSettings, input.cwd, input.environment),
        authMethodId: resolveDroidAcpAuthMethodId(input.environment),
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
  });

export interface DroidAcpModelSelectionErrorContext {
  readonly cause: EffectAcpErrors.AcpError;
  readonly method: "session/set_config_option";
}

export function resolveDroidAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "claude-opus-4-8";
}

export function currentDroidModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

export function applyDroidAcpConfigSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setConfigOption">;
  readonly model: string;
  readonly reasoningEffort?: string | null | undefined;
  readonly mapError: (context: DroidAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    const mapError = (cause: EffectAcpErrors.AcpError) =>
      input.mapError({ cause, method: "session/set_config_option" });
    const model = input.model.trim();
    if (model) {
      yield* input.runtime
        .setConfigOption(DROID_MODEL_CONFIG_ID, model)
        .pipe(Effect.mapError(mapError));
    }
    const reasoningEffort = input.reasoningEffort?.trim();
    if (reasoningEffort) {
      yield* input.runtime
        .setConfigOption(DROID_REASONING_EFFORT_CONFIG_ID, reasoningEffort)
        .pipe(Effect.mapError(mapError));
    }
  });
}

export function applyDroidAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setConfigOption">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly reasoningEffort?: string | null | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel && !input.reasoningEffort?.trim()) {
    return Effect.succeed(input.currentModelId);
  }
  return applyDroidAcpConfigSelection({
    runtime: input.runtime,
    model: input.requestedModelId ?? input.currentModelId ?? "",
    reasoningEffort: input.reasoningEffort,
    mapError: (context) => input.mapError(context.cause),
  }).pipe(Effect.as(input.requestedModelId ?? input.currentModelId));
}

export function applyDroidAcpInteractionMode<E>(input: {
  readonly runtime: Pick<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    "setConfigOption" | "setMode"
  >;
  readonly interactionMode?: "plan" | "default" | string;
  readonly runtimeMode?: "approval-required" | "full-access";
  readonly mapError: (context: DroidAcpModelSelectionErrorContext) => E;
}): Effect.Effect<void, E> {
  const modeId =
    input.interactionMode === "plan"
      ? DROID_PLAN_MODE_ID
      : input.runtimeMode === "full-access"
        ? "auto-high"
        : DROID_DEFAULT_MODE_ID;
  return input.runtime.setMode(modeId).pipe(
    Effect.catch(() => input.runtime.setConfigOption(DROID_AUTONOMY_CONFIG_ID, modeId)),
    Effect.mapError((cause) => input.mapError({ cause, method: "session/set_config_option" })),
    Effect.asVoid,
  );
}

export function droidSettingsToRuntimeSettings(
  settings: Pick<DroidSettings, "binaryPath"> | null | undefined,
): DroidAcpRuntimeSettings {
  return {
    ...(settings?.binaryPath ? { binaryPath: settings.binaryPath } : {}),
  };
}

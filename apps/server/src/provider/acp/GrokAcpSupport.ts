/**
 * Grok ACP support — builds the Grok Build stdio command and resolves auth.
 *
 * Synara's working Grok path uses process-start flags (`--no-leader`,
 * permission mode, model, effort) and inspects advertised ACP auth methods
 * after initialize. Grok Build still has no `session/set_config_option`, so
 * reasoning effort is bound on the spawn line and a change to it needs a new
 * session; the model itself switches in place through `session/set_model`.
 *
 * @module GrokAcpSupport
 */
import { type GrokSettings, ProviderDriverKind, type RuntimeMode } from "@t3tools/contracts";
import { normalizeModelSlug } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import * as AcpSessionRuntime from "./AcpSessionRuntime.ts";
import { makeXAiPromptCompletionRuntime } from "./XAiAcpExtension.ts";

const GROK_OAUTH2_REFERRER_ENV = "GROK_OAUTH2_REFERRER";
const RONIN_OAUTH_REFERRER = "ronin";
const GROK_API_KEY_AUTH_METHOD_ID = "xai.api_key";
const GROK_CACHED_TOKEN_AUTH_METHOD_ID = "cached_token";
const GROK_INTERACTIVE_AUTH_METHOD_IDS = new Set(["browser_login", "grok.com"]);
const GROK_API_KEY_ENV_KEYS = ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"] as const;
const GROK_SESSION_STORAGE_NOT_FOUND_CODE = "FS_NOT_FOUND";
const GROK_SESSION_STORAGE_RETRY_DELAY_MS = 100;
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");

export interface GrokAcpRuntimeSettings {
  readonly binaryPath?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  /**
   * Let the agent finish without a human, confined to read-only OS access.
   *
   * One-shot text generation (commit messages, PR bodies, branch names) wants
   * a direct reply, but Grok Build always answers with an agentic loop: it
   * opens `run_terminal_cmd`/`read_file` calls to inspect the repo first.
   * Those raise ACP permission requests that a headless caller cannot answer,
   * and both leaving them unanswered and rejecting them end the turn as
   * `cancelled` with only the "I'll inspect the staged change" preamble
   * emitted — which then fails JSON decoding.
   *
   * The `--tools`/`--disallowed-tools` filters are not an option here: Grok
   * applies them to `agent headless` only, not to `agent stdio`. Approving is
   * what actually completes the turn, so the blast radius is capped with the
   * `read-only` sandbox instead — reads anywhere, writes nowhere, no child
   * network.
   */
  readonly unattendedReadOnly?: boolean;
}

export interface GrokAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "freshSessionRetry" | "resolveAuthMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly grokSettings: GrokAcpRuntimeSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeMode: RuntimeMode;
}

export function isGrokSessionStoragePathNotFoundError(error: EffectAcpErrors.AcpError): boolean {
  if (error._tag !== "AcpRequestError" || typeof error.data !== "object" || error.data === null) {
    return false;
  }
  return (error.data as { readonly code?: unknown }).code === GROK_SESSION_STORAGE_NOT_FOUND_CODE;
}

/**
 * Whether a failed ACP startup was Grok telling us nobody is signed in.
 *
 * `resolveGrokAcpAuthMethodId` is the only thing that stamps
 * `reason: "credentials_missing"`, so this separates "run `grok login`" from
 * every other way the agent can fail to come up. The provider probe reports
 * the first as an authentication state and the second as a startup error.
 */
export function isGrokCredentialsMissingError(error: EffectAcpErrors.AcpError): boolean {
  if (error._tag !== "AcpRequestError" || typeof error.data !== "object" || error.data === null) {
    return false;
  }
  return (error.data as { readonly reason?: unknown }).reason === "credentials_missing";
}

/** How a resolved auth method reads on the provider card. */
export function describeGrokAuthMethod(authMethodId: string): string | undefined {
  switch (authMethodId) {
    case GROK_API_KEY_AUTH_METHOD_ID:
      return "API key";
    case GROK_CACHED_TOKEN_AUTH_METHOD_ID:
      return "CLI login";
    default:
      return undefined;
  }
}

export function getGrokApiKeyEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of GROK_API_KEY_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function hasGrokApiKeyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return getGrokApiKeyEnv(env) !== undefined;
}

export function buildGrokAcpSpawnInput(
  grokSettings: GrokAcpRuntimeSettings | null | undefined,
  cwd: string,
  runtimeMode: RuntimeMode,
  environment?: NodeJS.ProcessEnv,
): AcpSessionRuntime.AcpSpawnInput {
  // Keep Grok's request-based mode as the explicit baseline. Full Access also
  // needs the process-scoped override because some Grok builds deny before
  // emitting an ACP permission request.
  const args = ["--permission-mode", "default"];
  // `--sandbox` is process-scoped, so it has to precede the `agent` subcommand.
  const unattendedReadOnly = grokSettings?.unattendedReadOnly === true;
  if (unattendedReadOnly) {
    args.push("--sandbox", "read-only");
  }
  args.push("agent", "--no-leader");
  if (runtimeMode === "full-access" || unattendedReadOnly) {
    args.push("--always-approve");
  }
  const model = grokSettings?.model?.trim();
  if (model) {
    args.push("-m", model);
  }
  const reasoningEffort = grokSettings?.reasoningEffort?.trim();
  if (reasoningEffort) {
    args.push("--reasoning-effort", reasoningEffort);
  }
  args.push("stdio");

  return {
    command: grokSettings?.binaryPath || "grok",
    args,
    cwd,
    env: {
      ...environment,
      [GROK_OAUTH2_REFERRER_ENV]: RONIN_OAUTH_REFERRER,
    },
  };
}

function availableAuthMethodIds(
  initializeResult: EffectAcpSchema.InitializeResponse,
): ReadonlySet<string> {
  return new Set(
    (initializeResult.authMethods ?? [])
      .map((method) => method.id.trim())
      .filter((methodId) => methodId.length > 0),
  );
}

function describeAuthMethodIds(authMethodIds: ReadonlySet<string>): string {
  return authMethodIds.size > 0 ? [...authMethodIds].join(", ") : "none";
}

export const resolveGrokAcpAuthMethodId = (
  initializeResult: EffectAcpSchema.InitializeResponse,
  environment?: NodeJS.ProcessEnv,
): Effect.Effect<string, EffectAcpErrors.AcpError> =>
  Effect.gen(function* () {
    const authMethodIds = availableAuthMethodIds(initializeResult);
    const hasApiKey = hasGrokApiKeyEnv(environment);
    if (hasApiKey && authMethodIds.has(GROK_API_KEY_AUTH_METHOD_ID)) {
      return GROK_API_KEY_AUTH_METHOD_ID;
    }
    if (authMethodIds.has(GROK_CACHED_TOKEN_AUTH_METHOD_ID) || authMethodIds.size === 0) {
      // Empty advertisements match older Grok builds and the ACP mock agent.
      return GROK_CACHED_TOKEN_AUTH_METHOD_ID;
    }
    const advertised = describeAuthMethodIds(authMethodIds);
    if (!hasApiKey && authMethodIds.has(GROK_API_KEY_AUTH_METHOD_ID)) {
      return yield* new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage:
          "Grok ACP requires API-key authentication, but XAI_API_KEY is not set. Set XAI_API_KEY and restart Ronin, or run `grok login` to create a cached login.",
        data: { authMethods: [...authMethodIds], reason: "credentials_missing" },
      });
    }
    if (
      !hasApiKey &&
      authMethodIds.size > 0 &&
      [...authMethodIds].every((methodId) => GROK_INTERACTIVE_AUTH_METHOD_IDS.has(methodId))
    ) {
      return yield* new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: `Grok is not authenticated for headless ACP. Run \`grok login\` (or launch \`grok\`) and retry. Grok advertised only interactive auth methods: ${advertised}.`,
        data: { authMethods: [...authMethodIds], reason: "credentials_missing" },
      });
    }
    if (hasApiKey && !authMethodIds.has(GROK_API_KEY_AUTH_METHOD_ID)) {
      return yield* new EffectAcpErrors.AcpRequestError({
        code: -32602,
        errorMessage: `Grok did not advertise API-key authentication even though XAI_API_KEY is set (advertised: ${advertised}). Update Grok or check its login policy, then restart Ronin.`,
        data: { authMethods: [...authMethodIds], reason: "compatibility_mismatch" },
      });
    }
    return yield* new EffectAcpErrors.AcpRequestError({
      code: -32602,
      errorMessage: `Grok ACP advertised no supported headless authentication method (advertised: ${advertised}). Ronin supports cached_token and xai.api_key; update Grok and retry.`,
      data: {
        authMethods: [...authMethodIds],
        reason: "compatibility_mismatch",
      },
    });
  });

export const makeGrokAcpRuntime = (
  input: GrokAcpRuntimeInput,
): Effect.Effect<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildGrokAcpSpawnInput(
          input.grokSettings,
          input.cwd,
          input.runtimeMode,
          input.environment,
        ),
        resolveAuthMethodId: (initializeResult) =>
          resolveGrokAcpAuthMethodId(initializeResult, input.environment),
        authenticateMeta: { headless: true },
        freshSessionRetry: {
          shouldRetry: isGrokSessionStoragePathNotFoundError,
          delayMs: GROK_SESSION_STORAGE_RETRY_DELAY_MS,
        },
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(acpContext),
    );
    return yield* makeXAiPromptCompletionRuntime(runtime);
  });

/**
 * Returns undefined rather than a placeholder id when nothing is selected.
 *
 * This used to fall back to `grok-build`, a slug the installed CLI no longer
 * offers — Grok silently ignored the resulting `-m grok-build` and ran its own
 * default, so the fabricated id only served to hide that. Omitting `-m` asks
 * for that same default honestly, and keeps the model list the CLI advertises
 * as the single source of truth.
 */
export function resolveGrokAcpBaseModelId(model: string | null | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed) {
    return undefined;
  }
  return normalizeModelSlug(trimmed, GROK_DRIVER_KIND) ?? undefined;
}

export function currentGrokModelIdFromSessionSetup(
  sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): string | undefined {
  return sessionSetupResult.models?.currentModelId?.trim() || undefined;
}

/**
 * Switches the live session's model, and reports the one now answering.
 *
 * Grok Build 1.x implements `session/set_model`: the switch takes effect for
 * the next prompt, verified against grok 1.0.4 where a session opened on
 * `grok-4.5` billed its turn to `grok-4.6-build` after the call. It still has
 * no `session/set_config_option`, so reasoning effort stays a spawn-line flag
 * and only a session restart can change it.
 */
export function applyGrokAcpModelSelection<E>(input: {
  readonly runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "setSessionModel">;
  readonly currentModelId: string | undefined;
  readonly requestedModelId: string | undefined;
  readonly mapError: (cause: EffectAcpErrors.AcpError) => E;
}): Effect.Effect<string | undefined, E> {
  const shouldSwitchModel =
    input.requestedModelId !== undefined && input.requestedModelId !== input.currentModelId;
  if (!shouldSwitchModel) {
    return Effect.succeed(input.currentModelId);
  }
  return input.runtime
    .setSessionModel(input.requestedModelId)
    .pipe(Effect.mapError(input.mapError), Effect.as(input.requestedModelId));
}

export function grokSettingsToRuntimeSettings(
  settings: Pick<GrokSettings, "binaryPath">,
  extras?: {
    readonly model?: string;
    readonly reasoningEffort?: string;
  },
): GrokAcpRuntimeSettings {
  return {
    binaryPath: settings.binaryPath,
    ...(extras?.model ? { model: extras.model } : {}),
    ...(extras?.reasoningEffort ? { reasoningEffort: extras.reasoningEffort } : {}),
  };
}

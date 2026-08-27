import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  applyGrokAcpModelSelection,
  buildGrokAcpSpawnInput,
  describeGrokAuthMethod,
  isGrokCredentialsMissingError,
  isGrokSessionStoragePathNotFoundError,
  isValidGrokReasoningEffortToken,
  resolveGrokAcpAuthMethodId,
  resolveGrokAcpBaseModelId,
} from "./GrokAcpSupport.ts";

function initializeWithAuthMethods(ids: ReadonlyArray<string>): EffectAcpSchema.InitializeResponse {
  return {
    protocolVersion: 1,
    authMethods: ids.map((id) => ({ id, name: id })),
  };
}

describe("resolveGrokAcpBaseModelId", () => {
  it("normalizes empty and custom Grok model ids", () => {
    // No placeholder id: Grok drops an unknown `-m` and runs its own default,
    // so a fabricated slug would only hide which model actually answered.
    expect(resolveGrokAcpBaseModelId(undefined)).toBeUndefined();
    expect(resolveGrokAcpBaseModelId("   ")).toBeUndefined();
    expect(resolveGrokAcpBaseModelId("  grok-test-custom-model  ")).toBe("grok-test-custom-model");
  });
});

describe("buildGrokAcpSpawnInput", () => {
  it("builds the Synara-compatible Grok ACP command", () => {
    const spawn = buildGrokAcpSpawnInput(
      { binaryPath: "/usr/local/bin/grok" },
      "/tmp/project",
      "approval-required",
      {
        XAI_API_KEY: "secret",
        GROK_OAUTH2_REFERRER: "other-client",
      },
    );

    expect(spawn).toEqual({
      command: "/usr/local/bin/grok",
      args: ["--permission-mode", "default", "agent", "--no-leader", "stdio"],
      cwd: "/tmp/project",
      env: {
        XAI_API_KEY: "secret",
        GROK_OAUTH2_REFERRER: "ronin",
      },
    });
  });

  it("passes model and reasoning effort without process-wide approval overrides", () => {
    const spawn = buildGrokAcpSpawnInput(
      {
        binaryPath: "/usr/local/bin/grok",
        model: "grok-build",
        reasoningEffort: "high",
      },
      "/tmp/project",
      "approval-required",
    );

    expect(spawn.args).toEqual([
      "--permission-mode",
      "default",
      "agent",
      "--no-leader",
      "-m",
      "grok-build",
      "--reasoning-effort",
      "high",
      "stdio",
    ]);
    expect(spawn.args).not.toContain("--always-approve");
  });

  it("auto-approves inside a read-only sandbox when nobody can answer permission requests", () => {
    const spawn = buildGrokAcpSpawnInput(
      { binaryPath: "/usr/local/bin/grok", model: "grok-build", unattendedReadOnly: true },
      "/tmp/project",
      "approval-required",
    );

    // `--sandbox` is process-scoped and has to land before `agent`, while
    // `--always-approve` belongs to the subcommand.
    expect(spawn.args).toEqual([
      "--permission-mode",
      "default",
      "--sandbox",
      "read-only",
      "agent",
      "--no-leader",
      "--always-approve",
      "-m",
      "grok-build",
      "stdio",
    ]);
  });

  it("leaves interactive sessions unsandboxed", () => {
    expect(
      buildGrokAcpSpawnInput({ binaryPath: "grok" }, "/tmp/project", "full-access").args,
    ).not.toContain("--sandbox");
  });

  it("uses Grok's process-scoped approval override only for Full Access", () => {
    expect(buildGrokAcpSpawnInput(undefined, "/tmp/project", "full-access").args).toEqual([
      "--permission-mode",
      "default",
      "agent",
      "--no-leader",
      "--always-approve",
      "stdio",
    ]);
  });

  it("gives Grok the mode the thread is actually in", () => {
    // Always explicit, so a user's own `always-approve` Grok config cannot
    // quietly upgrade a Supervised thread.
    const modeFor = (runtimeMode: Parameters<typeof buildGrokAcpSpawnInput>[2]) =>
      buildGrokAcpSpawnInput(undefined, "/tmp/project", runtimeMode).args[1];

    expect(modeFor("approval-required")).toBe("default");
    expect(modeFor("auto-accept-edits")).toBe("acceptEdits");
    expect(modeFor("auto")).toBe("auto");
    // Full Access is the `--always-approve` flag, not a permission mode.
    expect(modeFor("full-access")).toBe("default");
  });
});

describe("isValidGrokReasoningEffortToken", () => {
  it("accepts future ACP tokens and rejects malformed metadata values", () => {
    expect(isValidGrokReasoningEffortToken("xhigh")).toBe(true);
    expect(isValidGrokReasoningEffortToken("turbo_v2")).toBe(true);
    expect(isValidGrokReasoningEffortToken("not a token")).toBe(false);
    expect(isValidGrokReasoningEffortToken("-leading-dash")).toBe(false);
    expect(isValidGrokReasoningEffortToken("x".repeat(33))).toBe(false);
  });
});

describe("isGrokSessionStoragePathNotFoundError", () => {
  it("matches Grok's stable persistence code", () => {
    expect(
      isGrokSessionStoragePathNotFoundError(
        new EffectAcpErrors.AcpRequestError({
          code: -32603,
          errorMessage: "Path not found.",
          data: { code: "FS_NOT_FOUND", detail: "No such file or directory (os error 2)" },
        }),
      ),
    ).toBe(true);
  });

  it("does not retry other ACP or filesystem failures", () => {
    expect(
      isGrokSessionStoragePathNotFoundError(
        new EffectAcpErrors.AcpRequestError({
          code: -32603,
          errorMessage: "Permission denied.",
          data: { code: "FS_PERMISSION_DENIED" },
        }),
      ),
    ).toBe(false);
    expect(
      isGrokSessionStoragePathNotFoundError(
        new EffectAcpErrors.AcpTransportError({
          detail: "connection closed",
          cause: new Error("connection closed"),
        }),
      ),
    ).toBe(false);
  });
});

describe("resolveGrokAcpAuthMethodId", () => {
  it.effect("prefers the xAI API key auth method when XAI_API_KEY is present", () =>
    Effect.gen(function* () {
      const method = yield* resolveGrokAcpAuthMethodId(
        initializeWithAuthMethods(["cached_token", "xai.api_key"]),
        { XAI_API_KEY: "xai-test-key" },
      );
      expect(method).toBe("xai.api_key");
    }),
  );

  it.effect("still accepts the legacy Grok API key env var", () =>
    Effect.gen(function* () {
      const method = yield* resolveGrokAcpAuthMethodId(
        initializeWithAuthMethods(["cached_token", "xai.api_key"]),
        { GROK_CODE_XAI_API_KEY: "xai-test-key" },
      );
      expect(method).toBe("xai.api_key");
    }),
  );

  it.effect("falls back to cached token auth when no API key is configured", () =>
    Effect.gen(function* () {
      const method = yield* resolveGrokAcpAuthMethodId(
        initializeWithAuthMethods(["cached_token", "xai.api_key"]),
        {},
      );
      expect(method).toBe("cached_token");
    }),
  );

  it.effect("identifies an interactive-only advertisement as missing headless credentials", () =>
    Effect.gen(function* () {
      const error = yield* resolveGrokAcpAuthMethodId(
        initializeWithAuthMethods(["browser_login"]),
        {},
      ).pipe(Effect.flip);
      expect(error).toBeInstanceOf(EffectAcpErrors.AcpRequestError);
      expect(error.message).toContain("not authenticated for headless ACP");
      expect(error.message).toContain("browser_login");
    }),
  );

  it.effect("uses cached token when Grok advertises no auth methods", () =>
    Effect.gen(function* () {
      const method = yield* resolveGrokAcpAuthMethodId(initializeWithAuthMethods([]), {});
      expect(method).toBe("cached_token");
    }),
  );

  it.effect("explains when an advertised API-key method has no configured key", () =>
    Effect.gen(function* () {
      const error = yield* resolveGrokAcpAuthMethodId(
        initializeWithAuthMethods(["xai.api_key"]),
        {},
      ).pipe(Effect.flip);
      expect(error.message).toContain("XAI_API_KEY is not set");
    }),
  );
});

describe("isGrokCredentialsMissingError", () => {
  it.effect("separates a sign-in failure from any other startup failure", () =>
    Effect.gen(function* () {
      const signedOut = yield* resolveGrokAcpAuthMethodId(
        initializeWithAuthMethods(["browser_login"]),
        {},
      ).pipe(Effect.flip);
      expect(isGrokCredentialsMissingError(signedOut)).toBe(true);

      const staleBuild = yield* resolveGrokAcpAuthMethodId(
        initializeWithAuthMethods(["something_new"]),
        { XAI_API_KEY: "xai-test-key" },
      ).pipe(Effect.flip);
      expect(isGrokCredentialsMissingError(staleBuild)).toBe(false);

      expect(
        isGrokCredentialsMissingError(
          new EffectAcpErrors.AcpProcessExitedError({ code: 1, cause: "boom" }),
        ),
      ).toBe(false);
    }),
  );
});

describe("describeGrokAuthMethod", () => {
  it("names the credential the provider card shows", () => {
    expect(describeGrokAuthMethod("xai.api_key")).toBe("API key");
    expect(describeGrokAuthMethod("cached_token")).toBe("CLI login");
    expect(describeGrokAuthMethod("browser_login")).toBeUndefined();
  });
});

describe("applyGrokAcpModelSelection", () => {
  it.effect("switches the live session to the requested model", () =>
    Effect.gen(function* () {
      const modelCalls: Array<string> = [];
      const result = yield* applyGrokAcpModelSelection({
        runtime: {
          setSessionModel: (modelId: string) =>
            Effect.sync(() => {
              modelCalls.push(modelId);
              return {};
            }),
        },
        currentModelId: "grok-4.5",
        requestedModelId: "grok-4.6",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual(["grok-4.6"]);
      expect(result).toBe("grok-4.6");
    }),
  );

  it.effect("does not re-send a switch to the model already running", () =>
    Effect.gen(function* () {
      const modelCalls: Array<string> = [];
      const result = yield* applyGrokAcpModelSelection({
        runtime: {
          setSessionModel: (modelId: string) =>
            Effect.sync(() => {
              modelCalls.push(modelId);
              return {};
            }),
        },
        currentModelId: "grok-4.6",
        requestedModelId: "grok-4.6",
        mapError: (cause) => cause.message,
      });
      expect(modelCalls).toEqual([]);
      expect(result).toBe("grok-4.6");
    }),
  );

  it.effect("keeps the current model when none is requested", () =>
    Effect.gen(function* () {
      const result = yield* applyGrokAcpModelSelection({
        runtime: {
          setSessionModel: () => Effect.succeed({}),
        },
        currentModelId: "grok-build",
        requestedModelId: undefined,
        mapError: (cause) => cause.message,
      });
      expect(result).toBe("grok-build");
    }),
  );
});

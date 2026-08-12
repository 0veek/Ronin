import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as EffectAcpErrors from "effect-acp/errors";

import {
  applyDroidAcpModelSelection,
  buildDroidAcpSpawnInput,
  resolveDroidAcpAuthMethodId,
  resolveDroidAcpBaseModelId,
  resolveDroidCliBinaryPath,
} from "./DroidAcpSupport.ts";

describe("resolveDroidAcpBaseModelId", () => {
  it("falls back to Claude Opus 4.8 and trims custom slugs", () => {
    expect(resolveDroidAcpBaseModelId(undefined)).toBe("claude-opus-4-8");
    expect(resolveDroidAcpBaseModelId("   ")).toBe("claude-opus-4-8");
    expect(resolveDroidAcpBaseModelId("  claude-sonnet-5  ")).toBe("claude-sonnet-5");
  });
});

describe("buildDroidAcpSpawnInput", () => {
  it("builds the default Droid ACP command", () => {
    const spawn = buildDroidAcpSpawnInput({ binaryPath: "/usr/local/bin/droid" }, "/tmp/project");
    expect(spawn).toEqual({
      command: "/usr/local/bin/droid",
      args: ["exec", "--output-format", "acp"],
      cwd: "/tmp/project",
    });
  });

  it("passes model, reasoning effort, and an appended system prompt", () => {
    const spawn = buildDroidAcpSpawnInput(
      {
        appendSystemPrompt: "Run validators serially.",
        binaryPath: "/usr/local/bin/droid",
        model: "claude-opus-4-8",
        reasoningEffort: "high",
      },
      "/tmp/project",
    );

    expect(spawn.command).toBe("/usr/local/bin/droid");
    expect(spawn.args).toEqual([
      "exec",
      "--output-format",
      "acp",
      "--append-system-prompt",
      "Run validators serially.",
      "-m",
      "claude-opus-4-8",
      "-r",
      "high",
    ]);
    expect(spawn.cwd).toBe("/tmp/project");
  });
});

describe("resolveDroidAcpAuthMethodId", () => {
  it("prefers the Factory API key when FACTORY_API_KEY is set", () => {
    expect(resolveDroidAcpAuthMethodId({ FACTORY_API_KEY: "secret" })).toBe("factory-api-key");
    expect(resolveDroidAcpAuthMethodId({})).toBe("device-pairing");
  });
});

describe("resolveDroidCliBinaryPath", () => {
  it("returns a configured path unchanged", () => {
    expect(resolveDroidCliBinaryPath("/opt/factory/droid")).toBe("/opt/factory/droid");
  });
});

describe("applyDroidAcpModelSelection", () => {
  const makeRecordingRuntime = (failure?: EffectAcpErrors.AcpError) => {
    const calls: Array<{ configId: string; value: string | boolean }> = [];
    const runtime = {
      setConfigOption: (configId: string, value: string | boolean) =>
        failure
          ? Effect.fail(failure)
          : Effect.sync(() => {
              calls.push({ configId, value });
              return {};
            }),
    };
    return { runtime, calls };
  };

  it.effect("sets model and reasoning effort when they change", () =>
    Effect.gen(function* () {
      const { runtime, calls } = makeRecordingRuntime();
      const result = yield* applyDroidAcpModelSelection({
        runtime: runtime as Parameters<typeof applyDroidAcpModelSelection>[0]["runtime"],
        currentModelId: "auto",
        requestedModelId: "claude-opus-4-8",
        reasoningEffort: "high",
        mapError: (cause) => cause.message,
      });
      expect(calls).toEqual([
        { configId: "model", value: "claude-opus-4-8" },
        { configId: "reasoning_effort", value: "high" },
      ]);
      expect(result).toBe("claude-opus-4-8");
    }),
  );

  it.effect("skips config writes when the requested model already matches", () =>
    Effect.gen(function* () {
      const { runtime, calls } = makeRecordingRuntime();
      const result = yield* applyDroidAcpModelSelection({
        runtime: runtime as Parameters<typeof applyDroidAcpModelSelection>[0]["runtime"],
        currentModelId: "claude-opus-4-8",
        requestedModelId: "claude-opus-4-8",
        mapError: (cause) => cause.message,
      });
      expect(calls).toEqual([]);
      expect(result).toBe("claude-opus-4-8");
    }),
  );
});

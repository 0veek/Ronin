import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { GrokSettings } from "@t3tools/contracts";

import {
  buildGrokDiscoveredModelsFromSessionModelState,
  buildInitialGrokProviderSnapshot,
  checkGrokProviderStatus,
} from "./GrokProvider.ts";

const decodeGrokSettings = Schema.decodeSync(GrokSettings);

function reasoningEffortDescriptor(model: { capabilities?: unknown } | undefined) {
  const descriptors = (
    model?.capabilities as
      | { optionDescriptors?: ReadonlyArray<{ id: string; type: string }> }
      | undefined
  )?.optionDescriptors;
  return descriptors?.find((descriptor) => descriptor.id === "reasoningEffort");
}

describe("buildGrokDiscoveredModelsFromSessionModelState", () => {
  // Shape copied from what `grok 1.0.3` returns from session/new.
  const advertised = {
    currentModelId: "grok-4.6",
    availableModels: [
      {
        modelId: "grok-4.6",
        name: "Grok 4.6",
        _meta: {
          reasoningEfforts: [
            { id: "xhigh", value: "xhigh", label: "Extra High Effort", default: true },
            { id: "high", value: "high", label: "High Effort", default: true },
            { id: "medium", value: "medium", label: "Medium Effort", default: false },
            { id: "low", value: "low", label: "Low Effort", default: false },
          ],
        },
      },
      {
        modelId: "grok-4.5",
        name: "Grok 4.5",
        _meta: {
          reasoningEfforts: [
            { id: "high", value: "high", label: "High Effort", default: true },
            { id: "medium", value: "medium", label: "Medium Effort", default: false },
          ],
        },
      },
    ],
  };

  it("takes the model list from the CLI rather than a hardcoded catalog", () => {
    const models = buildGrokDiscoveredModelsFromSessionModelState(advertised);
    expect(models.map((model) => model.slug)).toEqual(["grok-4.6", "grok-4.5"]);
    expect(models.map((model) => model.name)).toEqual(["Grok 4.6", "Grok 4.5"]);
  });

  it("syncs each model's reasoning-effort menu from its advertised efforts", () => {
    const models = buildGrokDiscoveredModelsFromSessionModelState(advertised);

    const latest = reasoningEffortDescriptor(models[0]);
    expect(latest?.type).toBe("select");
    if (latest?.type === "select") {
      const descriptor = latest as unknown as {
        options: ReadonlyArray<{ id: string }>;
        currentValue?: string;
      };
      expect(descriptor.options.map((option) => option.id)).toEqual([
        "xhigh",
        "high",
        "medium",
        "low",
      ]);
      // Grok flags both xhigh and high as default; a select takes one.
      expect(descriptor.currentValue).toBe("xhigh");
    }

    // 4.5 advertises no xhigh, so it must not offer one.
    const previous = reasoningEffortDescriptor(models[1]);
    if (previous?.type === "select") {
      const descriptor = previous as unknown as {
        options: ReadonlyArray<{ id: string }>;
        currentValue?: string;
      };
      expect(descriptor.options.map((option) => option.id)).toEqual(["high", "medium"]);
      expect(descriptor.currentValue).toBe("high");
    }
  });

  it("falls back to the static effort menu when a model advertises none", () => {
    const models = buildGrokDiscoveredModelsFromSessionModelState({
      currentModelId: "grok-4.6",
      availableModels: [{ modelId: "grok-4.6", name: "Grok 4.6" }],
    });
    const effort = reasoningEffortDescriptor(models[0]);
    if (effort?.type === "select") {
      const descriptor = effort as unknown as { options: ReadonlyArray<{ id: string }> };
      expect(descriptor.options.map((option) => option.id)).toEqual([
        "none",
        "low",
        "medium",
        "high",
      ]);
    }
  });

  it("returns nothing when the agent advertises no models", () => {
    expect(buildGrokDiscoveredModelsFromSessionModelState(null)).toEqual([]);
    expect(
      buildGrokDiscoveredModelsFromSessionModelState({
        currentModelId: "grok-4.6",
        availableModels: [],
      }),
    ).toEqual([]);
  });
});

describe("buildInitialGrokProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialGrokProviderSnapshot(
        decodeGrokSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("returns a pending snapshot by default", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialGrokProviderSnapshot(decodeGrokSettings({}));
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBeNull();
      expect(snapshot.message).toContain("Checking Grok");
      expect(snapshot.requiresNewThreadForModelChange).toBe(true);
      // A single placeholder, not a catalog: ACP discovery supplies the real
      // list once the CLI answers. Hardcoding more is what kept retired models
      // (Grok Build 0.1, Grok 4.3) in the picker.
      expect(snapshot.models.map((model) => model.slug)).toEqual(["grok-4.6"]);
      const effort = snapshot.models[0]?.capabilities?.optionDescriptors?.find(
        (descriptor) => descriptor.id === "reasoningEffort",
      );
      expect(effort?.type).toBe("select");
      if (effort?.type === "select") {
        expect(effort.options.map((option) => option.id)).toEqual([
          "none",
          "low",
          "medium",
          "high",
        ]);
        expect(effort.currentValue).toBe("low");
      }
    }),
  );
});

it.layer(NodeServices.layer)("checkGrokProviderStatus", (it) => {
  it.effect("reports the binary as missing when the binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkGrokProviderStatus(
        decodeGrokSettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/grok-binary",
        }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH|Failed to execute/);
    }),
  );

  it.effect("reports an installed CLI as unhealthy when --version exits non-zero", () =>
    Effect.gen(function* () {
      const secretStderr = "broken grok install: secret-token-value";
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-grok-version-" });
          const grokPath = path.join(dir, "grok");
          yield* fs.writeFileString(
            grokPath,
            ["#!/bin/sh", `printf "%s\\n" "${secretStderr}" >&2`, "exit 2", ""].join("\n"),
          );
          yield* fs.chmod(grokPath, 0o755);

          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
          );
        }),
      );

      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toBe("Grok CLI is installed but failed to run.");
      expect(snapshot.message).not.toContain(secretStderr);
    }),
  );

  it.effect("reports an error when ACP model discovery is unavailable", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-grok-success-" });
          const grokPath = path.join(dir, "grok");
          yield* fs.writeFileString(
            grokPath,
            ["#!/bin/sh", 'printf "grok-cli 0.0.99\\n"', "exit 0", ""].join("\n"),
          );
          yield* fs.chmod(grokPath, 0o755);

          return yield* checkGrokProviderStatus(
            decodeGrokSettings({ enabled: true, binaryPath: grokPath }),
          );
        }),
      );

      expect(snapshot.status).toBe("error");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.models.map((model) => model.slug)).toEqual(["grok-4.6"]);
      expect(snapshot.message).toContain("ACP startup failed");
    }),
  );
});

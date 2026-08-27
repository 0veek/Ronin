// @effect-diagnostics nodeBuiltinImport:off - the probe fixtures write a real mock CLI to disk.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

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

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

/**
 * A `grok` stand-in that answers `--version` and `inspect` itself and hands
 * everything else to the ACP mock agent, which is the same three-step the real
 * probe walks. `inspect` has to answer and exit like the real CLI: falling
 * through to the stdio agent would leave a process that never exits.
 */
async function makeMockGrokCli(
  extraEnv?: Record<string, string>,
  options?: { readonly inspectSkills?: ReadonlyArray<unknown> },
) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "grok-probe-mock-"));
  const cliPath = NodePath.join(dir, "fake-grok.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const inspectJson = JSON.stringify(JSON.stringify({ skills: options?.inspectSkills ?? [] }));
  await NodeFSP.writeFile(
    cliPath,
    `#!/bin/sh
${envExports}
if [ "$1" = "--version" ]; then
  printf "grok 1.0.4\\n"
  exit 0
fi
if [ "$1" = "inspect" ]; then
  printf "%s\\n" ${inspectJson}
  exit 0
fi
exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"
`,
    "utf8",
  );
  await NodeFSP.chmod(cliPath, 0o755);
  return cliPath;
}

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

  it("honors a model that says it has no effort dial at all", () => {
    const models = buildGrokDiscoveredModelsFromSessionModelState({
      currentModelId: "grok-4.6",
      availableModels: [
        {
          modelId: "grok-4.6",
          name: "Grok 4.6",
          _meta: { supportsReasoningEffort: false },
        },
      ],
    });

    // Not the same as advertising nothing: an explicit opt-out gets no control,
    // where silence still falls back to the levels Grok has always shipped.
    expect(reasoningEffortDescriptor(models[0])).toBeUndefined();
  });

  it("reads older builds that key an effort by id, and drops unusable tokens", () => {
    const models = buildGrokDiscoveredModelsFromSessionModelState({
      currentModelId: "grok-4.6",
      availableModels: [
        {
          modelId: "grok-4.6",
          name: "Grok 4.6",
          _meta: {
            reasoningEfforts: [
              { id: "high", label: "High Effort", isDefault: true, description: "Thinks longer" },
              { id: "not a token", label: "Bogus" },
              { value: "low", label: "Low Effort" },
            ],
          },
        },
      ],
    });

    const effort = reasoningEffortDescriptor(models[0]);
    if (effort?.type === "select") {
      const descriptor = effort as unknown as {
        options: ReadonlyArray<{ id: string; description?: string }>;
        currentValue?: string;
      };
      expect(descriptor.options.map((option) => option.id)).toEqual(["high", "low"]);
      expect(descriptor.options[0]?.description).toBe("Thinks longer");
      expect(descriptor.currentValue).toBe("high");
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

  it.effect("returns a disabled snapshot by default — Grok is opt-in", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialGrokProviderSnapshot(decodeGrokSettings({}));
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
    }),
  );

  it.effect("returns a pending snapshot when enabled", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialGrokProviderSnapshot(
        decodeGrokSettings({ enabled: true }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBeNull();
      expect(snapshot.message).toContain("Checking Grok");
      // Grok Build implements `session/set_model`, so a thread can change
      // models without being started over.
      expect(snapshot.requiresNewThreadForModelChange).toBeUndefined();
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

  it.effect("reports the credential the CLI authenticated with", () =>
    Effect.gen(function* () {
      const cliPath = yield* Effect.promise(() => makeMockGrokCli());
      const snapshot = yield* checkGrokProviderStatus(
        decodeGrokSettings({ enabled: true, binaryPath: cliPath }),
      );

      expect(snapshot.status).toBe("ready");
      expect(snapshot.version).toBe("1.0.4");
      expect(snapshot.auth).toEqual({ status: "authenticated", type: "CLI login" });
      expect(snapshot.models.map((model) => model.slug)).toEqual(["grok-4.6", "grok-4.5"]);
    }),
  );

  it.effect("reads an interactive-only auth advertisement as signed out", () =>
    Effect.gen(function* () {
      const cliPath = yield* Effect.promise(() =>
        makeMockGrokCli({ T3_MOCK_ACP_AUTH_METHODS: "grok.com" }),
      );
      // Signing out is not the same failure as a broken install, and the card
      // has to say which one it is rather than sending the user to the logs.
      const snapshot = yield* checkGrokProviderStatus(
        decodeGrokSettings({ enabled: true, binaryPath: cliPath }),
      );

      expect(snapshot.status).toBe("error");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.auth).toEqual({ status: "unauthenticated" });
      expect(snapshot.message).toContain("grok login");
      expect(snapshot.message).not.toContain("Check server logs");
    }),
  );

  it.effect("puts the catalog `grok inspect` reports on the snapshot", () =>
    Effect.gen(function* () {
      const cliPath = yield* Effect.promise(() =>
        makeMockGrokCli(undefined, {
          inspectSkills: [
            {
              name: "review-diff",
              description: "Review the working tree",
              source: { type: "project", path: "/repo/.grok/skills/review-diff/SKILL.md" },
            },
            // Kept but disabled, so a picker filtering on `enabled` hides it.
            {
              name: "internal-only",
              source: { type: "bundled", path: "/opt/grok/skills/internal/SKILL.md" },
              userInvocable: false,
            },
            // No filesystem path: nothing a picker could open.
            { name: "ghost" },
          ],
        }),
      );

      const snapshot = yield* checkGrokProviderStatus(
        decodeGrokSettings({ enabled: true, binaryPath: cliPath }),
      );

      expect(snapshot.skills).toEqual([
        {
          name: "internal-only",
          path: "/opt/grok/skills/internal/SKILL.md",
          enabled: false,
          scope: "bundled",
        },
        {
          name: "review-diff",
          path: "/repo/.grok/skills/review-diff/SKILL.md",
          enabled: true,
          scope: "project",
          description: "Review the working tree",
        },
      ]);
    }),
  );

  it.effect("never fails the snapshot because skill discovery did", () =>
    Effect.gen(function* () {
      // An older CLI has no `inspect`. A missing catalog is not a broken
      // provider, so the card still reports a healthy, authenticated Grok.
      const cliPath = yield* Effect.promise(() => makeMockGrokCli());
      const snapshot = yield* checkGrokProviderStatus(
        decodeGrokSettings({ enabled: true, binaryPath: cliPath }),
      );

      expect(snapshot.status).toBe("ready");
      expect(snapshot.skills).toEqual([]);
    }),
  );
});

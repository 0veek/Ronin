// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { createModelSelection } from "@t3tools/shared/model";
import { expect } from "vite-plus/test";
import { GrokSettings, ProviderInstanceId } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as TextGeneration from "./TextGeneration.ts";
import { makeGrokTextGeneration } from "./GrokTextGeneration.ts";
const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../scripts/acp-mock-agent.ts");

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

const GrokTextGenerationTestLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-grok-text-generation-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

function makeAcpGrokWrapper(dir: string, env: Record<string, string>): string {
  const binDir = NodePath.join(dir, "bin");
  const grokPath = NodePath.join(binDir, "grok");
  NodeFS.mkdirSync(binDir, { recursive: true });
  NodeFS.writeFileSync(
    grokPath,
    [
      "#!/bin/sh",
      ...Object.entries(env).map(([key, value]) => `export ${key}=${shellSingleQuote(value)}`),
      // Scan rather than index: the real spawn line leads with process-scoped
      // flags (`--permission-mode`, `--tools`), so `agent`/`stdio` are never
      // at $1/$2.
      '[ -n "$T3_ACP_ARGS_LOG_PATH" ] && printf "%s\\n" "$*" > "$T3_ACP_ARGS_LOG_PATH"',
      "has_agent=0",
      "has_stdio=0",
      'for arg in "$@"; do',
      '  [ "$arg" = "agent" ] && has_agent=1',
      '  [ "$arg" = "stdio" ] && has_stdio=1',
      "done",
      'if [ "$has_agent" != "1" ] || [ "$has_stdio" != "1" ]; then',
      '  printf "%s\\n" "unexpected args: $*" >&2',
      "  exit 11",
      "fi",
      // Forward the spawn line: the mock reads `-m` from it the way Grok does,
      // so a session opens on the requested model and needs no set_model.
      `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  NodeFS.chmodSync(grokPath, 0o755);
  return grokPath;
}

function withFakeAcpGrok<A, E, R>(
  env: Record<string, string>,
  effectFn: (textGeneration: TextGeneration.TextGeneration["Service"]) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-grok-text-acp-"));
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        NodeFS.rmSync(tempDir, { recursive: true, force: true });
      }),
    );
    const binaryPath = makeAcpGrokWrapper(tempDir, env);
    const config = decodeGrokSettings({ binaryPath });
    const textGeneration = yield* makeGrokTextGeneration(config);
    return yield* effectFn(textGeneration);
  }).pipe(Effect.scoped);
}

function readJsonRpcRequests(
  filePath: string,
): ReadonlyArray<{ readonly method?: string; readonly params?: Record<string, unknown> }> {
  return NodeFS.readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
}

it.layer(GrokTextGenerationTestLayer)("GrokTextGeneration", (it) => {
  it.effect("uses ACP with disabled tool capabilities and forwards the requested model id", () => {
    const requestLogDir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3code-grok-text-log-"),
    );
    const requestLogPath = NodePath.join(requestLogDir, "requests.ndjson");
    const spawnArgsLogPath = NodePath.join(requestLogDir, "spawn-args.txt");

    return withFakeAcpGrok(
      {
        T3_ACP_REQUEST_LOG_PATH: requestLogPath,
        T3_ACP_ARGS_LOG_PATH: spawnArgsLogPath,
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          subject: "Add Grok provider",
          body: "Wire up the ACP runtime and headless text generation path.",
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/grok",
            stagedSummary: "M apps/server/src/provider/Drivers/GrokDriver.ts",
            stagedPatch: "diff --git a/.../GrokDriver.ts b/.../GrokDriver.ts",
            modelSelection: createModelSelection(ProviderInstanceId.make("grok"), "grok-4.5"),
          });

          expect(generated.subject).toBe("Add Grok provider");
          expect(generated.body).toBe("Wire up the ACP runtime and headless text generation path.");

          const requests = readJsonRpcRequests(requestLogPath);
          expect(
            requests.find((request) => request.method === "initialize")?.params?.clientCapabilities,
          ).toMatchObject({
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          });
          // Grok takes the model on process start, not via session/set_model —
          // see applyGrokAcpModelSelection.
          expect(requests.some((request) => request.method === "session/set_model")).toBe(false);
          const spawnArgs = NodeFS.readFileSync(spawnArgsLogPath, "utf8").trim();
          expect(spawnArgs).toContain("-m grok-4.5");
          // Grok answers one-shot prompts with an agentic tool loop, and an
          // unanswered permission request cancels the turn mid-preamble.
          // Approve them, bounded by the read-only sandbox.
          expect(spawnArgs).toContain("--always-approve");
          expect(spawnArgs).toContain("--sandbox read-only");
        }),
    );
  });

  it.effect("extracts the JSON object when Grok wraps it in conversational text", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT:
          "Sure! Here's a thread title:\n\n" +
          JSON.stringify({ title: "Investigate failing CI" }) +
          "\n\nLet me know if you need anything else.",
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateThreadTitle({
            cwd: process.cwd(),
            message: "the lint job is red",
            modelSelection: createModelSelection(ProviderInstanceId.make("grok"), "grok-4.5"),
          });
          expect(generated.title).toBe("Investigate failing CI");
        }),
    ),
  );

  it.effect("surfaces ACP request failures as text generation errors", () =>
    Effect.gen(function* () {
      // An unlaunchable binary is the cheapest genuine AcpError; the model id
      // itself can no longer fail, since it rides the spawn line rather than a
      // session/set_model round trip.
      const textGeneration = yield* makeGrokTextGeneration(
        decodeGrokSettings({ binaryPath: NodePath.join(NodeOS.tmpdir(), "t3code-missing-grok") }),
      );
      const error = yield* Effect.flip(
        textGeneration.generateBranchName({
          cwd: process.cwd(),
          message: "wire up grok",
          modelSelection: createModelSelection(ProviderInstanceId.make("grok"), "grok-4.6"),
        }),
      );
      expect(error._tag).toBe("TextGenerationError");
      expect(error.detail).toMatch(/grok acp/i);
    }).pipe(Effect.scoped),
  );

  it.effect("fails with TextGenerationError when output is empty", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: "   \n  ",
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            textGeneration.generateThreadTitle({
              cwd: process.cwd(),
              message: "anything",
              modelSelection: createModelSelection(ProviderInstanceId.make("grok"), "grok-4.6"),
            }),
          );
          expect(error._tag).toBe("TextGenerationError");
          expect(error.detail).toMatch(/empty/i);
        }),
    ),
  );

  it.effect("decodes a structured PR title + body", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: JSON.stringify({
          title: "feat(grok): wire up session/set_model",
          body: "## Summary\n- Replace `-m` spawn flag with the typed ACP `session/set_model`.\n- Translate `MODEL_SWITCH_INCOMPATIBLE_AGENT` into a validation error.",
        }),
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generatePrContent({
            cwd: process.cwd(),
            baseBranch: "main",
            headBranch: "feat/grok-provider",
            commitSummary: "feat: add grok provider",
            diffSummary: "M apps/server/src/provider/Drivers/GrokDriver.ts",
            diffPatch: "diff --git a/.../GrokDriver.ts b/.../GrokDriver.ts",
            modelSelection: createModelSelection(ProviderInstanceId.make("grok"), "grok-4.6"),
          });

          expect(generated.title).toBe("feat(grok): wire up session/set_model");
          expect(generated.body).toContain("Translate `MODEL_SWITCH_INCOMPATIBLE_AGENT`");
        }),
    ),
  );

  it.effect("fails with TextGenerationError when output is unparseable JSON", () =>
    withFakeAcpGrok(
      {
        T3_ACP_PROMPT_RESPONSE_TEXT: "totally not json output from a confused model",
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            textGeneration.generateThreadTitle({
              cwd: process.cwd(),
              message: "anything",
              modelSelection: createModelSelection(ProviderInstanceId.make("grok"), "grok-4.6"),
            }),
          );
          expect(error._tag).toBe("TextGenerationError");
          expect(error.detail).toMatch(/invalid structured output/i);
        }),
    ),
  );
});

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import { AntigravitySettings } from "@t3tools/contracts";

import {
  buildInitialAntigravityProviderSnapshot,
  checkAntigravityProviderStatus,
} from "./AntigravityProvider.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

/**
 * Stands in for `agy 1.1.13`, whose `models` subcommand prints nothing until
 * stdin reaches EOF — the reason Ronin's picker sat on its placeholder while
 * the CLI already offered Gemini 3.7. `cat` here blocks on an inherited pipe
 * exactly like the real thing.
 */
const AGY_STUB = [
  "#!/bin/sh",
  'if [ "$1" = "--version" ]; then',
  '  printf "1.1.13\\n"',
  "  exit 0",
  "fi",
  'if [ "$1" = "models" ]; then',
  "  cat > /dev/null",
  '  printf "gemini-3.7-flash-high\\tGemini 3.7 Flash (High)\\n"',
  '  printf "gemini-3.7-flash-low\\tGemini 3.7 Flash (Low)\\n"',
  '  printf "claude-sonnet-4-6\\tClaude Sonnet 4.6 (Thinking)\\n"',
  "  exit 0",
  "fi",
  "exit 1",
  "",
].join("\n");

const withAgyStub = <A>(
  use: (binaryPath: string) => Effect.Effect<A, never, ChildProcessSpawner.ChildProcessSpawner>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-antigravity-" });
      const binaryPath = path.join(dir, "agy");
      yield* fs.writeFileString(binaryPath, AGY_STUB);
      yield* fs.chmod(binaryPath, 0o755);
      return yield* use(binaryPath);
    }),
  );

it.layer(NodeServices.layer)("checkAntigravityProviderStatus", (it) => {
  it.effect(
    "takes the model list from the CLI rather than the built-in placeholder",
    () =>
      Effect.gen(function* () {
        const snapshot = yield* withAgyStub((binaryPath) =>
          checkAntigravityProviderStatus(decodeAntigravitySettings({ enabled: true, binaryPath })),
        );

        expect(snapshot.status).toBe("ready");
        expect(snapshot.version).toBe("1.1.13");
        // Discovery has to survive the CLI reading stdin to EOF first.
        expect(snapshot.models.map((model) => model.slug)).toEqual([
          "gemini-3.7-flash-high",
          "gemini-3.7-flash-low",
          "claude-sonnet-4-6",
        ]);
        expect(snapshot.models.map((model) => model.name)).toEqual([
          "Gemini 3.7 Flash (High)",
          "Gemini 3.7 Flash (Low)",
          "Claude Sonnet 4.6 (Thinking)",
        ]);
      }),
    30_000,
  );

  it.effect(
    "keeps custom models alongside the discovered ones",
    () =>
      Effect.gen(function* () {
        const snapshot = yield* withAgyStub((binaryPath) =>
          checkAntigravityProviderStatus(
            decodeAntigravitySettings({
              enabled: true,
              binaryPath,
              customModels: ["gemini-3.6-flash-medium"],
            }),
          ),
        );

        const custom = snapshot.models.filter((model) => model.isCustom);
        expect(custom.map((model) => model.slug)).toEqual(["gemini-3.6-flash-medium"]);
        expect(snapshot.models).toHaveLength(4);
      }),
    30_000,
  );

  it.effect("reports a missing CLI without inventing models", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkAntigravityProviderStatus(
        decodeAntigravitySettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/agy",
        }),
      );

      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.models.map((model) => model.slug)).toEqual(["gemini-3.5-flash-medium"]);
    }),
  );
});

describe("buildInitialAntigravityProviderSnapshot", () => {
  it.effect("seeds the picker with a slug the CLI accepts", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialAntigravityProviderSnapshot(
        decodeAntigravitySettings({ enabled: true }),
      );
      // `agy --model` matches ids, never the labels printed beside them.
      expect(snapshot.models.map((model) => model.slug)).toEqual(["gemini-3.5-flash-medium"]);
    }),
  );

  it.effect("does not make a model change cost a new thread", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialAntigravityProviderSnapshot(
        decodeAntigravitySettings({ enabled: true }),
      );
      // Each turn is its own `agy` process that takes `--model` and rejoins
      // through `--conversation`, so the model is not fixed when the
      // conversation opens. This flag also gates handoff in both directions.
      expect(snapshot.requiresNewThreadForModelChange).toBeUndefined();
    }),
  );
});

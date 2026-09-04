import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import * as NodeURL from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "~": NodeURL.fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    exclude: [
      "**/.repos/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  staged: {
    // Formatter only for now — no lint or typecheck on commit.
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: [
      ".reference",
      ".repos/**",
      ".alchemy",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "apps/web/public/mockServiceWorker.js",
      "apps/web/src/lib/vendor/qrcodegen.ts",
      // Vendored skill packs stay byte-identical to upstream so refreshing one
      // is a re-copy, not a merge. `apps/server/skills/README.md` is ours.
      "apps/server/skills/*/**",
      "*.icon/**",
    ],
    sortPackageJson: {},
    overrides: [
      {
        files: [".devcontainer/devcontainer.json"],
        options: {
          trailingComma: "none",
        },
      },
    ],
  },
  lint: {
    ignorePatterns: [
      ".repos",
      ".repos/**",
      "dist",
      "dist-electron",
      "node_modules",
      "pnpm-lock.yaml",
      "*.tsbuildinfo",
      "**/routeTree.gen.ts",
    ],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: ["./oxlint-plugin-t3code/index.ts"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "typescript/consistent-return": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-duplicate-type-constituents": "off",
      "typescript/no-floating-promises": "off",
      "typescript/no-implied-eval": "off",
      "typescript/no-meaningless-void-operator": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/no-unnecessary-boolean-literal-compare": "off",
      "typescript/no-unnecessary-type-conversion": "off",
      "typescript/no-unnecessary-type-arguments": "off",
      "typescript/no-unnecessary-type-assertion": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/no-unsafe-type-assertion": "off",
      "typescript/await-thenable": "off",
      "typescript/require-array-sort-compare": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/unbound-method": "off",
      "eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@t3tools/client-runtime",
              message:
                "Import from an explicit @t3tools/client-runtime/* subpath. The package has no root export.",
            },
            {
              name: "@pierre/diffs/react",
              importNames: ["CodeView"],
              message:
                "Use StyledDiffCodeView so web diff surfaces share styling and virtualized geometry.",
            },
          ],
        },
      ],
      "t3code/no-global-process-runtime": "error",
      "t3code/no-inline-schema-compile": "warn",
      "t3code/no-manual-effect-runtime-in-tests": "error",
      "t3code/no-native-title-tooltip": "error",
      "t3code/namespace-node-imports": "error",
    },
    overrides: [
      {
        // The one place that reads the host platform to seed the injected references.
        files: ["packages/shared/src/hostProcess.ts"],
        rules: { "t3code/no-global-process-runtime": "off" },
      },
      // Legacy manual Effect runners tracked as debt: no net-new occurrences.
      // Lower a ceiling when you migrate a file, and delete its entry at zero.
      ...Object.entries({
        "apps/server/src/orchestration/Layers/CheckpointReactor.test.ts": 42,
        "apps/server/src/orchestration/Layers/OrchestrationEngine.test.ts": 5,
        "apps/server/src/orchestration/Layers/OrchestrationReactor.test.ts": 4,
        "apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts": 70,
        "apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.test.ts": 31,
        "apps/server/src/orchestration/Layers/ThreadDeletionReactor.test.ts": 2,
        "apps/server/src/orchestration/commandInvariants.test.ts": 6,
        "apps/server/src/orchestration/projector.test.ts": 20,
        "apps/server/src/project/Layers/ProjectSetupScriptRunner.test.ts": 4,
        "apps/server/src/provider/Layers/ClaudeAdapter.test.ts": 2,
        "apps/server/src/provider/Layers/CodexAdapter.test.ts": 1,
        "apps/server/src/provider/Layers/CodexSessionRuntime.test.ts": 5,
        "apps/server/src/provider/Layers/CursorAdapter.test.ts": 1,
        "apps/server/src/provider/Layers/CursorProvider.test.ts": 4,
        "apps/server/src/provider/Layers/ProviderService.test.ts": 2,
        "apps/server/src/provider/Layers/ProviderSessionReaper.test.ts": 21,
        "apps/server/src/provider/acp/CursorAcpSupport.test.ts": 1,
        "apps/server/src/server.test.ts": 1,
        "apps/web/src/environments/runtime/service.addSavedEnvironment.test.ts": 1,
        "oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.test.ts": 7,
        "packages/client-runtime/src/wsTransport.test.ts": 2,
      }).map(([file, maxOccurrences]) => {
        const rule: ["error", { maxOccurrences: number }] = ["error", { maxOccurrences }];
        return { files: [file], rules: { "t3code/no-manual-effect-runtime-in-tests": rule } };
      }),
    ],
    options: {
      reportUnusedDisableDirectives: "error",
      // Revisit once Oxlint's tsgolint path can integrate with @effect/tsgo diagnostics.
      typeAware: false,
      typeCheck: false,
    },
  },
});

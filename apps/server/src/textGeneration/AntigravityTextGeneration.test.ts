// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AntigravitySettings, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { describe, expect } from "vite-plus/test";

import {
  buildAntigravityTextGenerationArgs,
  makeAntigravityTextGeneration,
} from "./AntigravityTextGeneration.ts";

const decodeAntigravitySettings = Schema.decodeSync(AntigravitySettings);

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * A fake `agy` that logs the spawn line and prints one canned print-mode
 * result, which is the whole contract this module depends on.
 */
function makeFakeAgy(input: {
  readonly stdout: string;
  readonly exitCode?: number;
  readonly argsLogPath?: string;
}): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-agy-text-"));
  const agyPath = NodePath.join(dir, "agy");
  NodeFS.writeFileSync(
    agyPath,
    [
      "#!/bin/sh",
      ...(input.argsLogPath
        ? [`printf "%s\\n" "$*" > ${shellSingleQuote(input.argsLogPath)}`]
        : []),
      `printf "%s" ${shellSingleQuote(input.stdout)}`,
      `exit ${input.exitCode ?? 0}`,
      "",
    ].join("\n"),
    "utf8",
  );
  NodeFS.chmodSync(agyPath, 0o755);
  return agyPath;
}

function printResult(response: string, status = "SUCCESS"): string {
  return `${JSON.stringify({ conversation_id: "conv-1", status, response, num_turns: 1 })}\n`;
}

function errorResult(error: string): string {
  return `${JSON.stringify({ conversation_id: "conv-1", status: "ERROR", error })}\n`;
}

const modelSelection = createModelSelection(
  ProviderInstanceId.make("antigravity"),
  "gemini-3.5-flash-low",
);

describe("buildAntigravityTextGenerationArgs", () => {
  it("sandboxes the run and never asks agy to plan", () => {
    const args = buildAntigravityTextGenerationArgs({
      model: "gemini-3.5-flash-low",
      prompt: "write a commit message",
    });

    expect(args).toContain("--sandbox");
    expect(args).toContain("--output-format");
    expect(args.at(-2)).toBe("-p");
    expect(args.at(-1)).toBe("write a commit message");
    // Plan mode answers a one-shot prompt with an implementation plan and a
    // "click Proceed", which never decodes as JSON.
    expect(args).not.toContain("plan");
    // Nothing here should be able to approve a tool call on the user's behalf.
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("omits --model when nothing is selected rather than inventing one", () => {
    const args = buildAntigravityTextGenerationArgs({ model: undefined, prompt: "hi" });
    expect(args).not.toContain("--model");
  });
});

// Deliberately outside `it.layer`: this body runs with no services, which is
// the context the reactor calls a generated commit message from.
describe("AntigravityTextGeneration requirements", () => {
  it.effect("keeps working when the caller supplies no process spawner", () =>
    Effect.gen(function* () {
      const binaryPath = makeFakeAgy({ stdout: printResult('{"title":"Fix the lint job"}') });
      // Construction is the only point where a spawner is in scope, because
      // `TextGeneration`'s methods declare no requirements of their own.
      const textGeneration = yield* makeAntigravityTextGeneration(
        decodeAntigravitySettings({ binaryPath }),
      ).pipe(Effect.provide(NodeServices.layer));

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: "the lint job is red",
        modelSelection,
      });

      expect(generated.title).toBe("Fix the lint job");
    }),
  );
});

it.layer(NodeServices.layer)("AntigravityTextGeneration", (it) => {
  it.effect("reads a commit message out of a fenced print-mode response", () =>
    Effect.gen(function* () {
      const argsLogPath = NodePath.join(
        NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-agy-args-")),
        "args.txt",
      );
      // Fenced output is what `agy` actually returns for this prompt.
      const binaryPath = makeFakeAgy({
        argsLogPath,
        stdout: printResult(
          '```json\n{\n  "subject": "Handle null nodes in parser",\n  "body": "- Return early on null"\n}\n```\n',
        ),
      });

      const textGeneration = yield* makeAntigravityTextGeneration(
        decodeAntigravitySettings({ binaryPath }),
      );
      const generated = yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: "fix/parser-null",
        stagedSummary: "M src/parser.ts",
        stagedPatch: "@@ -1,3 +1,5 @@",
        modelSelection,
      });

      expect(generated.subject).toBe("Handle null nodes in parser");
      expect(generated.body).toBe("- Return early on null");
      expect(NodeFS.readFileSync(argsLogPath, "utf8")).toContain("--model gemini-3.5-flash-low");
    }),
  );

  it.effect("keeps an answer the agent recovered its way to", () =>
    Effect.gen(function* () {
      // `status` goes ERROR for any step that errored on the way, so a run that
      // hit a tool error and retried its way to a good commit message lands
      // here. The answer is the verdict, not the status.
      const binaryPath = makeFakeAgy({
        stdout: printResult(
          '{"subject":"Handle null nodes in parser","body":"- Return early on null"}',
          "ERROR",
        ),
      });

      const textGeneration = yield* makeAntigravityTextGeneration(
        decodeAntigravitySettings({ binaryPath }),
      );
      const generated = yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: "fix/parser-null",
        stagedSummary: "M src/parser.ts",
        stagedPatch: "@@ -1,3 +1,5 @@",
        modelSelection,
      });

      expect(generated.subject).toBe("Handle null nodes in parser");
    }),
  );

  it.effect("names a non-SUCCESS run instead of reporting malformed output", () =>
    Effect.gen(function* () {
      const binaryPath = makeFakeAgy({ stdout: errorResult("invalid model selection") });

      const textGeneration = yield* makeAntigravityTextGeneration(
        decodeAntigravitySettings({ binaryPath }),
      );
      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "the lint job is red",
          modelSelection,
        }),
      );

      expect(error._tag).toBe("TextGenerationError");
      expect(error.detail).toContain("invalid model selection");
    }),
  );

  it.effect("surfaces a CLI that never produced a result", () =>
    Effect.gen(function* () {
      const binaryPath = makeFakeAgy({ stdout: "", exitCode: 1 });

      const textGeneration = yield* makeAntigravityTextGeneration(
        decodeAntigravitySettings({ binaryPath }),
      );
      const error = yield* Effect.flip(
        textGeneration.generateBranchName({
          cwd: process.cwd(),
          message: "wire up antigravity",
          modelSelection,
        }),
      );

      expect(error._tag).toBe("TextGenerationError");
      expect(error.detail).toContain("without producing a result");
    }),
  );

  it.effect("rejects a response that is not the requested shape", () =>
    Effect.gen(function* () {
      const binaryPath = makeFakeAgy({
        stdout: printResult("Sure! I can help with that, but I need more detail first.\n"),
      });

      const textGeneration = yield* makeAntigravityTextGeneration(
        decodeAntigravitySettings({ binaryPath }),
      );
      const error = yield* Effect.flip(
        textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "the lint job is red",
          modelSelection,
        }),
      );

      expect(error.detail).toContain("invalid structured output");
    }),
  );
});

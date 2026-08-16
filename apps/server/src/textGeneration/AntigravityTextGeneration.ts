/**
 * AntigravityTextGeneration — commit messages, PR text, branch names and
 * thread titles from the Antigravity CLI (`agy`).
 *
 * Antigravity has no long-lived session to borrow, so each call is its own
 * `agy -p` print-mode run. The reply comes back on `result.response` and is
 * parsed with the same `extractJsonObject` step every other provider uses;
 * `--json-schema` is deliberately not used, because it makes `agy` spend a
 * second turn restructuring its own prose and the schema then captures the
 * shape of that answer ("Git Commit Message for …") rather than the commit.
 *
 * @module textGeneration/AntigravityTextGeneration
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  type AntigravitySettings,
  type ModelSelection,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { normalizeModelSlug } from "@t3tools/shared/model";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import { spawnAndCollect } from "../provider/providerSnapshot.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./TextGenerationUtils.ts";

const ANTIGRAVITY_DRIVER_KIND = ProviderDriverKind.make("antigravity");
const ANTIGRAVITY_TIMEOUT_MS = 180_000;
/** Handed to `agy` so its own wait ends before ours does. */
const ANTIGRAVITY_PRINT_TIMEOUT = "2m";

const isTextGenerationError = Schema.is(TextGenerationError);

const AntigravityPrintResult = Schema.Struct({
  status: Schema.optional(Schema.String),
  response: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
const decodeAntigravityPrintResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(AntigravityPrintResult),
);

/**
 * Print mode emits one JSON object, but a plugin or a warning can put a line
 * in front of it. Read the last line that parses rather than the whole buffer.
 */
function lastJsonLine(stdout: string): string | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  return lines.at(-1);
}

export function buildAntigravityTextGenerationArgs(input: {
  readonly model: string | undefined;
  readonly prompt: string;
}): ReadonlyArray<string> {
  return [
    // `--sandbox` bounds what the run can reach. `--mode plan` is deliberately
    // not used: plan mode answers a commit-message prompt with an
    // implementation plan and a "click Proceed", which never becomes JSON.
    "--sandbox",
    ...(input.model ? ["--model", input.model] : []),
    "--output-format",
    "json",
    "--print-timeout",
    ANTIGRAVITY_PRINT_TIMEOUT,
    "-p",
    input.prompt,
  ];
}

export const makeAntigravityTextGeneration = Effect.fn("makeAntigravityTextGeneration")(function* (
  settings: AntigravitySettings,
  environment: NodeJS.ProcessEnv = process.env,
) {
  // Captured here, not read per call: `TextGeneration`'s methods declare no
  // requirements, so whoever asks for a commit message later has no spawner to
  // give us.
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const runAntigravityJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
  }: {
    operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    modelSelection: ModelSelection;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const command = settings.binaryPath || "agy";
      const args = buildAntigravityTextGenerationArgs({
        model: normalizeModelSlug(modelSelection.model, ANTIGRAVITY_DRIVER_KIND) ?? undefined,
        prompt,
      });
      const spawnCommand = yield* resolveSpawnCommand(command, args, { env: environment });
      const commandResult = yield* spawnAndCollect(
        command,
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          cwd,
          env: environment,
          shell: spawnCommand.shell,
          // `agy` waits on stdin before answering; an open pipe hangs the run.
          stdin: "ignore",
        }),
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, commandSpawner),
        Effect.timeoutOption(ANTIGRAVITY_TIMEOUT_MS),
      );

      if (Option.isNone(commandResult)) {
        return yield* new TextGenerationError({
          operation,
          detail: "Antigravity print-mode request timed out.",
        });
      }
      const result = commandResult.value;
      const resultLine = lastJsonLine(result.stdout);
      if (result.code !== 0 && resultLine === undefined) {
        // The CLI writes launch rejections (an unknown `--model`, a missing
        // login) to stderr, and those never reach the user otherwise.
        return yield* new TextGenerationError({
          operation,
          detail: "Antigravity CLI exited without producing a result.",
        });
      }
      if (resultLine === undefined) {
        return yield* new TextGenerationError({
          operation,
          detail: "Antigravity returned no print-mode result.",
        });
      }

      const printResult = yield* decodeAntigravityPrintResult(resultLine).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Antigravity returned an unreadable print-mode result.",
              cause,
            }),
        ),
      );
      const response = printResult.response?.trim();
      if (printResult.status !== undefined && printResult.status !== "SUCCESS") {
        return yield* new TextGenerationError({
          operation,
          detail: printResult.error?.trim()
            ? `Antigravity did not complete the request: ${printResult.error.trim()}`
            : "Antigravity did not complete the request.",
        });
      }
      if (!response) {
        return yield* new TextGenerationError({
          operation,
          detail: "Antigravity returned empty output.",
        });
      }

      const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson));
      return yield* decodeOutput(extractJsonObject(response)).pipe(
        Effect.catchTags({
          SchemaError: (cause) =>
            Effect.fail(
              new TextGenerationError({
                operation,
                detail: "Antigravity returned invalid structured output.",
                cause,
              }),
            ),
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation,
              detail: "Antigravity text generation failed.",
              cause,
            }),
      ),
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("AntigravityTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });

      const generated = yield* runAntigravityJson({
        operation: "generateCommitMessage",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("AntigravityTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });

      const generated = yield* runAntigravityJson({
        operation: "generatePrContent",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizePrTitle(generated.title),
        body: generated.body.trim(),
      };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("AntigravityTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });

      const generated = yield* runAntigravityJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("AntigravityTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });

      const generated = yield* runAntigravityJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson: outputSchema,
        modelSelection: input.modelSelection,
      });

      return {
        title: sanitizeThreadTitle(generated.title),
      } satisfies TextGeneration.ThreadTitleGenerationResult;
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});

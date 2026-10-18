import { OrchestrationGetWorkflowScriptError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { readContainedWorkflowFile } from "./workflowFileRead.ts";

/** Read a workflow script without starting or resuming its provider. */
export const readWorkflowScript = Effect.fn("orchestration.readWorkflowScript")(function* (input: {
  readonly scriptPath: string;
}) {
  const file = yield* readContainedWorkflowFile({
    path: input.scriptPath,
    extension: ".js",
    byteCap: 256 * 1024,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new OrchestrationGetWorkflowScriptError({
          reason: cause.reason === "wrong-extension" ? "not-js" : cause.reason,
          scriptPath: input.scriptPath,
          cause,
        }),
    ),
  );
  return { scriptPath: file.path, contents: file.contents, truncated: file.truncated };
});

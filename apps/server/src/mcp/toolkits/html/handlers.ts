import { CommandId, TurnItemId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HtmlRender } from "../../../htmlRender/HtmlRender.ts";
import {
  ThreadManagementService,
  latestActiveRun,
} from "../../../orchestration-v2/ThreadManagementService.ts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import { HtmlPreviewToolkit, HtmlRenderToolkit, HtmlRenderToolError } from "./tools.ts";

const toFailure = (error: { readonly _tag: string; readonly message: string }) =>
  new HtmlRenderToolError({
    code: [
      "HtmlRenderImagesNotFoundError",
      "HtmlRenderImageTooLargeError",
      "HtmlRenderPageTooLargeError",
    ].includes(error._tag)
      ? "invalid_request"
      : "orchestration_error",
    message: error.message,
  });

const readCaller = Effect.fn("HtmlToolkit.readCaller")(function* () {
  const scope = yield* requireMcpCapability("html").pipe(
    Effect.mapError(
      () =>
        new HtmlRenderToolError({
          code: "permission_denied",
          message: "HTML tools are unavailable to this provider.",
        }),
    ),
  );
  const threads = yield* ThreadManagementService;
  const records = yield* threads
    .getThreadRecords(scope.threadId, ["runs", "turnItems"], {
      turnItemTypes: ["run_interrupt_request"],
      messageRoles: [],
    })
    .pipe(
      Effect.mapError(
        () =>
          new HtmlRenderToolError({
            code: "orchestration_error",
            message: "Could not read the calling thread.",
          }),
      ),
    );
  const run = latestActiveRun(records);
  if (
    records.thread.archivedAt !== null ||
    run?.rootNodeId == null ||
    run.providerInstanceId !== scope.providerInstanceId ||
    records.turnItems.some((item) => item.runId === run.id && item.type === "run_interrupt_request")
  ) {
    return yield* new HtmlRenderToolError({
      code: "permission_denied",
      message: "HTML tools require a live turn owned by this provider.",
    });
  }
  return { scope, run, nodeId: run.rootNodeId, threads };
});

export const HtmlPreviewToolkitHandlersLive = HtmlPreviewToolkit.toLayer({
  html_preview: (input) =>
    Effect.gen(function* () {
      const { scope } = yield* readCaller();
      const htmlRender = yield* HtmlRender;
      const { png, ...preview } = yield* htmlRender
        .preview({ ...input, scope })
        .pipe(Effect.mapError(toFailure));
      return {
        ...preview,
        screenshot: {
          mimeType: "image/png" as const,
          data: png,
          width: preview.capturedWidth ?? preview.width,
          height: preview.capturedHeight,
        },
      };
    }),
});

export const HtmlRenderToolkitHandlersLive = HtmlRenderToolkit.toLayer({
  html_render: (input) =>
    Effect.gen(function* () {
      const { scope, run, nodeId, threads } = yield* readCaller();
      const htmlRender = yield* HtmlRender;
      // Acquisition and recording form one interrupt-safe handoff: an unrecorded file is removed.
      return yield* Effect.gen(function* () {
        const reference = yield* htmlRender
          .publish({ ...input, threadId: scope.threadId })
          .pipe(Effect.mapError(toFailure));
        const turnItemId = TurnItemId.make(`turn-item:html-render:${reference.attachmentId}`);
        yield* threads
          .dispatch({
            type: "html_render.record",
            commandId: CommandId.make(turnItemId),
            threadId: scope.threadId,
            runId: run.id,
            nodeId,
            providerInstanceId: scope.providerInstanceId,
            turnItemId,
            htmlRender: reference,
          })
          .pipe(
            Effect.mapError(
              () =>
                new HtmlRenderToolError({
                  code: "orchestration_error",
                  message: "The page could not be recorded because the publishing turn stopped.",
                }),
            ),
            Effect.onError(() => htmlRender.remove(reference.attachmentId)),
          );
        return {
          htmlRender: reference,
          message:
            "Shown to the reader above your reply. Reply with only what the page does not already say.",
        };
      }).pipe(Effect.uninterruptible);
    }),
});

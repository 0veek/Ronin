import {
  OrchestrationGetWorkflowConversationError,
  type OrchestrationGetWorkflowConversationInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { field, text } from "./unknownField.ts";
import { readWorkflowAgentAnswers } from "./workflowAgentAnswers.ts";

/** Resolve persisted member identity before any file read; never starts a provider. */
export const readWorkflowConversation = Effect.fn("orchestration.readWorkflowConversation")(
  function* (input: OrchestrationGetWorkflowConversationInput) {
    const query = yield* ProjectionSnapshotQuery;
    const unavailable = () =>
      new OrchestrationGetWorkflowConversationError({
        message: "This workflow attempt is no longer available. Reopen the member conversation.",
      });
    const load = Effect.fn("workflowConversation.loadIdentity")(function* () {
      const activity = yield* query.getTaskActivity(input).pipe(Effect.mapError(unavailable));
      if (Option.isNone(activity)) return yield* unavailable();
      const payload = activity.value.payload;
      if (
        text(field(payload, "workflowAgentId")) !== input.workflowAgentId ||
        field(payload, "attempt") !== input.attempt ||
        typeof field(payload, "parentAgentId") !== "string"
      )
        return yield* unavailable();
      return payload;
    });
    const member = yield* load();
    const parentAgentId = text(field(member, "parentAgentId"))!;
    const coordinator = yield* query
      .getTaskActivity({ threadId: input.threadId, taskId: parentAgentId })
      .pipe(Effect.mapError(unavailable));
    const handles =
      field(member, "runHandles") ??
      (Option.isSome(coordinator) ? field(coordinator.value.payload, "runHandles") : undefined);
    const transcriptDir = text(field(handles, "transcriptDir"));
    const configDir = text(field(member, "workflowConfigDir"));
    const transcript =
      transcriptDir === undefined
        ? undefined
        : yield* readWorkflowAgentAnswers({
            transcriptDir,
            agentId: input.workflowAgentId,
            ...(configDir === undefined ? {} : { configDir }),
          }).pipe(Effect.catch(() => Effect.succeed(undefined)));
    // A retry can replace the slot while a filesystem read is pending.
    yield* load();
    const preview = field(member, "resultPreview");
    const prompt = field(member, "promptPreview");
    const hasAnswers = transcript !== undefined && transcript.answers.length > 0;
    return {
      prompt: typeof prompt === "string" ? prompt : null,
      answers: hasAnswers
        ? transcript.answers
        : typeof preview === "string" && preview.trim()
          ? [preview]
          : [],
      truncated: transcript?.truncated ?? false,
      partial: !hasAnswers,
    };
  },
);

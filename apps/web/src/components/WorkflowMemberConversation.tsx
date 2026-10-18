import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { RuntimeTaskId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { orchestrationEnvironment } from "~/state/orchestration";

function ConversationText({
  prompt,
  answers,
}: {
  prompt: string | null | undefined;
  answers: ReadonlyArray<string>;
}) {
  return (
    <>
      {prompt ? (
        <div className="mb-3">
          <p className="mb-1 font-medium text-muted-foreground">Prompt</p>
          <pre className="whitespace-pre-wrap break-words font-sans">{prompt}</pre>
        </div>
      ) : null}
      {answers.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1 font-medium text-muted-foreground">
            {answers.length === 1 ? "Answer" : "Answers"}
          </p>
          <pre className="whitespace-pre-wrap break-words font-sans">
            {answers.join("\n\n────────\n\n")}
          </pre>
        </div>
      ) : null}
    </>
  );
}

function ConversationStatus({
  truncated,
  partial,
  empty,
  status,
}: {
  truncated: boolean;
  partial: boolean;
  empty: boolean;
  status: "Initial" | "Success" | "Failure";
}) {
  return (
    <>
      {truncated ? (
        <p className="text-muted-foreground">Showing the latest part of this conversation.</p>
      ) : null}
      {partial && !empty ? (
        <p className="text-muted-foreground">
          Progress excerpt. The full transcript is not available yet.
        </p>
      ) : null}
      {status === "Failure" ? (
        <p className="text-destructive-foreground">
          Could not load this attempt’s transcript. Refresh to try again.
        </p>
      ) : null}
      {status === "Initial" ? <p className="text-muted-foreground">Loading conversation…</p> : null}
      {status === "Success" && empty ? (
        <p className="text-muted-foreground">No answer from this attempt yet.</p>
      ) : null}
    </>
  );
}

/** Fetch only an opened member; retries have separate query identities. */
export function WorkflowMemberConversation({
  agent,
  environmentId,
  threadId,
}: {
  agent: RuntimeSubagent;
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const atom = orchestrationEnvironment.workflowConversation({
    environmentId,
    input: {
      threadId,
      taskId: RuntimeTaskId.make(agent.id),
      workflowAgentId: agent.workflowAgentId!,
      ...(agent.attempt === null ? {} : { attempt: agent.attempt }),
    },
  });
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);
  const conversation = result._tag === "Success" ? result.value : null;
  const prompt = conversation?.prompt ?? agent.promptPreview;
  const answers = conversation?.answers ?? (agent.resultPreview ? [agent.resultPreview] : []);
  return (
    <section
      aria-label={`${agent.title} conversation`}
      className="mx-1.5 mb-2 rounded-md border border-border/60 bg-background/60 p-2"
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{agent.attempt === null ? "Conversation" : `Attempt ${agent.attempt}`}</span>
        <button
          type="button"
          onClick={() => refresh()}
          className="rounded px-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          Refresh
        </button>
      </div>
      <div className="max-h-96 overflow-auto text-xs leading-relaxed">
        <ConversationText prompt={prompt} answers={answers} />
        <ConversationStatus
          truncated={conversation?.truncated ?? false}
          partial={conversation?.partial ?? true}
          empty={answers.length === 0}
          status={result._tag}
        />
      </div>
    </section>
  );
}

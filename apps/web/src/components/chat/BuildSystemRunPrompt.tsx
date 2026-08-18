/**
 * The human-in-the-loop cards a run shows above the composer.
 *
 * A gated role needs a yes or a no-with-note. An ask_user needs a reply.
 * Both live here rather than in the transcript so they stay on screen even
 * when the virtualized timeline has scrolled past the last message.
 *
 * @module BuildSystemRunPrompt
 */
import type { BuildSystemRun } from "@t3tools/contracts";
import { useState } from "react";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export function BuildSystemRunPrompt({
  onReply,
  onResolveGate,
  run,
}: {
  readonly onReply: (reply: string) => void;
  readonly onResolveGate: (input: {
    readonly approved: boolean;
    readonly note: string | null;
  }) => void;
  readonly run: BuildSystemRun;
}) {
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");

  if (run.status === "waiting-gate" && run.pending?._tag === "gate") {
    return (
      <div className="rounded-[var(--radius-lg)] border border-border bg-muted/20 p-3">
        <p className="font-medium text-sm">Approve {run.pending.roleName}?</p>
        <p className="mt-1 whitespace-pre-wrap text-muted-foreground text-xs">{run.pending.task}</p>
        <Textarea
          className="mt-2"
          rows={2}
          value={note}
          placeholder="Optional note if you decline"
          onChange={(event) => setNote(event.currentTarget.value)}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onResolveGate({ approved: false, note: note.trim() || null })}
          >
            Decline
          </Button>
          <Button size="xs" onClick={() => onResolveGate({ approved: true, note: null })}>
            Approve
          </Button>
        </div>
      </div>
    );
  }

  if (run.status === "waiting-user" && run.pending?._tag === "question") {
    return (
      <div className="rounded-[var(--radius-lg)] border border-border bg-muted/20 p-3">
        <p className="font-medium text-sm">The team needs an answer</p>
        <p className="mt-1 whitespace-pre-wrap text-muted-foreground text-xs">
          {run.pending.question}
        </p>
        <Textarea
          className="mt-2"
          rows={3}
          value={reply}
          placeholder="Your reply"
          onChange={(event) => setReply(event.currentTarget.value)}
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="xs"
            disabled={reply.trim().length === 0}
            onClick={() => {
              if (reply.trim().length === 0) return;
              onReply(reply.trim());
              setReply("");
            }}
          >
            Send reply
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

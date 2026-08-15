import { describe, expect, it } from "vite-plus/test";

import type { AgentAttentionEvent } from "./agentAttentionNotifications";
import { AGENT_SOUND_PREVIEW_CHIME, selectChime } from "./attentionChime";

function event(kind: AgentAttentionEvent["kind"], threadId = "t1"): AgentAttentionEvent {
  return {
    kind,
    environmentId: "env",
    threadId,
    tag: `env:${threadId}`,
    title: "Thread",
    body: "body",
  };
}

describe("selectChime", () => {
  it("stays silent when nothing happened", () => {
    expect(selectChime([])).toBeNull();
  });

  it("plays once for a whole batch rather than once per event", () => {
    const chime = selectChime([
      event("turn-completed", "a"),
      event("turn-completed", "b"),
      event("turn-completed", "c"),
    ]);

    expect(chime?.kind).toBe("turn-completed");
  });

  it("lets an approval outrank a failure and a completion", () => {
    const chime = selectChime([
      event("turn-completed", "a"),
      event("turn-failed", "b"),
      event("needs-approval", "c"),
    ]);

    expect(chime?.kind).toBe("needs-approval");
  });

  it("lets a failure outrank a completion", () => {
    expect(selectChime([event("turn-completed", "a"), event("turn-failed", "b")])?.kind).toBe(
      "turn-failed",
    );
  });

  it("rises for work that landed and falls for work that broke", () => {
    // The direction is the message, so it has to survive a refactor of the
    // exact pitches.
    const completed = selectChime([event("turn-completed")])?.notes ?? [];
    const failed = selectChime([event("turn-failed")])?.notes ?? [];

    expect(completed[1]!.frequency).toBeGreaterThan(completed[0]!.frequency);
    expect(failed[1]!.frequency).toBeLessThan(failed[0]!.frequency);
  });

  it("knocks twice on one pitch when a decision is wanted", () => {
    const notes = selectChime([event("needs-approval")])?.notes ?? [];

    expect(notes).toHaveLength(2);
    expect(notes[0]!.frequency).toBe(notes[1]!.frequency);
    expect(notes[1]!.startOffset).toBeGreaterThan(notes[0]!.startOffset);
  });

  it("previews the sound the user will actually hear most", () => {
    expect(AGENT_SOUND_PREVIEW_CHIME.kind).toBe("turn-completed");
  });
});

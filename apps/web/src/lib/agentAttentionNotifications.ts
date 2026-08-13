/**
 * Decides which system notifications a batch of thread updates has earned.
 *
 * Pure: the notifier component feeds it the previous and current thread
 * shells and fires `Notification`s for whatever comes back, so the rules —
 * what counts as "finished", what counts as "needs you", what gets collapsed —
 * are all testable without a DOM.
 *
 * @module agentAttentionNotifications
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

export interface AgentAttentionEvent {
  readonly kind: "turn-completed" | "turn-failed" | "needs-approval";
  readonly environmentId: string;
  readonly threadId: string;
  /** Stable per-thread tag so a newer notification replaces the older one. */
  readonly tag: string;
  readonly title: string;
  readonly body: string;
}

/** The slice of a shell the transition rules read, kept per thread. */
export interface ThreadAttentionState {
  readonly turnId: string | null;
  readonly turnState: "running" | "interrupted" | "completed" | "error" | null;
  readonly hasPendingApprovals: boolean;
}

export type ThreadAttentionBaseline = ReadonlyMap<string, ThreadAttentionState>;

function attentionKey(shell: EnvironmentThreadShell): string {
  return `${shell.environmentId}:${shell.id}`;
}

function attentionState(shell: EnvironmentThreadShell): ThreadAttentionState {
  return {
    turnId: shell.latestTurn?.turnId ?? null,
    turnState: shell.latestTurn?.state ?? null,
    hasPendingApprovals: shell.hasPendingApprovals,
  };
}

/** Provider slugs read fine capitalised; anything absent stays generic. */
function agentLabel(shell: EnvironmentThreadShell): string {
  const name = shell.session?.providerName;
  if (!name) return "Agent";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function eventFor(
  shell: EnvironmentThreadShell,
  previous: ThreadAttentionState,
  next: ThreadAttentionState,
): AgentAttentionEvent | null {
  const base = {
    environmentId: shell.environmentId,
    threadId: shell.id,
    tag: attentionKey(shell),
    title: shell.title,
  };

  // Approvals outrank completion: a turn that stopped *because* it needs a
  // decision should read as "waiting on you", not "done".
  if (!previous.hasPendingApprovals && next.hasPendingApprovals) {
    return {
      ...base,
      kind: "needs-approval",
      body: `${agentLabel(shell)} is waiting for your approval`,
    };
  }

  // Only a running turn can finish. "interrupted" is excluded on both sides:
  // as an end state it is the user's own stop button, and nothing that was
  // not running has finished.
  if (previous.turnState !== "running") return null;

  if (next.turnState === "completed") {
    return { ...base, kind: "turn-completed", body: `${agentLabel(shell)} finished` };
  }
  if (next.turnState === "error") {
    return { ...base, kind: "turn-failed", body: `${agentLabel(shell)} hit an error` };
  }
  return null;
}

export interface AttentionDiff {
  readonly events: readonly AgentAttentionEvent[];
  readonly baseline: ThreadAttentionBaseline;
}

/**
 * Compares the current shells against the last observed baseline.
 *
 * A thread absent from the baseline contributes no event and only seeds it:
 * the first snapshot after connect replays every thread's current state, and
 * "your agent finished four days ago" is not news. The same rule silences
 * reconnects, which rebuild the baseline from scratch.
 */
export function diffAgentAttention(
  baseline: ThreadAttentionBaseline | null,
  shells: readonly EnvironmentThreadShell[],
): AttentionDiff {
  const nextBaseline = new Map<string, ThreadAttentionState>();
  const events: AgentAttentionEvent[] = [];

  for (const shell of shells) {
    const key = attentionKey(shell);
    const next = attentionState(shell);
    nextBaseline.set(key, next);

    if (baseline === null) continue;
    const previous = baseline.get(key);
    if (previous === undefined) continue;
    if (shell.archivedAt !== null) continue;

    const event = eventFor(shell, previous, next);
    if (event !== null) events.push(event);
  }

  return { events, baseline: nextBaseline };
}

/**
 * Past this many events in one batch, one summary replaces the pile.
 *
 * A fan-out settling, or a laptop waking from sleep straight into a burst of
 * buffered updates, would otherwise stack a screen of individual toasts.
 */
export const ATTENTION_SUMMARY_THRESHOLD = 4;

export interface AttentionSummary {
  readonly tag: "agent-attention-summary";
  readonly title: string;
  readonly body: string;
}

export function summarizeAttention(
  events: readonly AgentAttentionEvent[],
): AttentionSummary | null {
  if (events.length <= ATTENTION_SUMMARY_THRESHOLD) return null;
  const waiting = events.filter((event) => event.kind === "needs-approval").length;
  return {
    tag: "agent-attention-summary",
    title: `${events.length} threads need a look`,
    body:
      waiting === 0
        ? "Several agents finished while you were away"
        : `${waiting} waiting for approval, ${events.length - waiting} finished`,
  };
}

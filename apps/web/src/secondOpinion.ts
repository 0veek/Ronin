/**
 * Racing the same prompt across providers.
 *
 * Ronin is the one app where a user already holds several provider
 * subscriptions at once, so "ask two of them and see which answer I like" is a
 * question only this app can put to work. A second opinion sends one prompt to
 * several models, each in its own thread and its own worktree, and lets the
 * user read the results side by side.
 *
 * Isolation is what makes it honest rather than a novelty: two agents editing
 * one checkout would produce a blend of two attempts and prove nothing about
 * either. Every entrant therefore gets its own worktree, which is also why a
 * race is only offered where a worktree can be made.
 *
 * This module is the decisions; `useSecondOpinion` is the dispatch.
 *
 * @module secondOpinion
 */
import type { ModelSelection } from "@t3tools/contracts";

/**
 * How many models may race at once.
 *
 * Each entrant is a real agent burning a real subscription window and a real
 * worktree, and past a handful the comparison stops being readable anyway —
 * the point is to choose, not to survey.
 */
export const SECOND_OPINION_MAX_ENTRANTS = 4;

/** Below this there is no comparison, only a turn. */
export const SECOND_OPINION_MIN_ENTRANTS = 2;

/** Longest prompt excerpt used to name a race's threads. */
export const SECOND_OPINION_TITLE_MAX_CHARS = 56;

export interface SecondOpinionEntrant {
  readonly modelSelection: ModelSelection;
  /** What the picker showed, used to name the thread. */
  readonly label: string;
}

/**
 * Whether a chosen set can actually race.
 *
 * Duplicate models are rejected rather than deduplicated: the user picked
 * them, and silently dropping one would leave a race with fewer entrants than
 * the UI just promised.
 */
export function secondOpinionSelectionError(
  entrants: ReadonlyArray<SecondOpinionEntrant>,
): string | null {
  if (entrants.length < SECOND_OPINION_MIN_ENTRANTS) {
    return `Pick at least ${SECOND_OPINION_MIN_ENTRANTS} models to compare.`;
  }
  if (entrants.length > SECOND_OPINION_MAX_ENTRANTS) {
    return `Compare at most ${SECOND_OPINION_MAX_ENTRANTS} models at once.`;
  }
  const seen = new Set<string>();
  for (const entrant of entrants) {
    const key = `${entrant.modelSelection.instanceId}:${entrant.modelSelection.model}`;
    if (seen.has(key)) return "Pick a different model for each entrant.";
    seen.add(key);
  }
  return null;
}

function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const hardCut = text.slice(0, maxChars);
  const lastSpace = hardCut.lastIndexOf(" ");
  const body = lastSpace > maxChars / 2 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${body.trimEnd()}…`;
}

/**
 * The thread title for one entrant.
 *
 * The model leads rather than trails: in a sidebar showing four threads that
 * share a prompt, the only thing distinguishing them is who is answering, and
 * a truncated title must not cut that away.
 */
export function buildSecondOpinionTitle(prompt: string, label: string): string {
  const excerpt = truncateAtBoundary(
    prompt.replaceAll(/\s+/g, " ").trim(),
    SECOND_OPINION_TITLE_MAX_CHARS,
  );
  return excerpt.length === 0 ? label : `${label}: ${excerpt}`;
}

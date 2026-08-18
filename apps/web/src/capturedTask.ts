/**
 * Turning a passage into a task the board can hold.
 *
 * Agents end turns with work they noticed but did not do — "the legacy shim
 * could go now", "these two helpers want merging". That is a task, and the
 * only place a task survives is somewhere you will look again. Capturing puts
 * it in the project's Draft lane as a real thread carrying a queued prompt,
 * so it is on the board, in the sidebar, and on every device the user owns.
 *
 * Nothing is summarised or rewritten on the way in. The captured text becomes
 * the prompt verbatim and lands in the composer when the thread is opened, so
 * the user reads and edits exactly what the agent will receive — the same
 * promise side chats make about their quoted passage.
 *
 * @module capturedTask
 */

/**
 * Longest passage a capture will carry.
 *
 * A captured task is an instruction, not an excerpt, so this is roomier than
 * the side-chat quote cap. Past it the user is capturing a whole answer, and
 * the tail is dropped rather than the head: what to do is stated first.
 */
export const CAPTURED_TASK_MAX_CHARS = 2_000;

/** Longest derived title, in characters. Matches what a sidebar row shows
    before it truncates, so a title is rarely cut twice. */
export const CAPTURED_TASK_TITLE_MAX_CHARS = 72;

/** Fallback when a passage has no usable text — an empty capture still needs
    a name to be findable, and "Untitled" reads as broken. */
export const CAPTURED_TASK_FALLBACK_TITLE = "Captured task";

function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const hardCut = text.slice(0, maxChars);
  // Prefer a word boundary when one is close enough that keeping it does not
  // cost half the budget; otherwise the cut wins and the ellipsis explains it.
  const lastSpace = hardCut.lastIndexOf(" ");
  const body = lastSpace > maxChars / 2 ? hardCut.slice(0, lastSpace) : hardCut;
  return `${body.trimEnd()}…`;
}

/**
 * The prompt a captured task carries, or `null` when there is nothing to
 * capture. Callers treat `null` as "this passage is not a task" rather than
 * creating an empty thread nobody asked for.
 */
export function buildCapturedTaskPrompt(passage: string | null | undefined): string | null {
  const trimmed = (passage ?? "").trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= CAPTURED_TASK_MAX_CHARS
    ? trimmed
    : truncateAtBoundary(trimmed, CAPTURED_TASK_MAX_CHARS);
}

/** Markers that open a line: list bullets, ordered items, blockquotes,
    headings. Stripped repeatedly because they stack — "> ## Do the thing"
    is one heading inside one quote. */
const LINE_PREFIX_MARKUP = /^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+/;

function stripLineMarkup(line: string): string {
  let stripped = line;
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(LINE_PREFIX_MARKUP, "");
  } while (stripped !== previous);
  // Inline emphasis and code ticks, which a title styles for itself.
  return stripped.replace(/[*_`]/g, "").trim();
}

/**
 * A thread title for a captured task.
 *
 * The first line that says something, stripped of the markdown a passage
 * usually arrives wearing — a title reading "- **Drop the shim**" is noise in
 * a sidebar that already styles its own rows.
 */
export function buildCapturedTaskTitle(prompt: string): string {
  const firstMeaningfulLine = prompt
    .split("\n")
    .map((line) => stripLineMarkup(line))
    .find((line) => line.length > 0);
  if (firstMeaningfulLine === undefined) return CAPTURED_TASK_FALLBACK_TITLE;
  return truncateAtBoundary(firstMeaningfulLine, CAPTURED_TASK_TITLE_MAX_CHARS);
}

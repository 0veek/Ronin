/**
 * The opening context of a side chat.
 *
 * A side chat starts empty, in the same checkout, with none of the parent's
 * transcript — that is the whole point of opening one. But a question about a
 * message is meaningless without the message, so the anchored text is quoted
 * into the composer as the one piece of context that comes across.
 *
 * Quoted rather than injected invisibly: the user can see exactly what the
 * agent will see, edit it before sending, or delete it if they meant something
 * else. Nothing is carried that is not on screen.
 *
 * @module sideChatSeed
 */

/**
 * Longest anchored excerpt carried into the side chat.
 *
 * Long enough for a paragraph of reasoning or a short code block, short enough
 * that quoting a thousand-line answer does not defeat the point of starting
 * fresh. The tail is dropped rather than the head: an answer's opening lines
 * are what the question is usually about.
 */
export const SIDE_CHAT_EXCERPT_MAX_CHARS = 1_200;

/** Marker line that opens the quote, so the agent reads it as context. */
export const SIDE_CHAT_SEED_HEADING = "Asking about this from the other thread:";

function truncateExcerpt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SIDE_CHAT_EXCERPT_MAX_CHARS) return trimmed;
  // Cut at a line boundary when one is close, so the quote does not end
  // mid-word or halfway through a fenced block's opening line.
  const hardCut = trimmed.slice(0, SIDE_CHAT_EXCERPT_MAX_CHARS);
  const lastBreak = hardCut.lastIndexOf("\n");
  const body = lastBreak > SIDE_CHAT_EXCERPT_MAX_CHARS / 2 ? hardCut.slice(0, lastBreak) : hardCut;
  return `${body.trimEnd()}\n…`;
}

/**
 * Composer text for a side chat opened from a message.
 *
 * Returns an empty string when there is nothing worth quoting, which leaves
 * the composer blank rather than seeding an empty blockquote — a side chat
 * opened from a message that was only a tool call still works, it just starts
 * from nothing.
 */
export function buildSideChatSeedPrompt(messageText: string | null | undefined): string {
  const excerpt = truncateExcerpt(messageText ?? "");
  if (excerpt.length === 0) return "";
  const quoted = excerpt
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
  // Trailing blank line so the cursor lands under the quote with the question
  // already separated from it.
  return `${SIDE_CHAT_SEED_HEADING}\n\n${quoted}\n\n`;
}

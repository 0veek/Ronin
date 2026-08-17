/**
 * Deciding whether a text selection is a question waiting to be asked.
 *
 * Selecting a passage is the moment before "wait, what does that mean?" — so
 * that is where the affordance belongs, rather than on a hover row the reader
 * has to go hunting for. This module is the whole of the judgement about which
 * selections qualify, kept away from the DOM so the rules can be read and
 * tested directly.
 *
 * The bar is deliberately not zero. A stray click-drag while reading, a
 * double-click that grabs one word, a selection spanning two messages — none
 * of those are a question, and a chip that erupts on all of them is worse than
 * no chip at all.
 *
 * @module sideChatSelection
 */
import { SIDE_CHAT_EXCERPT_MAX_CHARS } from "./sideChatSeed";

/**
 * Shortest selection worth offering on.
 *
 * Two words: one word is usually a double-click landing somewhere while
 * reading, and it carries too little context to seed a useful question.
 */
export const SIDE_CHAT_SELECTION_MIN_WORDS = 2;

export interface SideChatSelectionEndpoint {
  /** `data-message-id` of the nearest enclosing message row, if any. */
  readonly messageId: string | null;
  /** `data-message-role` of that row. Only `assistant` qualifies. */
  readonly messageRole: string | null;
}

export interface SideChatSelectionCandidate {
  readonly messageId: string;
  /** The selected passage, collapsed and bounded, ready to quote. */
  readonly text: string;
}

/**
 * Collapse the whitespace a rendered selection drags along.
 *
 * Selecting across markdown picks up the indentation and blank lines of the
 * DOM rather than of the source, so the raw string is full of runs that would
 * quote badly. Paragraph breaks survive as a single blank line; everything
 * else becomes one space.
 */
export function normalizeSelectedPassage(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wordCount(text: string): number {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  return words.length;
}

/**
 * The selection as something worth offering a side chat on, or `null`.
 *
 * Both endpoints must sit in the same assistant message: a selection that
 * spans two messages has no single thing it is asking about, and one that
 * starts in the user's own prompt is not a question about an answer.
 */
export function resolveSideChatSelection(input: {
  readonly selectedText: string;
  readonly anchor: SideChatSelectionEndpoint;
  readonly focus: SideChatSelectionEndpoint;
}): SideChatSelectionCandidate | null {
  const { anchor, focus } = input;
  if (anchor.messageId === null || anchor.messageId !== focus.messageId) return null;
  if (anchor.messageRole !== "assistant") return null;

  const text = normalizeSelectedPassage(input.selectedText);
  if (wordCount(text) < SIDE_CHAT_SELECTION_MIN_WORDS) return null;

  return {
    messageId: anchor.messageId,
    // Bounded here rather than at quote time so what the chip promises and
    // what the composer receives are the same passage.
    text:
      text.length <= SIDE_CHAT_EXCERPT_MAX_CHARS
        ? text
        : `${text.slice(0, SIDE_CHAT_EXCERPT_MAX_CHARS - 1).trimEnd()}…`,
  };
}

export interface SideChatSelectionAnchor {
  /** Viewport coordinates of the horizontal centre of the selection. */
  readonly x: number;
  /** Viewport coordinate of the selection's top edge. */
  readonly y: number;
}

/**
 * Where the chip should sit for a selection rectangle.
 *
 * Centred over the selection and clamped into the viewport, because a
 * selection that ends at the right edge of a wide answer would otherwise push
 * the chip off screen — which is the one case where the reader most needs it.
 */
export function resolveSelectionAnchor(input: {
  readonly rect: { readonly left: number; readonly right: number; readonly top: number };
  readonly viewportWidth: number;
  readonly chipWidth: number;
  readonly margin?: number;
}): SideChatSelectionAnchor {
  const margin = input.margin ?? 8;
  const centre = (input.rect.left + input.rect.right) / 2;
  const half = input.chipWidth / 2;
  const min = margin + half;
  const max = Math.max(min, input.viewportWidth - margin - half);
  return {
    x: Math.min(Math.max(centre, min), max),
    y: input.rect.top,
  };
}

/**
 * The directive an orchestrator closes each turn with.
 *
 * Ronin injects no tools into a provider session, so a team cannot be
 * coordinated by giving the lead model a `delegate()` to call. What every
 * provider does have in common is text: it reads a prompt and it writes a
 * reply. So the protocol is a fenced block at the end of the reply, and this
 * module is the only thing that understands it.
 *
 * Parsing is deliberately forgiving about everything except the shape. A model
 * that spells the role "Reviewer", writes `"Delegate"`, or leaves a trailing
 * comma is trying to do the right thing, and failing the turn over it would
 * cost a real round trip to fix punctuation. What is *not* forgiven is an
 * ambiguous directive: two blocks disagreeing, or an action nobody can act on.
 *
 * @module directive
 */
import { BUILD_SYSTEM_DIRECTIVE_FENCE } from "@t3tools/contracts";

export type BuildSystemDirective =
  | {
      readonly action: "delegate";
      readonly role: string;
      readonly task: string;
      readonly context: string | null;
    }
  | { readonly action: "ask_user"; readonly question: string }
  | { readonly action: "done"; readonly summary: string };

export type DirectiveParseFailure =
  /** No fenced directive block at all — usually a model that just answered. */
  | { readonly reason: "missing" }
  /** The block is there but is not JSON. */
  | { readonly reason: "malformed"; readonly detail: string }
  /** Valid JSON, but not a directive we can act on. */
  | { readonly reason: "unknown-action"; readonly detail: string }
  /** The right action with a field missing or empty. */
  | { readonly reason: "incomplete"; readonly detail: string };

export type DirectiveParseResult =
  | { readonly ok: true; readonly directive: BuildSystemDirective }
  | { readonly ok: false; readonly failure: DirectiveParseFailure };

/**
 * Fenced blocks tagged for us.
 *
 * The info string is allowed trailing text (` ```t3-directive json `) because
 * editors and models both like to add it, and it carries no meaning here.
 */
const DIRECTIVE_BLOCK = new RegExp(
  "^[ \\t]*```[ \\t]*" + BUILD_SYSTEM_DIRECTIVE_FENCE + "[^\\n]*\\n([\\s\\S]*?)\\n?[ \\t]*```",
  "gm",
);

/**
 * A bare JSON object holding a recognisable action, used only as a fallback.
 *
 * Some models drop the fence once the conversation gets long. Rather than
 * spend a turn reminding them, we accept an unfenced object as long as it is
 * unmistakably a directive.
 */
const BARE_DIRECTIVE = /\{[^{}]*"action"[^{}]*\}/g;

function stripTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, "$1");
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeAction(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  if (raw === null) return null;
  return raw.toLowerCase().replace(/[\s-]+/g, "_");
}

function interpret(parsed: unknown): DirectiveParseResult {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      failure: { reason: "malformed", detail: "The block is not a JSON object." },
    };
  }

  const record = parsed as Record<string, unknown>;
  const action = normalizeAction(record["action"]);
  if (action === null) {
    return {
      ok: false,
      failure: { reason: "unknown-action", detail: 'The block has no "action" field.' },
    };
  }

  if (action === "delegate") {
    // `role` is the field the roster names, but a model that has just been
    // told about "teammates" reaches for `to` and `teammate` about as often.
    const role =
      asNonEmptyString(record["role"]) ??
      asNonEmptyString(record["to"]) ??
      asNonEmptyString(record["teammate"]);
    const task = asNonEmptyString(record["task"]) ?? asNonEmptyString(record["instructions"]);
    if (role === null) {
      return {
        ok: false,
        failure: { reason: "incomplete", detail: 'A delegate directive needs a "role".' },
      };
    }
    if (task === null) {
      return {
        ok: false,
        failure: { reason: "incomplete", detail: 'A delegate directive needs a "task".' },
      };
    }
    return {
      ok: true,
      directive: { action: "delegate", role, task, context: asNonEmptyString(record["context"]) },
    };
  }

  if (action === "ask_user" || action === "ask" || action === "question") {
    const question = asNonEmptyString(record["question"]) ?? asNonEmptyString(record["text"]);
    if (question === null) {
      return {
        ok: false,
        failure: { reason: "incomplete", detail: 'An ask_user directive needs a "question".' },
      };
    }
    return { ok: true, directive: { action: "ask_user", question } };
  }

  if (action === "done" || action === "complete" || action === "finished") {
    const summary = asNonEmptyString(record["summary"]) ?? asNonEmptyString(record["result"]);
    if (summary === null) {
      return {
        ok: false,
        failure: { reason: "incomplete", detail: 'A done directive needs a "summary".' },
      };
    }
    return { ok: true, directive: { action: "done", summary } };
  }

  return {
    ok: false,
    failure: { reason: "unknown-action", detail: `"${action}" is not an action this team knows.` },
  };
}

function parseJsonBlock(body: string): DirectiveParseResult {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { ok: false, failure: { reason: "malformed", detail: "The block is empty." } };
  }
  try {
    return interpret(JSON.parse(trimmed) as unknown);
  } catch {
    try {
      return interpret(JSON.parse(stripTrailingCommas(trimmed)) as unknown);
    } catch (error) {
      return {
        ok: false,
        failure: {
          reason: "malformed",
          detail: error instanceof Error ? error.message : "The block is not valid JSON.",
        },
      };
    }
  }
}

/**
 * Read the directive out of an orchestrator's reply.
 *
 * The *last* block wins. A model that reasons out loud will sometimes show a
 * draft directive mid-answer and then commit to a different one; the closing
 * block is the decision, and everything above it is working.
 */
export function parseBuildSystemDirective(message: string): DirectiveParseResult {
  const fenced = [...message.matchAll(DIRECTIVE_BLOCK)];
  const lastFenced = fenced.at(-1);
  if (lastFenced !== undefined) {
    return parseJsonBlock(lastFenced[1] ?? "");
  }

  const bare = [...message.matchAll(BARE_DIRECTIVE)];
  const lastBare = bare.at(-1);
  if (lastBare !== undefined) {
    const result = parseJsonBlock(lastBare[0]);
    // An unfenced object that does not parse into a directive is far more
    // likely to be prose containing the word "action" than a broken directive,
    // so it is reported as a plain miss rather than a formatting mistake.
    return result.ok ? result : { ok: false, failure: { reason: "missing" } };
  }

  return { ok: false, failure: { reason: "missing" } };
}

/** A sentence naming what was wrong, for the nudge sent back to the model. */
export function describeDirectiveFailure(failure: DirectiveParseFailure): string {
  switch (failure.reason) {
    case "missing":
      return "Your last message did not end with a directive block.";
    case "malformed":
      return `The directive block was not valid JSON (${failure.detail}).`;
    case "unknown-action":
      return `The directive block could not be acted on: ${failure.detail}`;
    case "incomplete":
      return `The directive block was missing something: ${failure.detail}`;
  }
}

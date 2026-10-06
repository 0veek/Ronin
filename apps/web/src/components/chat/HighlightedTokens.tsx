import { use, useMemo, type CSSProperties } from "react";

import { resolveDiffThemeName } from "../../lib/diffRendering";
import type { EmbeddedScript } from "../../lib/embeddedScripts";
import { getSyntaxHighlighterPromise } from "../../lib/syntaxHighlighting";

import {
  keyedLines,
  wordsOf,
  withEmbeddedScripts,
  type SyntaxToken,
} from "./HighlightedTokens.logic";

const NO_EMBEDDED_SCRIPTS: ReadonlyArray<EmbeddedScript> = [];

function syntaxTokenStyle(token: SyntaxToken): CSSProperties {
  const fontStyle = token.fontStyle ?? 0;
  return {
    ...(token.color ? { color: token.color } : {}),
    ...(fontStyle & 1 ? { fontStyle: "italic" } : {}),
    ...(fontStyle & 2 ? { fontWeight: 700 } : {}),
    ...(fontStyle & 4 ? { textDecoration: "underline" } : {}),
  };
}

/**
 * Colors `code` inside the caller's `<pre>` without changing its text, so
 * selection and copy match the plain version. Suspends while the grammar
 * loads; wrap it in Suspense with the plain text as the fallback.
 * `wordClassName` goes on each whitespace-separated word. `embedded`
 * scripts are colored with their own grammar inside `code`.
 */
export function HighlightedTokens({
  code,
  language,
  embedded = NO_EMBEDDED_SCRIPTS,
  theme,
  wordClassName,
}: {
  code: string;
  language: string;
  embedded?: ReadonlyArray<EmbeddedScript>;
  theme: "light" | "dark";
  wordClassName?: string;
}) {
  const highlighter = use(getSyntaxHighlighterPromise(language));
  // Every grammar loads into the same shared highlighter.
  for (const script of embedded) use(getSyntaxHighlighterPromise(script.language));
  const lines = useMemo(() => {
    const themeName = resolveDiffThemeName(theme);
    const tokenize = (text: string, lang: string) =>
      highlighter.codeToTokens(text, { lang, theme: themeName }).tokens;
    return keyedLines(
      code,
      withEmbeddedScripts(code, tokenize(code, language), embedded, tokenize),
    );
  }, [code, embedded, highlighter, language, theme]);

  return lines.map(({ key, tokens, ending }) => (
    <span key={key}>
      {wordClassName
        ? wordsOf(tokens).map((part) =>
            typeof part === "string" ? (
              part
            ) : (
              <span key={part.key} className={wordClassName}>
                {part.pieces.map((piece) => (
                  <span key={piece.key} style={syntaxTokenStyle(piece.token)}>
                    {piece.text}
                  </span>
                ))}
              </span>
            ),
          )
        : tokens.map((token) => (
            <span key={`${token.offset}:${token.content}`} style={syntaxTokenStyle(token)}>
              {token.content}
            </span>
          ))}
      {ending}
    </span>
  ));
}

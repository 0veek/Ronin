/**
 * Turning "here is the report I wrote" into the report itself.
 *
 * Agents that build a chart, a coverage report, or a mockup finish by writing
 * an HTML file and linking to it. Today that link is a chip you have to click,
 * which means leaving the conversation to see the thing the conversation was
 * about. This marks the paragraphs where that link is the entire point, so the
 * renderer can put the page inline instead.
 *
 * Deliberately narrow: only a paragraph that is *nothing but* a link to a local
 * HTML file qualifies. A link inside a sentence stays a chip — an iframe
 * erupting mid-paragraph would be worse than the click it saved.
 *
 * @module markdown-html-preview
 */

interface MarkdownAstNode {
  type?: string;
  url?: unknown;
  value?: unknown;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
}

/**
 * Whether a link destination is an HTML file on the agent's own disk.
 *
 * Remote pages are excluded on purpose: Ronin has a browser panel for those,
 * and silently framing a third-party URL inside a chat transcript is a
 * different and much larger decision than showing a local file.
 */
export function isLocalHtmlPreviewHref(href: string): boolean {
  const withoutQuery = href.split(/[?#]/, 1)[0] ?? "";
  if (!/\.html?$/i.test(withoutQuery)) return false;
  // A scheme means it is not a plain path. `file:` is still local; everything
  // else (http, https, data, mailto) is not ours to frame.
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutQuery)) {
    return withoutQuery.toLowerCase().startsWith("file:");
  }
  // Protocol-relative URLs are remote.
  return !withoutQuery.startsWith("//");
}

/** The workspace-relative or absolute path behind a qualifying href. */
export function localHtmlPreviewPath(href: string): string | null {
  const withoutQuery = href.split(/[?#]/, 1)[0] ?? "";
  if (withoutQuery.toLowerCase().startsWith("file:")) {
    try {
      const pathname = decodeURIComponent(new URL(withoutQuery).pathname);
      return pathname && pathname !== "/" ? pathname : null;
    } catch {
      return null;
    }
  }
  return withoutQuery.length > 0 ? withoutQuery : null;
}

/**
 * The single link a paragraph consists of, or `null` when it consists of
 * anything else.
 *
 * Whitespace-only text siblings are tolerated because a link on its own line
 * routinely parses with a trailing newline text node; anything with actual
 * characters in it means the paragraph is a sentence, not a presentation.
 */
function soleLinkChild(paragraph: MarkdownAstNode): MarkdownAstNode | null {
  const children = paragraph.children ?? [];
  let link: MarkdownAstNode | null = null;
  for (const child of children) {
    if (child.type === "link") {
      if (link !== null) return null;
      link = child;
      continue;
    }
    if (child.type === "text" && typeof child.value === "string" && child.value.trim() === "") {
      continue;
    }
    return null;
  }
  return link;
}

export function remarkHtmlPreview() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      node.children?.forEach(visit);
      if (node.type !== "paragraph") return;
      const link = soleLinkChild(node);
      if (link === null || typeof link.url !== "string") return;
      if (!isLocalHtmlPreviewHref(link.url)) return;
      const path = localHtmlPreviewPath(link.url);
      if (path === null) return;

      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          dataHtmlPreview: path,
        },
      };
    };
    visit(tree);
  };
}

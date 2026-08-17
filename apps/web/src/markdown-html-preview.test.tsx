import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";

import {
  isLocalHtmlPreviewHref,
  localHtmlPreviewPath,
  remarkHtmlPreview,
} from "./markdown-html-preview";

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkHtmlPreview]}>{markdown}</ReactMarkdown>,
  );
}

describe("isLocalHtmlPreviewHref", () => {
  it("accepts local html paths", () => {
    expect(isLocalHtmlPreviewHref("report.html")).toBe(true);
    expect(isLocalHtmlPreviewHref("./out/chart.htm")).toBe(true);
    expect(isLocalHtmlPreviewHref("/tmp/run/audit.html")).toBe(true);
    expect(isLocalHtmlPreviewHref("file:///tmp/report.html")).toBe(true);
  });

  it("ignores query strings and fragments when reading the extension", () => {
    expect(isLocalHtmlPreviewHref("report.html?v=2")).toBe(true);
    expect(isLocalHtmlPreviewHref("report.html#section")).toBe(true);
  });

  it("refuses remote pages", () => {
    // Ronin has a browser panel for these; framing someone else's page inside
    // a transcript is a much bigger decision than showing a local file.
    expect(isLocalHtmlPreviewHref("https://example.com/report.html")).toBe(false);
    expect(isLocalHtmlPreviewHref("//example.com/report.html")).toBe(false);
  });

  it("refuses anything that is not html", () => {
    expect(isLocalHtmlPreviewHref("report.md")).toBe(false);
    expect(isLocalHtmlPreviewHref("chart.svg")).toBe(false);
    expect(isLocalHtmlPreviewHref("notes")).toBe(false);
  });
});

describe("localHtmlPreviewPath", () => {
  it("strips the query so the asset endpoint gets a real path", () => {
    expect(localHtmlPreviewPath("out/report.html?v=2")).toBe("out/report.html");
  });

  it("decodes a file URL to its path", () => {
    expect(localHtmlPreviewPath("file:///tmp/my%20report.html")).toBe("/tmp/my report.html");
  });

  it("declines a file URL with no file in it", () => {
    expect(localHtmlPreviewPath("file:///")).toBeNull();
  });
});

describe("remarkHtmlPreview", () => {
  it("marks a paragraph that is only a link to a local html file", () => {
    expect(renderMarkdown("[Coverage report](coverage/index.html)")).toContain(
      'data-html-preview="coverage/index.html"',
    );
  });

  it("tolerates the trailing newline a link on its own line parses with", () => {
    expect(renderMarkdown("Here you go:\n\n[Report](report.html)\n")).toContain(
      'data-html-preview="report.html"',
    );
  });

  it("leaves a link inside a sentence alone", () => {
    // An iframe erupting mid-sentence is worse than the click it would save.
    expect(renderMarkdown("See the [report](report.html) for details.")).not.toContain(
      "data-html-preview",
    );
  });

  it("leaves a paragraph with two links alone", () => {
    expect(renderMarkdown("[a](a.html)\n[b](b.html)")).not.toContain("data-html-preview");
  });

  it("leaves remote and non-html links alone", () => {
    expect(renderMarkdown("[Report](https://example.com/report.html)")).not.toContain(
      "data-html-preview",
    );
    expect(renderMarkdown("[Notes](notes.md)")).not.toContain("data-html-preview");
  });
});

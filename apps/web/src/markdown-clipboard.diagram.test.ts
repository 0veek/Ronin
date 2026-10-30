// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";

import { chatMarkdownClipboardPayload, serializeCodeBlockToMarkdown } from "./markdown-clipboard";

describe("diagram selection copying", () => {
  it.each(["inside", "across"])("copies original source for a selection %s a diagram", (mode) => {
    const source = "flowchart LR\nA[Start] --> B[End]";
    const markdown = serializeCodeBlockToMarkdown(source, "mermaid").trim();
    const host = document.createElement("div");
    host.innerHTML =
      "<p>Before</p><div data-markdown-mermaid><svg><text>Start</text></svg></div><p>After</p>";
    host
      .querySelector("[data-markdown-mermaid]")!
      .setAttribute("data-markdown-copy", `${markdown}\n\n`);
    document.body.append(host);
    const selection = window.getSelection()!;
    const range = document.createRange();
    if (mode === "inside") {
      const label = host.querySelector("text")!.firstChild!;
      range.setStart(label, 1);
      range.setEnd(label, 3);
    } else {
      range.setStart(host.firstChild!.firstChild!, 0);
      range.setEnd(host.lastChild!.firstChild!, 5);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      const copied = chatMarkdownClipboardPayload(selection);
      expect(copied?.text).toBe(mode === "inside" ? markdown : `Before\n\n${markdown}\n\nAfter`);
      const html = new DOMParser().parseFromString(copied!.html, "text/html");
      expect(html.querySelector("pre code")?.textContent).toBe(markdown);
      expect(html.querySelector("svg")).toBeNull();
    } finally {
      selection.removeAllRanges();
      host.remove();
    }
  });

  it("chooses a fence longer than embedded fences and removes one parser newline", () => {
    expect(serializeCodeBlockToMarkdown("A[```]\n", "mermaid")).toBe(
      "````mermaid\nA[```]\n````\n\n",
    );
  });
});

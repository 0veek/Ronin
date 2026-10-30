// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";

import { chatMarkdownClipboardPayload, serializeTableElementToCsv } from "./markdown-clipboard";
import {
  captureAssistantTextSelection,
  resolveAssistantCitationRange,
} from "./lib/assistantTextSelection";

function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe("copying rendered math", () => {
  it("exports table formulas as TeX once, without duplicated accessibility glyphs", () => {
    document.body.innerHTML =
      '<table><tbody><tr><td>Area</td><td><span data-markdown-math="inline" data-markdown-copy="\\(x^2\\)"><span>x²</span><span>x²</span></span></td></tr></tbody></table>';
    expect(serializeTableElementToCsv(document.querySelector("table")!)).toBe("Area,\\(x^2\\)");
  });

  it("captures and resolves a citation touching a formula using its TeX", () => {
    document.body.innerHTML =
      '<div id="viewport"><div data-assistant-citation-source><p>Area <span data-markdown-math="inline" data-markdown-copy="\\(x^2\\)"><span>x²</span><span>x²</span></span> grows.</p></div></div>';
    const root = document.querySelector<HTMLElement>("[data-assistant-citation-source]")!;
    const formula = root.querySelector("[data-markdown-math]")!;
    const glyphs = formula.firstChild!.firstChild!;
    const captured = captureAssistantTextSelection(
      document.querySelector("#viewport")!,
      select(glyphs, 0, glyphs, 1),
    );
    expect(captured?.selector.text).toBe("\\(x^2\\)");
    const resolved = resolveAssistantCitationRange(root, captured!.selector)!;
    expect(resolved.cloneContents().querySelector("[data-markdown-math]")).not.toBeNull();
  });

  it("copies a formula's TeX whether the selection spans it or starts inside it", () => {
    document.body.innerHTML = `<div class="chat-markdown"><p>Area <span data-markdown-math="" data-markdown-copy="$\\pi r^2$"><span class="katex"><span class="katex-mathml">πr2</span><span class="katex-html" aria-hidden="true">πr2</span></span></span> grows.</p></div>`;
    const paragraph = document.querySelector("p")!;
    const glyphs = document.querySelector(".katex-mathml")!.firstChild!;

    expect(
      chatMarkdownClipboardPayload(select(paragraph.firstChild!, 0, paragraph.lastChild!, 7))?.text,
    ).toBe("Area $\\pi r^2$ grows.");
    expect(chatMarkdownClipboardPayload(select(glyphs, 0, glyphs, 1))?.text).toBe("$\\pi r^2$");
  });
});

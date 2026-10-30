// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";

import { sanitizeDiagramSvg, sanitizeMathDiagramSvg } from "./mermaidSvg";

describe("Mermaid diagram SVG", () => {
  it("strips navigation, scripts, remote images, and CSS fetches", () => {
    const document = sanitizeDiagramSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
      <script>alert(1)</script><a href="https://example.com"><text>Label</text></a>
      <image href="https://example.com/image.png" />
      <style>.node { fill: url(https://example.com/fill); }</style>
      <path style="filter: url('https://example.com/filter')" d="M0 0L1 1" />
    </svg>`);
    const svg = new XMLSerializer().serializeToString(document);
    expect(document.querySelector("script, a, image, [onload], [href]")).toBeNull();
    expect(svg).not.toContain("https://example.com");
    expect(document.querySelector("text")?.textContent).toBe("Label");
  });

  it("keeps diagram geometry, labels, and local marker references", () => {
    const document =
      sanitizeDiagramSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
      <defs><marker id="arrow"><path d="M0 0L1 1" /></marker></defs>
      <path d="M0 0L100 50" style="marker-end: url(#arrow)" />
      <text x="10" y="20">Start &amp; finish</text>
    </svg>`);
    const svg = new XMLSerializer().serializeToString(document);
    expect(document.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 100 50");
    expect(document.querySelector("marker")?.id).toBe("arrow");
    expect(svg).toContain("url(#arrow)");
    expect(document.querySelector("text")?.textContent).toBe("Start & finish");
  });

  it("preserves MathML labels only inside an HTML integration point", () => {
    const fragment = sanitizeMathDiagramSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><math xmlns="http://www.w3.org/1998/Math/MathML">
        <mfrac linethickness="0"><mi>x</mi><mn>2</mn></mfrac>
      </math></div></foreignObject>
      <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>outside</mi></math>
    </svg>`);
    expect(fragment.querySelectorAll("math")).toHaveLength(1);
    expect(fragment.querySelector("mfrac")?.getAttribute("linethickness")).toBe("0");
    expect(fragment.querySelector("mi")?.textContent).toBe("x");
    expect(
      sanitizeDiagramSvg(new XMLSerializer().serializeToString(fragment)).querySelector(
        "foreignObject",
      ),
    ).toBeNull();
  });

  it("strips active content from math labels and preserves local SVG references", () => {
    const fragment = sanitizeMathDiagramSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <style>@import 'https://example.com/style';</style>
      <path style="fill:url(#local);filter:url(https://example.com/filter)" />
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(1)">
        <script>alert(1)</script><img src="https://example.com/image" />
        <math xmlns="http://www.w3.org/1998/Math/MathML"><mi href="https://example.com">x</mi>
          <mglyph src="https://example.com/glyph" /><annotation-xml><script>alert(1)</script></annotation-xml>
        </math>
      </div></foreignObject>
    </svg>`);
    expect(
      fragment.querySelector(
        "script, style, img, mglyph, annotation-xml, [onclick], [href], [src]",
      ),
    ).toBeNull();
    const svg = new XMLSerializer().serializeToString(fragment);
    expect(svg).not.toContain("https://example.com");
    expect(svg).toContain("url(#local)");
    expect(fragment.querySelector("mi")?.textContent).toBe("x");
  });
});

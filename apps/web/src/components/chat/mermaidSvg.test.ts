// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";

import { sanitizeMermaidSvg } from "./mermaidSvg";

describe("Mermaid diagram SVG", () => {
  it("strips navigation, scripts, remote images, and CSS fetches", () => {
    const svg = sanitizeMermaidSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
      <script>alert(1)</script><a href="https://example.com"><text>Label</text></a>
      <image href="https://example.com/image.png" />
      <style>.node { fill: url(https://example.com/fill); }</style>
      <path style="filter: url('https://example.com/filter')" d="M0 0L1 1" />
    </svg>`);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(document.querySelector("script, a, image, [onload], [href]")).toBeNull();
    expect(svg).not.toContain("https://example.com");
    expect(document.querySelector("text")?.textContent).toBe("Label");
  });

  it("keeps diagram geometry, labels, and local marker references", () => {
    const svg = sanitizeMermaidSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
      <defs><marker id="arrow"><path d="M0 0L1 1" /></marker></defs>
      <path d="M0 0L100 50" style="marker-end: url(#arrow)" />
      <text x="10" y="20">Start &amp; finish</text>
    </svg>`);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(document.documentElement.getAttribute("viewBox")).toBe("0 0 100 50");
    expect(document.querySelector("marker")?.id).toBe("arrow");
    expect(svg).toContain("url(#arrow)");
    expect(document.querySelector("text")?.textContent).toBe("Start & finish");
  });
});

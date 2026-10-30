// @vitest-environment jsdom

import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { serializeRenderedMarkdownFragment } from "../../markdown-clipboard";
import { MermaidDiagram } from "./MermaidDiagram";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("diagram rendering", () => {
  it("keeps original source for copying, expands a standalone image, and recovers from unsupported syntax", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const expand = vi.fn();
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:diagram");
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL = createObjectURL;
        static override revokeObjectURL = vi.fn();
      },
    );
    const render = async (source: string, expandable = true) => {
      await act(async () => {
        root.render(
          <Suspense fallback="Loading diagram">
            <MermaidDiagram source={source} onExpand={expandable ? expand : undefined} />
          </Suspense>,
        );
        await vi.dynamicImportSettled();
      });
      await vi.waitFor(() => {
        expect(container.textContent).not.toBe("Loading diagram");
      });
    };
    try {
      const source = "flowchart LR\nA[Original] --> B[End]";
      await render(source);
      expect(container.querySelector("svg")?.textContent).toContain("Original");
      expect(
        container.querySelector("[data-markdown-copy]")?.getAttribute("data-markdown-copy"),
      ).toBe("```mermaid\n" + source + "\n```\n\n");
      expect(serializeRenderedMarkdownFragment(container)).toBe("```mermaid\n" + source + "\n```");
      const svg = container.querySelector("svg");
      svg?.style.setProperty("--pele-fg", "rgb(1, 2, 3)");
      await act(async () => container.querySelector("button")?.click());
      expect(expand).toHaveBeenCalledWith("blob:diagram");
      const blob = createObjectURL.mock.calls[0]![0];
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
        reader.addEventListener("error", reject, { once: true });
        reader.readAsText(blob);
      });
      expect(image).toContain("--pele-fg: rgb(1, 2, 3)");
      expect(
        new DOMParser().parseFromString(image, "image/svg+xml").querySelector("parsererror"),
      ).toBeNull();

      await render("unsupportedDiagram\nkeep my source");
      expect(container.textContent).toContain("Unable to render diagram");
      expect(container.querySelector("pre")?.textContent).toBe(
        "unsupportedDiagram\nkeep my source",
      );
      await render("flowchart LR\nA[Recovered] --> B[Done]", false);
      expect(container.textContent).not.toContain("Unable to render diagram");
      expect(container.querySelector("svg")?.textContent).toContain("Recovered");
      expect(container.querySelector("button")).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

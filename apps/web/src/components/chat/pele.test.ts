// @vitest-environment jsdom

import { detectType, load, mount, render } from "pele/lazy";
import { describe, expect, it, vi } from "vite-plus/test";

import { sanitizeDiagramSvg, sanitizeMathDiagramSvg } from "./mermaidSvg";

const options = {
  measurer: { width: (text: string, size: number) => text.length * size * 0.6 },
  links: false,
  images: false,
  autoDirection: false,
};

describe("Pele Mermaid compatibility", () => {
  it.each([
    ["flowchart LR\nA[Start] --> B[Finish]", "flowchart", "Start"],
    ["sequenceDiagram\nAlice->>Bob: Hello", "sequence", "Hello"],
    ["classDiagram\nAnimal <|-- Duck", "class", "Animal"],
    ["stateDiagram-v2\n[*] --> Ready", "state", "Ready"],
    ["erDiagram\nCUSTOMER ||--o{ ORDER : places", "er", "CUSTOMER"],
    ['pie title Pets\n"Dogs" : 3\n"Cats" : 2', "pie", "Dogs"],
  ])("renders %s using its lazy diagram module", async (source, type, label) => {
    const detected = detectType(source);
    expect(detected).toBe(type);
    expect(await load(detected)).toBe(true);
    const result = render(source, options);
    const fragment = sanitizeDiagramSvg(result.svg);
    expect(result.type).toBe(type);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(fragment.querySelector("svg")).not.toBeNull();
    expect(fragment.textContent).toContain(label);
  });

  it("renders math labels through the sanitizer without permitting links", async () => {
    await load("flowchart");
    const result = render('flowchart LR\nA["$$x^2$$"] --> B[End]', {
      ...options,
      math: () => ({
        html: '<math xmlns="http://www.w3.org/1998/Math/MathML"><msup><mi>x</mi><mn>2</mn></msup></math>',
        width: 30,
        height: 20,
      }),
    });
    const fragment = sanitizeMathDiagramSvg(result.svg);
    expect(fragment.querySelector("math msup")?.textContent).toBe("x2");
    expect(fragment.querySelector("a, image, script")).toBeNull();
  });

  it("reports unsupported source and recovers on update, then releases its observer", async () => {
    await load("flowchart");
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const container = document.createElement("span");
    Object.defineProperty(container, "clientWidth", { value: 600 });
    document.body.append(container);
    const errors = vi.fn();
    const rendered = vi.fn();
    try {
      const diagram = mount(container, "unknownDiagram\nA --> B", {
        ...options,
        zoom: false,
        sanitize: sanitizeDiagramSvg,
        onError: errors,
        onRender: rendered,
      });
      expect(errors).toHaveBeenCalledOnce();
      expect(diagram.error).not.toBeNull();
      diagram.update("flowchart LR\nA[Recovered] --> B[End]");
      expect(rendered).toHaveBeenCalledOnce();
      expect(container.querySelector("svg")?.textContent).toContain("Recovered");
      diagram.destroy();
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});

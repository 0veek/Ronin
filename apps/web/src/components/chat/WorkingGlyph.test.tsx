import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { WorkingGlyph } from "./WorkingGlyph";

describe("WorkingGlyph", () => {
  it("draws two opposing ninjas, their blades, and an impact spark", () => {
    const markup = renderToStaticMarkup(<WorkingGlyph />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("working-ninja-left");
    expect(markup).toContain("working-ninja-right");
    expect(markup).toContain("working-ninja-blade-left");
    expect(markup).toContain("working-ninja-blade-right");
    expect(markup).toContain("working-ninja-spark");
  });

  it("inherits its color and does not fall back to the generic status pulse", () => {
    const markup = renderToStaticMarkup(<WorkingGlyph />);

    expect(markup).toContain("text-primary");
    expect(markup).not.toContain("animate-status-pulse");
  });
});

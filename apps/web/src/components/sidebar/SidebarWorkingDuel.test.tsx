import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarWorkingDuel } from "./SidebarWorkingDuel";

describe("SidebarWorkingDuel", () => {
  it("draws two opposing ninjas and an impact spark beside the working timer", () => {
    const markup = renderToStaticMarkup(<SidebarWorkingDuel animated />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('data-animated="true"');
    expect(markup).toContain("text-primary");
    expect(markup).toContain("working-ninja-left");
    expect(markup).toContain("working-ninja-right");
    expect(markup).toContain("working-ninja-spark");
  });

  it("rests when its thread is not active", () => {
    expect(renderToStaticMarkup(<SidebarWorkingDuel animated={false} />)).toContain(
      'data-animated="false"',
    );
  });
});

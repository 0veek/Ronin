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

  it("parks the looping duel while the window is hidden", () => {
    expect(renderToStaticMarkup(<SidebarWorkingDuel animated />)).toContain("loops-forever");
  });

  it("does not park the resting duel, which has no loop to stop", () => {
    expect(renderToStaticMarkup(<SidebarWorkingDuel animated={false} />)).not.toContain(
      "loops-forever",
    );
  });

  it("bows once when the thread settles, without claiming a loop to park", () => {
    const markup = renderToStaticMarkup(<SidebarWorkingDuel animated={false} settled />);

    expect(markup).toContain('data-settled="true"');
    expect(markup).not.toContain("loops-forever");
  });

  it("fights rather than bows while a turn is still running", () => {
    expect(renderToStaticMarkup(<SidebarWorkingDuel animated />)).toContain('data-settled="false"');
  });
});

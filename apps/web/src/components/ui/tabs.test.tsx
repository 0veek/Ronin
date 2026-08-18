import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function renderTabs(variant?: "underline" | "segment") {
  return renderToStaticMarkup(
    <Tabs defaultValue="diff">
      <TabsList aria-label="Panel surface" {...(variant ? { variant } : {})}>
        <TabsTrigger value="diff" {...(variant ? { variant } : {})}>
          Diff
        </TabsTrigger>
        <TabsTrigger value="files" {...(variant ? { variant } : {})}>
          Files
        </TabsTrigger>
      </TabsList>
      <TabsContent value="diff">Diff panel</TabsContent>
    </Tabs>,
  );
}

describe("tabs primitive", () => {
  it("renders an indicator that tracks the active tab's measured box", () => {
    const html = renderTabs();

    expect(html).toContain('data-slot="tabs-indicator"');
    expect(html).toContain("translate-x-[var(--active-tab-left)]");
    expect(html).toContain("w-[var(--active-tab-width)]");
  });

  it("defaults to the underline variant used by panel headers", () => {
    const html = renderTabs();

    expect(html).toContain('data-variant="underline"');
    expect(html).toContain("border-b");
    // The underline marker is a hairline, not a filled pill.
    expect(html).toContain("h-px");
  });

  it("renders the segmented control as a filled track with a raised thumb", () => {
    const html = renderTabs("segment");

    expect(html).toContain('data-variant="segment"');
    expect(html).toContain("bg-secondary");
    expect(html).toContain("shadow-[var(--shadow-raised)]");
    expect(html).toContain("h-[var(--active-tab-height)]");
  });

  it("marks the selected trigger so the label can shift with the indicator", () => {
    const html = renderTabs();

    expect(html).toContain("data-selected:text-foreground");
    expect(html).toContain('data-slot="tabs-trigger"');
  });
});

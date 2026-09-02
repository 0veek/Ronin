import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";

const banner = (
  id: string,
  variant: ComposerBannerStackItem["variant"] = "warning",
): ComposerBannerStackItem => ({
  id,
  variant,
  icon: <span aria-hidden="true">!</span>,
  title: `${id} warning`,
});

describe("ComposerBannerStack", () => {
  it("collapses hidden banners behind a focusable peek that controls the expandable region", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front"), banner("stacked")]} />,
    );

    const expandedItems = markup.match(
      /<div id="([^"]+)"[^>]*data-composer-banner-stack-expanded-items="true" class="([^"]+)">/,
    );

    // Hover alone cannot reveal the stack on a touchscreen, so the peek is a
    // real control: labelled, expandable, and wired to the region it opens.
    expect(markup).toContain('aria-label="Show other notices"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(`aria-controls="${expandedItems?.[1]}"`);
    expect(markup).toContain('role="group" aria-label="Other notices"');
    expect(expandedItems?.[2]).toContain("grid-rows-[0fr]");
    expect(expandedItems?.[2]).not.toContain("absolute");
    expect(markup.indexOf("front warning")).toBeLessThan(markup.indexOf("stacked warning"));
    expect(markup).toContain("invisible pointer-events-none");
  });

  it("colors the collapsed peek by the hidden banner's variant, not a fixed warning", () => {
    const neutralBehind = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front", "default"), banner("stacked", "default")]} />,
    );
    expect(neutralBehind).toContain("border-border");
    expect(neutralBehind).not.toContain("border-warning/24");

    const warningBehind = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front", "default"), banner("stacked", "warning")]} />,
    );
    expect(warningBehind).toContain("border-warning/24");
  });

  it("does not render an expandable region for a single banner", () => {
    const markup = renderToStaticMarkup(<ComposerBannerStack items={[banner("front")]} />);

    expect(markup).not.toContain("data-composer-banner-stack-expanded-items");
    expect(markup).toContain("surface-alert");
    expect(markup).toContain('data-variant="warning"');
    expect(markup).toContain("transform:none");
    expect(markup).not.toContain("will-change:transform");
  });

  it("applies item-specific surface and action layout classes", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          {
            ...banner("branch"),
            className: "branch-surface",
            actionClassName: "branch-actions",
            actions: <button type="button">Repair</button>,
          },
        ]}
      />,
    );

    expect(markup).toContain("branch-surface");
    expect(markup).toContain("branch-actions");
  });

  it("renders a disabled compaction action on the shared accessible banner surface", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          {
            id: "resume-compaction",
            variant: "info",
            icon: <span aria-hidden="true">!</span>,
            title: "Resume with less context",
            description: "250k tokens from an older session",
            actions: (
              <button type="button" disabled>
                Compact
              </button>
            ),
            dismissLabel: "Keep full history",
            onDismiss: () => {},
          },
        ]}
      />,
    );

    expect(markup).toContain('role="alert"');
    // Ronin's banner surface is the unconditional `surface-alert` treatment;
    // upstream's attached/floating split does not exist here.
    expect(markup).toContain("surface-alert");
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-label="Keep full history"');
  });
});

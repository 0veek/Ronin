// @effect-diagnostics nodeBuiltinImport:off - The wordmark rule is CSS, so the
// only way to pin it against the width constant is to read the stylesheet.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { THREAD_SIDEBAR_MIN_WIDTH } from "./threadSidebarWidth";

describe("thread sidebar width", () => {
  it("shows the desktop wordmark across the sidebar's full legal width range", () => {
    // The bug: the wordmark was gated at 13.5rem while the sidebar's own
    // minimum is 13rem, so the last 8px of legal drag hid it. The stage label
    // keeps its query because its threshold really is above the minimum.
    const chromeStyles = NodeFS.readFileSync(
      new URL("../styles/chrome.css", import.meta.url),
      "utf8",
    );
    const desktopHeaderStyles = chromeStyles.slice(
      chromeStyles.indexOf("@media (min-width: 48rem)"),
      chromeStyles.indexOf("/* Stage-channel sidebar art"),
    );
    const stageLabelThreshold = desktopHeaderStyles.match(
      /@container sidebar-header \(min-width: ([\d.]+)rem\) \{\s*\.sidebar-brand-stage \{\s*display: inline-flex;/,
    )?.[1];

    expect(chromeStyles).toMatch(/\.sidebar-brand \{\s*display: none;/);
    expect(desktopHeaderStyles).toMatch(/\.sidebar-brand \{\s*display: flex;/);
    expect(desktopHeaderStyles).not.toMatch(
      /@container sidebar-header \([^)]*\) \{\s*\.sidebar-brand \{/,
    );
    expect(THREAD_SIDEBAR_MIN_WIDTH).toBe(13 * 16);
    expect(Number(stageLabelThreshold) * 16).toBeGreaterThan(THREAD_SIDEBAR_MIN_WIDTH);
  });
});

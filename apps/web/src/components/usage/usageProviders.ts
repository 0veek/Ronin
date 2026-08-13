import type { UsageProviderKind } from "@t3tools/contracts";

import { ClaudeAI, GrokIcon, type Icon, OpenAI } from "../Icons";

/**
 * Series and table order, and the palette's slot order.
 *
 * The chart layers every provider from a shared zero baseline, so this does not
 * decide which series sits above another; it fixes the reading order of
 * legends, tables and hover rows, and — because the colors below were validated
 * as an ordered set — which hue each provider owns.
 */
export const PROVIDER_ORDER: readonly UsageProviderKind[] = ["claude", "codex", "grok"];

export const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
};

/** Compact form, for legends and axes where the full name would wrap. */
export const PROVIDER_SHORT_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
};

/**
 * Series color, as the token rather than a literal.
 *
 * Both modes are declared in `styles/tokens.css`; reading the variable is what
 * makes every mark on the page follow the theme without a second render or a
 * media query in JS. Set it as `color` on a wrapper and let marks paint with
 * `currentColor`, so gradients and strokes inherit the same value.
 */
export const PROVIDER_COLOR: Record<UsageProviderKind, string> = {
  claude: "var(--provider-claude)",
  codex: "var(--provider-codex)",
  grok: "var(--provider-grok)",
};

/**
 * Brand marks, reused from the provider picker.
 *
 * These are the page's secondary identity channel: the palette carries the
 * series, the glyph confirms it for anyone the hues collapse for. They ship
 * their own brand fills, which no longer match the chart, so callers that want
 * them keyed to a series paint them with `fill-current`.
 */
export const PROVIDER_MARK: Record<UsageProviderKind, Icon> = {
  claude: ClaudeAI,
  codex: OpenAI,
  grok: GrokIcon,
};

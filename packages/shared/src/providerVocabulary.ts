/**
 * What the three quota-reporting providers are called, and in what order.
 *
 * This used to be four separate maps -- one in the usage page, one in the
 * sidebar meter, one in the composer's status dialog, one in the settings
 * driver registry -- which is how the app ended up calling the same provider
 * "Claude Code" in a chart legend and "Claude" in a quota meter nine hundred
 * pixels below it, on the same screen.
 *
 * @module providerVocabulary
 */
import type { RateLimitWindow, UsageProviderKind } from "@t3tools/contracts";

/**
 * Series and table order, and the palette's slot order.
 *
 * The chart layers every provider from a shared zero baseline, so this does not
 * decide which series sits above another; it fixes the reading order of
 * legends, tables and hover rows, and -- because the series colors were
 * validated as an ordered set -- which hue each provider owns. Anything that
 * lists all three reads them in this order, so a reader never has to re-map
 * color to provider crossing from one panel to the next.
 */
export const PROVIDER_ORDER: readonly UsageProviderKind[] = ["claude", "codex", "grok"];

/**
 * The canonical name. Each is the vendor's own product name, which is why the
 * set is not uniform in length: the CLI is called Claude Code, not Claude.
 * Use this everywhere it fits.
 */
export const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  grok: "Grok",
};

/**
 * The narrow-column form.
 *
 * Exactly one surface earns it: the sidebar quota meter, whose name column is
 * ~64px at the default 16rem sidebar and would truncate the canonical name
 * mid-word. Everywhere else, use `PROVIDER_LABEL` -- a second name in a place
 * that had room for the first is how the two drifted apart before.
 */
export const PROVIDER_SHORT_LABEL: Record<UsageProviderKind, string> = {
  claude: "Claude",
  codex: "Codex",
  grok: "Grok",
};

/**
 * Driver kinds -- the wider set, of which the three above are the subset that
 * reports quota. Settings lists all of these; the composer names whichever one
 * a thread is running on.
 *
 * The overlapping entries deliberately repeat `PROVIDER_LABEL`'s wording. A
 * driver and a quota provider are different things, but when they are the same
 * product they have to have the same name, which is what went wrong before:
 * Settings said "Claude" while the stats page said "Claude Code".
 */
export const DRIVER_LABEL = {
  antigravity: "Antigravity",
  claude: "Claude Code",
  claudeAgent: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  droid: "Droid",
  grok: "Grok",
  kilo: "Kilo",
  opencode: "OpenCode",
  pi: "Pi",
} as const satisfies Record<string, string>;

/**
 * A driver kind as a name a person would say.
 *
 * Unknown kinds are title-cased rather than dropped, so a driver added on the
 * server reads acceptably in a client that predates it.
 */
export function driverDisplayName(kind: string | null | undefined): string {
  if (!kind) return "This agent";
  const known = (DRIVER_LABEL as Record<string, string | undefined>)[kind];
  if (known !== undefined) return known;
  const trimmed = kind.replace(/Agent$/i, "").trim();
  if (trimmed.length === 0) return kind;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Rolling quota windows, spelled for prose and for tooltips. */
export const RATE_LIMIT_WINDOW_LABEL: Record<RateLimitWindow["kind"], string> = {
  session: "5-hour",
  weekly: "Weekly",
  monthly: "Monthly",
};

/**
 * The tag form, for the meter's window column. Lowercase unit letters on
 * purpose: these sit beside a "resets in 3h" countdown that uses the same
 * units, and `5H · resets in 3h` reads as two different measures.
 */
export const RATE_LIMIT_WINDOW_SHORT_LABEL: Record<RateLimitWindow["kind"], string> = {
  session: "5h",
  weekly: "Week",
  monthly: "30d",
};

/** The window a tooltip names in full, e.g. "7-day window". */
export const RATE_LIMIT_WINDOW_SCOPE: Record<RateLimitWindow["kind"], string> = {
  session: "5-hour window",
  weekly: "7-day window",
  monthly: "30-day window",
};

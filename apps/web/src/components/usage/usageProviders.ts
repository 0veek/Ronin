import type { UsageProviderKind } from "@t3tools/contracts";
import { PROVIDER_ORDER } from "@t3tools/shared/providerVocabulary";

import { AntigravityIcon, ClaudeAI, GrokIcon, type Icon, OpenAI } from "../Icons";

/*
 * Names and order now live in `@t3tools/shared/providerVocabulary`, because the
 * sidebar meter and the composer's status dialog need them too and each had
 * grown its own copy. Re-exported here so this module stays the one import a
 * usage surface needs for everything about a provider.
 */
export {
  PROVIDER_LABEL,
  PROVIDER_ORDER,
  PROVIDER_SHORT_LABEL,
} from "@t3tools/shared/providerVocabulary";

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
  antigravity: "var(--provider-antigravity)",
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
  antigravity: AntigravityIcon,
};

/**
 * Providers with real activity in the window, independent of the metric shown.
 *
 * Only the time breakdown uses this. The provider panel and the chart legend
 * deliberately keep every provider at zero -- see `providerRows` -- but the
 * table is not a legend, and one column per idle provider is five columns of
 * `$0.00` between the reader and the numbers they came for.
 */
export function providersWithUsage(
  totals: readonly {
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
  }[],
): readonly UsageProviderKind[] {
  const active = new Set(
    totals
      .filter((entry) => entry.totalTokens > 0 || entry.costUsd > 0)
      .map((entry) => entry.provider),
  );
  return PROVIDER_ORDER.filter((provider) => active.has(provider));
}

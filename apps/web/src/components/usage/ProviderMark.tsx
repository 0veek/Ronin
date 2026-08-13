import type { UsageProviderKind } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { PROVIDER_COLOR, PROVIDER_MARK } from "./usageProviders";

/**
 * A provider's brand mark, optionally painted in that provider's series color.
 *
 * `tinted` is how the page keys a glyph to the chart: the marks ship their own
 * brand fills (and a light/dark pair for the two monochrome ones), so both the
 * base and the dark override have to be replaced for the series color to win in
 * either mode. Tinted, the mark is the legend swatch and the identity glyph at
 * once, which is why nothing on this page needs a separate colour dot.
 */
export function ProviderMark({
  provider,
  className,
  tinted = false,
}: {
  readonly provider: UsageProviderKind;
  readonly className?: string;
  readonly tinted?: boolean;
}) {
  const Mark = PROVIDER_MARK[provider];
  return (
    <Mark
      aria-hidden
      className={cn("shrink-0", tinted && "fill-current dark:fill-current", className)}
      style={tinted ? { color: PROVIDER_COLOR[provider] } : undefined}
    />
  );
}

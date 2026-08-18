import { useAtomValue } from "@effect/atom-react";
import type { ProviderRateLimits, RateLimitWindow } from "@t3tools/contracts";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import {
  PROVIDER_SHORT_LABEL,
  RATE_LIMIT_WINDOW_SCOPE,
  RATE_LIMIT_WINDOW_SHORT_LABEL,
} from "@t3tools/shared/providerVocabulary";

import { cn } from "../../lib/utils";
import { useProviderRateLimits } from "../../state/rateLimits";
import { primaryServerProvidersAtom } from "../../state/server";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  buildUsageRows,
  formatResetCountdown,
  type UsageMeterRow,
} from "./sidebarUsageMeter.logic";

/**
 * How much of each provider's subscription window is gone.
 *
 * Deliberately not the usage page in miniature. That page answers "what did I
 * spend", which is something you go and look up; this answers "can I keep
 * working for the next hour", which belongs in peripheral vision.
 *
 * One line per *window*, not per provider: how many windows a provider has is
 * a property of the plan, not of the provider, so the row count comes from the
 * data. A provider's name is printed once and its remaining windows indent
 * under it.
 *
 * The bar is each row's own underline rather than a floating segment in a
 * column of its own. Every other list in this shell is full-bleed rows divided
 * by hairlines, so the meter borrows that rule and fills the part of it that
 * has been consumed -- the measurement and the structure are the same line.
 */
/** Past this, the row stops being informational and starts being a warning. */
const CRITICAL_PERCENT = 90;

/** Providers are branded slugs; anything else has no business in a var() name. */
const PROVIDER_SLUG = /^[a-z0-9-]+$/;

/**
 * The provider's own ink, or the app's accent for one that has not been given
 * any. Written as a var() fallback rather than a lookup table on purpose: the
 * three tokens that exist live in tokens.css, and a fourth added there reaches
 * this meter without a second edit here to keep in sync.
 *
 * Colour is what makes the block scannable. Every row drawing the same accent
 * says only "some quota"; a row in Claude's orange says which one before the
 * name beside it has been read.
 */
function providerInk(provider: string): string {
  return PROVIDER_SLUG.test(provider)
    ? `var(--provider-${provider}, var(--primary))`
    : "var(--primary)";
}

function formatResetsAt(resetsAt: string | null): string | null {
  if (resetsAt === null) return null;
  const parsed = new Date(resetsAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const isToday = parsed.toDateString() === new Date().toDateString();
  return isToday
    ? parsed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : parsed.toLocaleDateString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
}

function tooltipFor(entry: ProviderRateLimits, window: RateLimitWindow | null): string {
  const plan = entry.planLabel === null ? "" : ` · ${entry.planLabel}`;
  if (window === null) return `${entry.message ?? "No usage reported"}${plan}`;
  const reset = formatResetsAt(window.resetsAt);
  const suffix = reset === null ? "" : ` · resets ${reset}`;
  return `${Math.round(window.usedPercent)}% of the ${RATE_LIMIT_WINDOW_SCOPE[window.kind]} used${suffix}${plan}`;
}

function UsageRow({ row, nowMs }: { row: UsageMeterRow; nowMs: number }) {
  const { entry, window } = row;
  const percent = window === null ? null : Math.round(window.usedPercent);
  const isCritical = percent !== null && percent >= CRITICAL_PERCENT;
  const countdown = window === null ? null : formatResetCountdown(window.resetsAt, nowMs);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn("cursor-default", row.isFirstOfProvider ? "pt-2" : "pt-1")}
            data-provider={entry.provider}
            data-window={window?.kind ?? "none"}
          >
            <div className="flex items-baseline gap-2 text-2xs">
              {/* The name column keeps its width on continuation rows so the
                  window tags below it stay in one column rather than sliding
                  left under the name. */}
              <span
                className={cn(
                  "w-14 shrink-0 truncate",
                  row.isFirstOfProvider ? "text-foreground/75" : "text-transparent",
                )}
              >
                {PROVIDER_SHORT_LABEL[entry.provider]}
              </span>
              {/* Window tag and its countdown share one column: the tag names
                  the bucket, the countdown says when it refills.

                  The countdown drops out of `label-meta` deliberately. Mono
                  caps at this tracking is wide enough that "WEEK · RESETS IN
                  3D" overruns the 136px this column gets at the 16rem sidebar
                  width, and setting the countdown in small sans separates the
                  reading — the tag is a label, the countdown is a value — for
                  the same reason the tag is mono in the first place.

                  Spelled "resets in" rather than a bare duration: a lone "2h"
                  next to a percentage reads as quota remaining. */}
              <span className="min-w-0 flex-1 truncate">
                <span className="label-meta text-muted-foreground/55">
                  {window === null ? "—" : RATE_LIMIT_WINDOW_SHORT_LABEL[window.kind]}
                </span>
                {countdown === null ? null : (
                  <span className="text-3xs text-muted-foreground/45 tabular-nums">
                    {" · "}
                    {countdown === "now" ? "resetting" : `resets in ${countdown}`}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "w-8 shrink-0 text-right font-mono tabular-nums",
                  percent === null
                    ? "text-muted-foreground/45"
                    : isCritical
                      ? "text-destructive"
                      : "text-foreground/70",
                )}
              >
                {percent === null ? "—" : `${percent}%`}
              </span>
            </div>

            {/* Drawn even at zero and even with nothing to report, so the block
                reads as a set of rules rather than as ragged fragments. */}
            <span className="mt-1 block h-px w-full bg-sidebar-border" role="presentation">
              {percent === null ? null : (
                <span
                  className="block h-px origin-left bg-(--usage-ink) transition-[scale] duration-(--duration-slow) ease-out"
                  style={
                    {
                      scale: `${percent / 100} 1`,
                      "--usage-ink": isCritical
                        ? "var(--destructive)"
                        : providerInk(entry.provider),
                    } as CSSProperties
                  }
                />
              )}
            </span>
          </div>
        }
      />
      <TooltipPopup side="top">{tooltipFor(entry, window)}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Snapshots arrive on provider turns and periodic reads, not on a clock, so a
 * countdown drawn straight from one would sit still and go wrong. One timer
 * for the whole section keeps every row on the same minute.
 */
function useCurrentMinute(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return nowMs;
}

export function SidebarUsageMeter() {
  const { providers, error } = useProviderRateLimits();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const nowMs = useCurrentMinute();

  const rows = useMemo(() => {
    // Plain strings: ProviderDriverKind is an open branded slug, so a Set of
    // the brand would not catch a wrong slug here either, and comparing as
    // strings keeps the join readable.
    const enabledDrivers = new Set<string>(
      serverProviders.filter((provider) => provider.enabled).map((provider) => provider.driver),
    );
    return buildUsageRows(providers, enabledDrivers);
  }, [providers, serverProviders]);

  // Nothing has arrived yet. A heading over an empty frame would be chrome
  // advertising data it does not have, so the block stays out of the layout
  // entirely until there is something to say.
  if (error !== null || rows.length === 0) return null;

  return (
    <section
      aria-label="Provider usage"
      className="border-t border-sidebar-border px-[var(--sidebar-content-inset)] pt-2.5 pb-2"
    >
      <h2 className="label-meta text-muted-foreground/50">Usage</h2>
      {rows.map((row) => (
        <UsageRow key={`${row.provider}:${row.window?.kind ?? "none"}`} row={row} nowMs={nowMs} />
      ))}
    </section>
  );
}

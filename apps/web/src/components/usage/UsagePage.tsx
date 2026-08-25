import type { UsageProviderKind } from "@t3tools/contracts";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, CheckIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DailyTotals, HourlyTotals, ProviderTotals } from "@t3tools/shared/usageMerge";

import { cn } from "../../lib/utils";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspaceTopbar } from "../shell/WorkspaceTopbar";
import { ProviderMark } from "./ProviderMark";
import { UsageChartLegend, UsageProviderChart, type UsageChartMetric } from "./UsageProviderChart";
import {
  PROVIDER_COLOR,
  PROVIDER_LABEL,
  PROVIDER_ORDER,
  providersWithUsage,
} from "./usageProviders";

const WINDOW_OPTIONS = [
  { days: 1, label: "24h" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

/**
 * Leaving is the same action here as it is in Settings, so it is named and
 * shorthanded the same way: one destination, one word for it, and the Escape
 * key advertised rather than left to be discovered. Escape has always worked on
 * both screens; only Settings said so.
 */
function UsagePageHeader({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Button type="button" size="xs" variant="ghost" onClick={onBack} className="shrink-0 gap-1.5">
        <ArrowLeftIcon className="size-3.5" />
        Back to workspace
        <Kbd className="h-4 min-w-0 rounded-sm px-1.5 text-2xs">Esc</Kbd>
      </Button>
      <WorkspaceBreadcrumb ariaLabel="Usage breadcrumb" className="min-w-0">
        <WorkspaceBreadcrumbItem current>Stats</WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
    </div>
  );
}

/**
 * The page's one control shape.
 *
 * Every toggle here answers "which slice of the same data" rather than "do
 * something", so they all read as one segmented rail instead of three
 * differently sized button groups.
 */
function Segmented<Value extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex shrink-0 rounded-md border border-border bg-card p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "cursor-pointer rounded-sm px-2.5 py-1 text-xs whitespace-nowrap outline-none transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card",
            option.value === value
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Every provider, in the palette's slot order.
 *
 * A provider absent from the window is filled in at zero rather than dropped:
 * the panel is also the page's legend, and a key that gains and loses rows as
 * the range changes stops being one.
 *
 * It is not ranked by the metric, for the same reason. This list sits beside
 * the chart's own legend, and the two carried different orders -- the legend
 * fixed, this one by spend -- so three identical color chips appeared twice in
 * one view in two sequences, and the reader had to re-map hue to provider
 * crossing the panel divider. That is the exact cost `PROVIDER_ORDER` exists to
 * remove. Rank is still legible without reordering: every row prints its own
 * share of the total.
 */
function providerRows(providers: readonly ProviderTotals[]): readonly ProviderTotals[] {
  const byProvider = new Map(providers.map((entry) => [entry.provider, entry]));
  return PROVIDER_ORDER.map(
    (provider) =>
      byProvider.get(provider) ?? {
        provider,
        costUsd: 0,
        totalTokens: 0,
        records: 0,
        costShare: 0,
        tokenShare: 0,
      },
  );
}

export function UsagePage() {
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: 30,
    window: makeWindow(30),
  }));
  const [metric, setMetric] = useState<UsageChartMetric>("cost");
  const [breakdown, setBreakdown] = useState<"model" | "time">("model");
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();

  const navigateBackWithinApp = useCallback(() => {
    if (canGoBack) {
      globalThis.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;

      event.preventDefault();
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      navigateBackWithinApp();
    };

    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [navigateBackWithinApp]);

  // Hold the content until every environment is terminal. Rendering merged
  // totals while devices are still answering makes every number on the page
  // jump as each one lands.
  const settling = isPending || isPartial;

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );
  const hours = useMemo(
    () =>
      window.sinceTime === undefined || window.untilTime === undefined
        ? []
        : enumerateHourStarts(window.sinceTime, window.untilTime),
    [window.sinceTime, window.untilTime],
  );
  // Newest first: the window can run 90 periods, so the interesting end
  // belongs at the top of the table.
  const breakdownPeriods = useMemo<readonly (DailyTotals | HourlyTotals)[]>(
    () => (isPast24Hours ? merged.hourly : merged.daily).toReversed(),
    [isPast24Hours, merged.daily, merged.hourly],
  );

  const orderedProviders = useMemo(() => providerRows(merged.providers), [merged.providers]);
  // The table answers whichever question the metric toggle is asking, so its
  // order follows the toggle too: a cheap model that burned the most tokens
  // belongs at the top of a token breakdown.
  const breakdownModels = useMemo(
    () =>
      breakdown === "model" && metric === "tokens"
        ? merged.models.toSorted(
            (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
          )
        : merged.models,
    [breakdown, merged.models, metric],
  );
  const activeProviders = useMemo(() => providersWithUsage(merged.providers), [merged.providers]);

  const activePeriods = (isPast24Hours ? merged.hourly : merged.daily).filter(
    (period) => period.totalTokens > 0,
  ).length;
  const periodAverage = activePeriods === 0 ? 0 : merged.totalTokens / activePeriods;
  const observedInput = merged.uncachedInputTokens + merged.cachedInputTokens;
  const cachedShare = observedInput === 0 ? 0 : merged.cachedInputTokens / observedInput;
  const selectWindow = (days: number) => {
    setWindowSelection({
      days,
      window: makeWindow(days, undefined, days === 1 ? "hour" : "day"),
    });
  };
  const refreshWindow = () => {
    const nextWindow = makeWindow(windowDays, undefined, isPast24Hours ? "hour" : "day");
    if (
      nextWindow.sinceDay === window.sinceDay &&
      nextWindow.untilDay === window.untilDay &&
      nextWindow.sinceTime === window.sinceTime &&
      nextWindow.untilTime === window.untilTime
    ) {
      refresh();
    } else {
      setWindowSelection({ days: windowDays, window: nextWindow });
    }
  };

  const windowLabel =
    isPast24Hours && window.sinceTime !== undefined && window.untilTime !== undefined
      ? `${formatDateTimeShort(window.sinceTime, window.timeZone)} to ${formatDateTimeShort(window.untilTime, window.timeZone)}`
      : `${formatDayShort(window.sinceDay)} to ${formatDayShort(window.untilDay)}`;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspaceTopbar>
          <UsagePageHeader onBack={navigateBackWithinApp} />
        </WorkspaceTopbar>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6">
            {/* The page opens on the number, not on its own name -- the cost is
                the thing you came for. The heading is still here for anyone
                navigating by headings, who would otherwise land in a document
                that starts at h2. */}
            <h1 className="sr-only">Stats</h1>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="label-meta text-muted-foreground/70">Reporting period</span>
                <p className="truncate text-sm text-foreground">{windowLabel}</p>
              </div>
              <div className="flex items-center gap-2">
                <Segmented
                  ariaLabel="Reporting period"
                  value={String(windowDays)}
                  onChange={(value) => selectWindow(Number(value))}
                  options={WINDOW_OPTIONS.map((option) => ({
                    value: String(option.days),
                    label: option.label,
                  }))}
                />
                <button
                  type="button"
                  onClick={refreshWindow}
                  aria-label="Refresh usage"
                  className="cursor-pointer rounded-md border border-border bg-card p-2 text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground"
                >
                  <RefreshCwIcon className="size-3.5" />
                </button>
              </div>
            </div>

            {settling ? (
              <>
                {environments.length > 1 ? <UsageDeviceStrip environments={environments} /> : null}
                <UsageSkeleton resolution={isPast24Hours ? "hour" : "day"} />
              </>
            ) : (
              <>
                <UsageCoverageNotice
                  environments={environments}
                  duplicateSources={merged.duplicateSources}
                  staleEnvironments={merged.staleEnvironments}
                />

                {/* The headline answers "what did this cost", full width and on
                    its own, with the unit toggle beside it because the toggle
                    is what decides which question it is answering. */}
                <section className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-border bg-card px-5 py-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="label-meta text-muted-foreground">
                      {metric === "cost" ? "Raw token cost" : "Processed tokens"}
                    </span>
                    {/* Proportional figures, not tabular: at display size a
                        fixed-width digit leaves visible gutters inside the
                        number. Columns elsewhere on the page stay tabular. */}
                    <span className="text-4xl font-semibold tracking-tight text-foreground">
                      {metric === "cost"
                        ? formatUsd(merged.costUsd)
                        : formatTokens(merged.totalTokens)}
                      {metric === "cost" ? (
                        <span className="text-muted-foreground/60">*</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {metric === "cost"
                        ? `* if billed at full API rate · ${formatTokens(merged.totalTokens)} tokens across ${formatCount(merged.sessions)} sessions`
                        : `Input, cache reads and output across ${formatCount(merged.sessions)} sessions`}
                    </span>
                  </div>
                  <Segmented
                    ariaLabel="Metric"
                    value={metric}
                    onChange={setMetric}
                    options={[
                      { value: "cost", label: "Cost" },
                      { value: "tokens", label: "Tokens" },
                    ]}
                  />
                </section>

                {merged.records === 0 ? (
                  <UsageEmptyState />
                ) : (
                  <>
                    <section className="grid overflow-hidden rounded-md border border-border bg-card lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
                      <div className="flex flex-col gap-4 border-b border-border p-5 lg:border-r lg:border-b-0">
                        <h2 className="label-meta text-muted-foreground">Split by provider</h2>
                        <ProviderShareBar providers={orderedProviders} metric={metric} />
                        <div className="flex flex-col">
                          {orderedProviders.map((provider) => (
                            <ProviderRow
                              key={provider.provider}
                              provider={provider}
                              metric={metric}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-col gap-4 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h2 className="label-meta text-muted-foreground">
                            {isPast24Hours ? "Hourly" : "Daily"}{" "}
                            {metric === "tokens" ? "processed tokens" : "cost"}
                          </h2>
                          <UsageChartLegend />
                        </div>
                        <UsageProviderChart
                          days={days}
                          daily={merged.daily}
                          hours={hours}
                          hourly={merged.hourly}
                          metric={metric}
                          referenceTime={window.untilTime}
                          resolution={isPast24Hours ? "hour" : "day"}
                          timeZone={window.timeZone}
                        />
                      </div>
                    </section>

                    <section
                      aria-label="Token mix"
                      className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-5"
                    >
                      <Metric
                        label="Processed tokens"
                        value={formatTokens(merged.totalTokens)}
                        detail={`${formatTokens(periodAverage)} per active ${isPast24Hours ? "hour" : "day"}`}
                      />
                      <Metric
                        label="Cached input"
                        value={formatTokens(merged.cachedInputTokens)}
                        detail={`${formatPercent(cachedShare)} of observed input`}
                        meter={cachedShare}
                      />
                      <Metric
                        label="Uncached input"
                        value={formatTokens(merged.uncachedInputTokens)}
                        detail={`${formatTokens(merged.cacheCreationTokens)} cache writes`}
                      />
                      <Metric
                        label="Output"
                        value={formatTokens(merged.outputTokens)}
                        detail={`includes ${formatTokens(merged.reasoningTokens)} reasoning`}
                      />
                      <Metric
                        label="Cache savings"
                        value={formatUsd(merged.costQuality.cacheSavingsUsd)}
                        detail={
                          merged.costUsd > 0
                            ? `${(merged.costQuality.cacheSavingsUsd / merged.costUsd).toFixed(1)}x the raw token cost`
                            : "vs full input rates"
                        }
                      />
                    </section>

                    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-5">
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="label-meta text-muted-foreground">Breakdown</h2>
                        <Segmented
                          ariaLabel="Breakdown"
                          value={breakdown}
                          onChange={setBreakdown}
                          options={[
                            { value: "model", label: "By model" },
                            { value: "time", label: isPast24Hours ? "By hour" : "By day" },
                          ]}
                        />
                      </div>

                      {breakdown === "model" ? (
                        <ModelBreakdown models={breakdownModels} />
                      ) : (
                        <TimeBreakdown
                          periods={breakdownPeriods}
                          providers={activeProviders}
                          isPast24Hours={isPast24Hours}
                          timeZone={window.timeZone}
                        />
                      )}
                    </section>

                    <UsagePricingNote
                      unpricedShare={merged.costQuality.unpricedShare}
                      environments={environments}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

/**
 * The headline number's composition, as one rule.
 *
 * Segments are separated by a gap in the surface rather than by a stroke, so
 * neighbouring hues stay distinct without adding ink that is not data.
 */
function ProviderShareBar({
  providers,
  metric,
}: {
  readonly providers: readonly ProviderTotals[];
  readonly metric: UsageChartMetric;
}) {
  const segments = providers.filter(
    (provider) => (metric === "cost" ? provider.costShare : provider.tokenShare) > 0,
  );

  if (segments.length === 0) {
    return <span className="block h-1.5 w-full rounded-full bg-muted" role="presentation" />;
  }

  return (
    <span className="flex h-1.5 w-full gap-0.5" role="presentation">
      {segments.map((provider) => (
        <span
          key={provider.provider}
          className="h-full rounded-full"
          style={{
            flexBasis: `${((metric === "cost" ? provider.costShare : provider.tokenShare) * 100).toFixed(2)}%`,
            backgroundColor: PROVIDER_COLOR[provider.provider],
          }}
        />
      ))}
    </span>
  );
}

function ProviderRow({
  provider,
  metric,
}: {
  readonly provider: ProviderTotals;
  readonly metric: UsageChartMetric;
}) {
  const share = metric === "cost" ? provider.costShare : provider.tokenShare;
  const isIdle = provider.records === 0;

  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 border-t border-border/60 py-2.5 first:border-t-0 first:pt-0 last:pb-0",
        isIdle && "opacity-50",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-sm text-foreground">
          <ProviderMark provider={provider.provider} className="size-4" tinted />
          {PROVIDER_LABEL[provider.provider]}
        </span>
        <span className="text-sm text-foreground tabular-nums">
          {metric === "cost" ? formatUsd(provider.costUsd) : formatTokens(provider.totalTokens)}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {isIdle
          ? "No activity in this window"
          : metric === "cost"
            ? `${formatPercent(share)} of cost · ${formatTokens(provider.totalTokens)} tokens`
            : `${formatPercent(share)} of tokens · ${formatUsd(provider.costUsd)}`}
      </span>
    </div>
  );
}

function ModelBreakdown({
  models,
}: {
  readonly models: readonly {
    readonly model: string;
    readonly provider: UsageProviderKind;
    readonly costUsd: number;
    readonly totalTokens: number;
    readonly costShare: number;
  }[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left label-meta text-muted-foreground/70">
          <th className="py-2 font-medium">Model</th>
          <th className="py-2 text-right font-medium">Cost</th>
          <th className="w-40 py-2 text-right font-medium">Share</th>
          <th className="py-2 text-right font-medium">Tokens</th>
        </tr>
      </thead>
      <tbody>
        {models.length === 0 ? (
          <tr>
            <td colSpan={4} className="py-6 text-center text-muted-foreground">
              No activity in this window.
            </td>
          </tr>
        ) : (
          models.map((model) => (
            <tr
              key={`${model.provider}:${model.model}`}
              className="border-b border-border/50 last:border-b-0"
            >
              <td className="py-2 text-foreground">
                <span className="flex items-center gap-2">
                  <ProviderMark provider={model.provider} className="size-3.5" tinted />
                  <span className="truncate">{model.model}</span>
                </span>
              </td>
              <td className="py-2 text-right text-foreground tabular-nums">
                {formatUsd(model.costUsd)}
              </td>
              <td className="py-2">
                <span className="flex items-center justify-end gap-2">
                  <span className="h-1 w-20 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(model.costShare * 100).toFixed(1)}%`,
                        backgroundColor: PROVIDER_COLOR[model.provider],
                      }}
                    />
                  </span>
                  <span className="w-12 text-right text-muted-foreground tabular-nums">
                    {formatPercent(model.costShare)}
                  </span>
                </span>
              </td>
              <td className="py-2 text-right text-muted-foreground tabular-nums">
                {formatTokens(model.totalTokens)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function TimeBreakdown({
  periods,
  providers,
  isPast24Hours,
  timeZone,
}: {
  readonly periods: readonly (DailyTotals | HourlyTotals)[];
  /** Only providers that billed something in the window; see `providersWithUsage`. */
  readonly providers: readonly UsageProviderKind[];
  readonly isPast24Hours: boolean;
  readonly timeZone: string;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left label-meta text-muted-foreground/70">
          <th className="py-2 font-medium">{isPast24Hours ? "Hour" : "Day"}</th>
          {providers.map((provider) => (
            <th key={provider} className="py-2 text-right font-medium">
              {PROVIDER_LABEL[provider]}
            </th>
          ))}
          <th className="py-2 text-right font-medium">Total</th>
          <th className="py-2 text-right font-medium">Tokens</th>
        </tr>
      </thead>
      <tbody>
        {periods.length === 0 ? (
          <tr>
            <td colSpan={providers.length + 3} className="py-6 text-center text-muted-foreground">
              No activity in this window.
            </td>
          </tr>
        ) : (
          periods.map((period) => (
            <tr
              key={"hourStart" in period ? period.hourStart : period.day}
              className="border-b border-border/50 last:border-b-0"
            >
              <td className="py-2 text-foreground">
                {"hourStart" in period
                  ? formatHourShort(period.hourStart, timeZone)
                  : formatDayShort(period.day)}
              </td>
              {providers.map((provider) => (
                <td key={provider} className="py-2 text-right text-muted-foreground tabular-nums">
                  {formatUsd(period.byProvider.get(provider)?.costUsd ?? 0)}
                </td>
              ))}
              <td className="py-2 text-right text-foreground tabular-nums">
                {formatUsd(period.costUsd)}
              </td>
              <td className="py-2 text-right text-muted-foreground tabular-nums">
                {formatTokens(period.totalTokens)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

/**
 * Says where the money figure came from.
 *
 * The headline is an API-equivalent price, not a bill, and some models have no
 * published rate at all. Both facts belong on the page rather than in a doc.
 */
function UsagePricingNote({
  unpricedShare,
  environments,
}: {
  readonly unpricedShare: number;
  readonly environments: readonly EnvironmentUsageStatus[];
}) {
  const pricing = environments.find((environment) => environment.summary !== null)?.summary
    ?.pricing;
  if (pricing === undefined) return null;

  return (
    <p className="text-xs text-muted-foreground/70">
      Cost is priced from the LiteLLM rate table
      {pricing.status === "unavailable"
        ? ", which could not be loaded — provider-reported costs only"
        : `, covering ${formatCount(pricing.knownModels)} models`}
      . Subscription plans bill separately.
      {unpricedShare > 0
        ? ` ${formatPercent(unpricedShare)} of records ran on a model with no published rate; their tokens are counted, their cost is not.`
        : ""}
    </p>
  );
}

function UsageEmptyState() {
  return (
    <section className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border px-6 py-16 text-center">
      <p className="text-sm text-foreground">Nothing ran in this window.</p>
      <p className="text-xs text-muted-foreground">
        Usage is read from each provider CLI's own session transcripts, so turns driven outside
        Ronin count too.
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  meter,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  /** Optional 0-1 fraction, drawn as the tile's own underline. */
  readonly meter?: number;
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-card px-4 py-3">
      <span className="label-meta text-muted-foreground/70">{label}</span>
      <span className="text-lg text-foreground tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
      {meter === undefined ? null : (
        <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${(Math.min(1, Math.max(0, meter)) * 100).toFixed(1)}%` }}
          />
        </span>
      )}
    </div>
  );
}

/**
 * Says plainly when the totals are incomplete: an environment that failed, or
 * one whose transcripts another environment already reported. Environments
 * that are still answering never reach this notice; the page shows the
 * loading skeleton until every one is terminal.
 */
function UsageCoverageNotice({
  environments,
  duplicateSources,
  staleEnvironments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
}) {
  const failed = environments.filter((environment) => environment.error !== null);
  const stale = environments.filter((environment) =>
    staleEnvironments.includes(environment.environmentId),
  );
  if (failed.length === 0 && stale.length === 0 && duplicateSources.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
      {failed.map((environment) => (
        <span key={environment.label}>{environment.label} could not report usage.</span>
      ))}
      {stale.map((environment) => (
        <span key={environment.label}>
          {environment.label} runs an older server version and is excluded from totals.
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          Counted once across environments sharing a transcript directory:{" "}
          {duplicateSources.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Per-device progress while the page waits for every environment to answer.
 * Only rendered with two or more devices; a lone device has nothing to
 * enumerate.
 */
function UsageDeviceStrip({
  environments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
}) {
  const scanning = environments.filter(
    (environment) => environment.summary === null && environment.error === null,
  );
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-border bg-card px-4 py-3 text-xs">
      {environments.map((environment) => {
        if (environment.summary !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-foreground"
            >
              <CheckIcon className="size-3 text-success-foreground" aria-hidden />
              {environment.label}
            </span>
          );
        }
        if (environment.error !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-destructive"
            >
              <XIcon className="size-3" aria-hidden />
              {environment.label}
            </span>
          );
        }
        return (
          <span
            key={environment.environmentId}
            className="animate-status-pulse text-muted-foreground"
          >
            {environment.label}…
          </span>
        );
      })}
      <span className="ms-auto text-muted-foreground">
        {scanning.length === 1
          ? "1 device still scanning"
          : `${scanning.length} devices still scanning`}
      </span>
    </div>
  );
}

/** Deterministic bar heights (each unique: they double as keys). */
const SKELETON_BAR_HEIGHTS = [34, 58, 41, 72, 22, 12, 49, 63, 80, 38, 55, 26, 44, 67];

/**
 * Static stand-in with the loaded page's shape: headline, provider split,
 * chart and metrics strip. No shimmer; blocks fill in exactly once when the
 * last device answers.
 */
function UsageSkeleton({ resolution }: { readonly resolution: "day" | "hour" }) {
  return (
    <>
      <section className="flex flex-col gap-1 rounded-md border border-border bg-card px-5 py-4">
        <span className="label-meta text-muted-foreground">Raw token cost</span>
        <div className="my-1.5 h-9 w-40 rounded-sm bg-muted" />
        <div className="h-3 w-56 rounded-sm bg-muted" />
      </section>

      <section className="grid overflow-hidden rounded-md border border-border bg-card lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 border-b border-border p-5 lg:border-r lg:border-b-0">
          <h2 className="label-meta text-muted-foreground">Split by provider</h2>
          <span className="block h-1.5 w-full rounded-full bg-muted" />
          <div className="flex flex-col">
            {PROVIDER_ORDER.map((provider) => (
              <div
                key={provider}
                className="flex flex-col gap-1.5 border-t border-border/60 py-2.5 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <ProviderMark provider={provider} className="size-4" tinted />
                    {PROVIDER_LABEL[provider]}
                  </span>
                  <div className="h-3.5 w-14 rounded-sm bg-muted" />
                </div>
                <div className="h-3 w-36 rounded-sm bg-muted" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <h2 className="label-meta text-muted-foreground">
            {resolution === "hour" ? "Hourly" : "Daily"} cost
          </h2>
          {/* Mirrors the chart's h-64 body and its axis gutter so nothing
              reflows when the real chart swaps in. */}
          <div className="flex h-64 items-end gap-1 pl-15">
            {SKELETON_BAR_HEIGHTS.map((height) => (
              <div
                key={height}
                className="flex-1 rounded-sm bg-muted"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-5">
        {["Processed tokens", "Cached input", "Uncached input", "Output", "Cache savings"].map(
          (label) => (
            <div key={label} className="flex flex-col gap-0.5 bg-card px-4 py-3">
              <span className="label-meta text-muted-foreground/70">{label}</span>
              <div className="my-1 h-5 w-16 rounded-sm bg-muted" />
              <div className="h-3 w-24 rounded-sm bg-muted" />
            </div>
          ),
        )}
      </section>

      {/* The breakdown is the tallest block on the page. Leaving it out of the
          skeleton made the whole view jump once usage arrived. */}
      <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="label-meta text-muted-foreground">Breakdown</h2>
          <div className="h-7 w-40 rounded-md bg-muted" />
        </div>
        <div className="h-44 rounded-sm bg-muted/35" />
      </section>
    </>
  );
}

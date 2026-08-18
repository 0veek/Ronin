import type { UsageProviderKind } from "@t3tools/contracts";
import { useCallback, useId, useMemo, useRef, useState } from "react";

import type { DailyTotals, HourlyTotals } from "@t3tools/shared/usageMerge";
import {
  formatDayShort,
  formatHourShort,
  formatRelativeHourShort,
  formatTokens,
  formatUsd,
} from "@t3tools/shared/usageFormat";
import { cn } from "../../lib/utils";
import { ProviderMark } from "./ProviderMark";
import { PROVIDER_COLOR, PROVIDER_LABEL, PROVIDER_ORDER } from "./usageProviders";

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 280;
const TICK_COUNT = 4;
const PLOT_TOP = 10;

export type UsageChartMetric = "tokens" | "cost";

interface UsageProviderChartProps {
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly hours: readonly string[];
  readonly hourly: readonly HourlyTotals[];
  readonly metric: UsageChartMetric;
  readonly referenceTime: string | undefined;
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
}

/** One period's per-provider values, shared by the paths and the hover readout. */
export interface DayColumn {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number;
  }[];
  readonly total: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function valueFor(
  totals: DailyTotals | HourlyTotals | undefined,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number {
  const entry = totals?.byProvider.get(provider);
  if (entry === undefined) return 0;
  return metric === "tokens" ? entry.totalTokens : entry.costUsd;
}

function buildPeriodColumns(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return periods.map((period) => {
    const entry = byPeriod.get(period);
    const bands = PROVIDER_ORDER.map((provider) => ({
      provider,
      value: valueFor(entry, provider, metric),
    }));
    return { bands, total: bands.reduce((sum, band) => sum + band.value, 0) };
  });
}

/**
 * Monotone cubic tangents (Fritsch-Carlson).
 *
 * Plain cubic smoothing overshoots on spiky daily data and would dip the area
 * below zero between points, which reads as negative spend. This variant is
 * shape-preserving, so a smoothed series never leaves the range of its samples.
 */
function monotoneTangents(points: readonly Point[]): readonly number[] {
  const count = points.length;
  if (count < 2) return [0];

  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const dx = (points[index + 1]?.x ?? 0) - (points[index]?.x ?? 0);
    const dy = (points[index + 1]?.y ?? 0) - (points[index]?.y ?? 0);
    slopes.push(dx === 0 ? 0 : dy / dx);
  }

  const tangents: number[] = Array.from({ length: count }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[count - 1] = slopes[count - 2] ?? 0;
  for (let index = 1; index < count - 1; index += 1) {
    const previous = slopes[index - 1] ?? 0;
    const next = slopes[index] ?? 0;
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }

  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = (tangents[index] ?? 0) / slope;
    const b = (tangents[index + 1] ?? 0) / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }

  return tangents;
}

/** One cubic segment of a smoothed boundary. */
interface CurveSegment {
  readonly from: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
}

/** Smoothed polyline through `points`, as explicit cubic control points. */
function smoothCurve(points: readonly Point[]): readonly CurveSegment[] {
  if (points.length < 2) return [];
  const tangents = monotoneTangents(points);
  const segments: CurveSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    segments.push({
      from,
      c1: { x: from.x + dx / 3, y: from.y + ((tangents[index] ?? 0) * dx) / 3 },
      c2: { x: to.x - dx / 3, y: to.y - ((tangents[index + 1] ?? 0) * dx) / 3 },
      to,
    });
  }
  return segments;
}

function curvePath(segments: readonly CurveSegment[], startCommand: "M" | "L"): string {
  const first = segments[0];
  if (first === undefined) return "";
  let path = `${startCommand}${first.from.x.toFixed(2)},${first.from.y.toFixed(2)}`;
  for (const segment of segments) {
    path += ` C${segment.c1.x.toFixed(2)},${segment.c1.y.toFixed(2)} ${segment.c2.x.toFixed(2)},${segment.c2.y.toFixed(2)} ${segment.to.x.toFixed(2)},${segment.to.y.toFixed(2)}`;
  }
  return path;
}

/**
 * Builds a scale whose maximum is a readable 1/2/5 x 10^n step at or above the
 * peak.
 *
 * Rounding the maximum *up* is the point: stopping at the last step below the
 * peak leaves the tallest day drawn past the top of the plot, where it is
 * clipped.
 */
export function niceScale(peak: number, count: number): { max: number; ticks: readonly number[] } {
  if (peak <= 0) return { max: 0, ticks: [0] };

  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { max, ticks };
}

/**
 * Turns the merged daily totals into one column per day.
 *
 * Values are absolute, not cumulative: the series are layered from a shared
 * zero baseline rather than stacked. A stacked chart puts whichever provider is
 * drawn last permanently above the others, which reads as "that one is bigger"
 * even on days where it is not.
 *
 * The chart paths and the hover readout both consume this, so the number under
 * the cursor is by construction the number that was plotted rather than a
 * second derivation that can drift from it.
 */
export function buildDayColumns(
  days: readonly string[],
  byDay: ReadonlyMap<string, DailyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return buildPeriodColumns(days, byDay, metric);
}

export function UsageProviderChart({
  days,
  daily,
  hours,
  hourly,
  metric,
  referenceTime,
  resolution,
  timeZone,
}: UsageProviderChartProps) {
  const gradientPrefix = useId();
  const periods = resolution === "hour" ? hours : days;
  const byPeriod = useMemo(
    () =>
      resolution === "hour"
        ? new Map(hourly.map((entry) => [entry.hourStart, entry]))
        : new Map(daily.map((entry) => [entry.day, entry])),
    [daily, hourly, resolution],
  );
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);

  const { paths, ticks, toY, series, hasData } = useMemo(() => {
    if (periods.length === 0) {
      return {
        paths: [],
        ticks: [0] as readonly number[],
        toY: () => VIEW_HEIGHT,
        series: [] as readonly DayColumn[],
        hasData: false,
      };
    }

    const columns = buildPeriodColumns(periods, byPeriod, metric);

    // The scale tops out at the largest single provider-period, not the largest
    // sum: layered series each measure from zero, so a combined peak would
    // leave the plot permanently half empty.
    const peak = columns.reduce(
      (max, column) => column.bands.reduce((inner, band) => Math.max(inner, band.value), max),
      0,
    );
    const { max, ticks: tickValues } = niceScale(peak, TICK_COUNT);
    const step = periods.length === 1 ? 0 : VIEW_WIDTH / (periods.length - 1);
    // Reserve a sliver above the top gridline so the series stroke, which is
    // drawn at constant screen width, is not shaved off at a peak.
    const toY = (value: number) =>
      max === 0 ? VIEW_HEIGHT : VIEW_HEIGHT - (value / max) * (VIEW_HEIGHT - PLOT_TOP);

    const built = PROVIDER_ORDER.map((provider, providerIndex) => {
      const curve = smoothCurve(
        columns.map((column, periodIndex) => ({
          x: periodIndex * step,
          y: toY(column.bands[providerIndex]?.value ?? 0),
        })),
      );
      const line = curvePath(curve, "M");
      return {
        provider,
        total: columns.reduce((sum, column) => sum + (column.bands[providerIndex]?.value ?? 0), 0),
        area: line === "" ? "" : `${line} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z`,
        line,
      };
    });

    // Paint the heavier series first so the lighter one is never buried under
    // it. The washes are faint enough that the order barely shows, but the
    // strokes are drawn in a second pass regardless, so neither can be hidden.
    const ordered = [...built].sort((a, b) => b.total - a.total);

    return {
      paths: ordered,
      ticks: tickValues,
      toY,
      series: columns,
      hasData: max > 0,
    };
  }, [byPeriod, metric, periods]);

  const format = metric === "tokens" ? formatTokens : formatUsd;

  const handleMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const bounds = plotRef.current?.getBoundingClientRect();
      if (bounds === undefined || bounds.width === 0 || periods.length === 0) return;
      const fraction = (event.clientX - bounds.left) / bounds.width;
      const index = Math.round(fraction * (periods.length - 1));
      setHoverIndex(Math.min(periods.length - 1, Math.max(0, index)));
    },
    [periods.length],
  );

  const hoveredPeriod = hoverIndex === null ? undefined : periods[hoverIndex];
  const hoveredColumn = hoverIndex === null ? undefined : series[hoverIndex];
  const hoverLeft = periods.length <= 1 ? 0 : ((hoverIndex ?? 0) / (periods.length - 1)) * 100;
  const formatPeriod = (period: string) =>
    resolution === "hour" ? formatHourShort(period, timeZone) : formatDayShort(period);
  const formatTooltipPeriod = (period: string) =>
    resolution === "hour" && referenceTime !== undefined
      ? formatRelativeHourShort(period, referenceTime, timeZone)
      : formatPeriod(period);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-3">
        {/* Axis labels sit outside the plot so they stay aligned to gridlines. */}
        <div className="relative h-64 w-12 shrink-0">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-3xs text-muted-foreground/70 tabular-nums"
              style={{ top: `${(toY(tick) / VIEW_HEIGHT) * 100}%` }}
            >
              {format(tick)}
            </span>
          ))}
        </div>

        <div
          ref={plotRef}
          className="relative h-64 flex-1 touch-none"
          onPointerMove={handleMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <svg
            className="h-full w-full"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${resolution === "hour" ? "Hourly" : "Daily"} ${metric === "tokens" ? "processed tokens" : "cost"} by provider`}
          >
            <defs>
              {/* The wash is a ramp off each series' own colour token, so it
                  follows the theme without a second set of literals. */}
              {PROVIDER_ORDER.map((provider) => (
                <linearGradient
                  key={provider}
                  id={`${gradientPrefix}-${provider}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    style={{
                      stopColor: PROVIDER_COLOR[provider],
                      stopOpacity: "var(--provider-area-opacity)",
                    }}
                  />
                  <stop
                    offset="100%"
                    style={{ stopColor: PROVIDER_COLOR[provider], stopOpacity: 0 }}
                  />
                </linearGradient>
              ))}
            </defs>

            {ticks.map((tick) => {
              const y = toY(tick);
              return (
                <line
                  key={tick}
                  x1={0}
                  x2={VIEW_WIDTH}
                  y1={y}
                  y2={y}
                  strokeWidth={1}
                  className={tick === 0 ? "stroke-border" : "stroke-border/60"}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

            {/* Washes first, then every stroke, so no series covers another's line. */}
            {paths.map(({ provider, area }) => (
              <path key={provider} d={area} fill={`url(#${gradientPrefix}-${provider})`} />
            ))}
            {paths.map(({ provider, line }) => (
              <path
                key={provider}
                d={line}
                fill="none"
                style={{ stroke: PROVIDER_COLOR[provider] }}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {hasData ? null : (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-xs text-muted-foreground">No activity in this window.</span>
            </div>
          )}

          {/* The crosshair and its markers are drawn in HTML rather than in the
              SVG: the viewBox is stretched to the container, so a circle in
              user space would render as an ellipse at every width but one. */}
          {hoveredPeriod === undefined || !hasData ? null : (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 w-px bg-foreground/15"
                style={{ left: `${hoverLeft}%` }}
              />
              {PROVIDER_ORDER.map((provider) => {
                const value =
                  hoveredColumn?.bands.find((band) => band.provider === provider)?.value ?? 0;
                if (value <= 0) return null;
                return (
                  <span
                    key={provider}
                    aria-hidden
                    className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
                    style={{
                      left: `${hoverLeft}%`,
                      top: `${(toY(value) / VIEW_HEIGHT) * 100}%`,
                      backgroundColor: PROVIDER_COLOR[provider],
                    }}
                  />
                );
              })}

              <div
                className={cn(
                  "pointer-events-none absolute top-1 z-10 min-w-44 material-popover rounded-lg border border-border px-2.5 py-2 text-xs shadow-[var(--shadow-popover)]",
                  hoverLeft > 55 ? "-translate-x-[calc(100%+0.5rem)]" : "translate-x-2",
                )}
                style={{ left: `${hoverLeft}%` }}
              >
                <div className="label-meta mb-1.5 text-muted-foreground">
                  {formatTooltipPeriod(hoveredPeriod)}
                </div>
                {PROVIDER_ORDER.map((provider) => {
                  const value =
                    hoveredColumn?.bands.find((band) => band.provider === provider)?.value ?? 0;
                  return (
                    <div
                      key={provider}
                      className={cn(
                        "flex items-center justify-between gap-4 py-px",
                        value <= 0 && "opacity-45",
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <ProviderMark provider={provider} className="size-3" tinted />
                        {PROVIDER_LABEL[provider]}
                      </span>
                      <span className="text-foreground tabular-nums">{format(value)}</span>
                    </div>
                  );
                })}
                <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-border pt-1.5">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-medium text-foreground tabular-nums">
                    {format(hoveredColumn?.total ?? 0)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="label-meta flex justify-between pl-15 text-muted-foreground/60">
        <span>{periods[0] === undefined ? "" : formatPeriod(periods[0])}</span>
        <span>
          {periods[Math.floor(periods.length / 2)] === undefined
            ? ""
            : formatPeriod(periods[Math.floor(periods.length / 2)] ?? "")}
        </span>
        <span>
          {periods[periods.length - 1] === undefined
            ? ""
            : formatPeriod(periods[periods.length - 1] ?? "")}
        </span>
      </div>
    </div>
  );
}

/**
 * Identity key for the plot.
 *
 * Always rendered, never optional: three layered series can only be told apart
 * by colour in the plot itself, so the mapping has to be stated somewhere that
 * does not require hovering.
 */
export function UsageChartLegend() {
  return (
    <div className="flex items-center gap-3.5">
      {PROVIDER_ORDER.map((provider) => (
        <span key={provider} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ProviderMark provider={provider} className="size-3.5" tinted />
          {PROVIDER_LABEL[provider]}
        </span>
      ))}
    </div>
  );
}

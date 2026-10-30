// @effect-diagnostics nodeBuiltinImport:off - only node:perf_hooks exposes the event loop delay histogram.
import * as NodePerfHooks from "node:perf_hooks";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import type * as Scope from "effect/Scope";
import * as Metrics from "./Metrics.ts";

// Node's delay histogram wakes a native timer every RESOLUTION_MS and records the
// gap between wakeups, so an idle loop reads about RESOLUTION_MS and a stall of S
// reads between S and S + RESOLUTION_MS. We subtract the resolution, so a delay can
// undercount a stall by up to RESOLUTION_MS. With these values every stall over 3 s
// is caught, at 1 wakeup per second that never enters JS.
const RESOLUTION_MS = 1000;
const STALL_THRESHOLD_MS = 2000;
const SAMPLE_INTERVAL = "30 seconds";

/** One sample interval as Node reports it. Delay in ns, active time in ms, CPU in µs. */
export interface EventLoopReadings {
  readonly delayMaxNs: number;
  readonly activeMs: number;
  readonly utilization: number;
  readonly usage: Pick<
    NodeJS.ResourceUsage,
    | "userCPUTime"
    | "systemCPUTime"
    | "majorPageFault"
    | "minorPageFault"
    | "involuntaryContextSwitches"
  >;
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly elapsedMs: number;
}

// Enables the delay histogram for the layer's lifetime. Each read returns the
// readings since the previous read and resets the histogram. Node skips the first
// gap after a reset, so a stall right at a sample boundary can be missed.
const makeNodeSampler = Effect.gen(function* () {
  const histogram = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const histogram = NodePerfHooks.monitorEventLoopDelay({ resolution: RESOLUTION_MS });
      histogram.enable();
      return histogram;
    }),
    (histogram) => Effect.sync(() => histogram.disable()),
  );
  let elu = NodePerfHooks.performance.eventLoopUtilization();
  let usage = process.resourceUsage();
  let sampledAt = NodePerfHooks.performance.now();

  // @effect-diagnostics-next-line returnEffectInGen:off - the read effect is the result.
  return Effect.sync(() => {
    const nextElu = NodePerfHooks.performance.eventLoopUtilization();
    const nextUsage = process.resourceUsage();
    const nextSampledAt = NodePerfHooks.performance.now();
    const memory = process.memoryUsage();
    const loop = NodePerfHooks.performance.eventLoopUtilization(nextElu, elu);
    const readings: EventLoopReadings = {
      delayMaxNs: histogram.max,
      activeMs: loop.active,
      utilization: loop.utilization,
      usage: {
        userCPUTime: nextUsage.userCPUTime - usage.userCPUTime,
        systemCPUTime: nextUsage.systemCPUTime - usage.systemCPUTime,
        majorPageFault: nextUsage.majorPageFault - usage.majorPageFault,
        minorPageFault: nextUsage.minorPageFault - usage.minorPageFault,
        involuntaryContextSwitches:
          nextUsage.involuntaryContextSwitches - usage.involuntaryContextSwitches,
      },
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      elapsedMs: nextSampledAt - sampledAt,
    };
    histogram.reset();
    elu = nextElu;
    usage = nextUsage;
    sampledAt = nextSampledAt;
    return readings;
  });
});

/**
 * Returns the stall to report for one sample in ms, or undefined when there was none.
 */
export const stallMs = ({ delayMaxNs, activeMs }: EventLoopReadings) => {
  const delayMs = Math.round(delayMaxNs / 1e6) - RESOLUTION_MS;
  // A stall is time the loop spent running code, so it counts as active time. libuv's
  // clock keeps running while the system sleeps on macOS and Windows, so a sleep also
  // reads as delay, but the loop spent it idle in poll.
  if (delayMs <= STALL_THRESHOLD_MS || activeMs < delayMs) return undefined;
  return delayMs;
};

// Untraced: it runs inside every 30-second tick, which already has the monitor's own span.
const recordGauges = Effect.fnUntraced(function* (readings: EventLoopReadings) {
  const cpuMs = (readings.usage.userCPUTime + readings.usage.systemCPUTime) / 1000;
  yield* Metric.update(Metrics.serverResidentBytes, readings.rssBytes);
  yield* Metric.update(Metrics.serverHeapUsedBytes, readings.heapUsedBytes);
  yield* Metric.update(Metrics.serverEventLoopUtilization, readings.utilization);
  yield* Metric.update(
    Metrics.serverEventLoopDelayMax,
    Math.max(0, Math.round(readings.delayMaxNs / 1e6) - RESOLUTION_MS),
  );
  if (readings.elapsedMs > 0) {
    yield* Metric.update(Metrics.serverCpuUtilization, cpuMs / readings.elapsedMs);
  }
});

/**
 * Samples loop health every 30 seconds and records stalls in local diagnostics.
 * Accepts a sampler so tests can inject readings.
 */
export const layerWith = (
  makeSampler: Effect.Effect<Effect.Effect<EventLoopReadings>, never, Scope.Scope>,
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sample = yield* makeSampler;
      const tick = Effect.gen(function* () {
        const readings = yield* sample;
        yield* recordGauges(readings);
        const delayMaxMs = stallMs(readings);
        if (delayMaxMs === undefined) return;
        const { utilization, usage, rssBytes } = readings;
        // Root, as the stall has no caller to attach to. Warn level keeps it when
        // T3CODE_TRACE_MIN_LEVEL is raised to cut trace noise.
        yield* Effect.logWarning(`event loop stalled for ${delayMaxMs} ms`).pipe(
          Effect.withSpan("server.eventLoop.stall", {
            root: true,
            level: "Warn",
            attributes: {
              delayMaxMs,
              utilization: Math.round(utilization * 100) / 100,
              cpuUserMs: Math.round(usage.userCPUTime / 1000),
              cpuSystemMs: Math.round(usage.systemCPUTime / 1000),
              majorPageFaults: usage.majorPageFault,
              minorPageFaults: usage.minorPageFault,
              involuntaryContextSwitches: usage.involuntaryContextSwitches,
              rssMb: Math.round(rssBytes / 1024 / 1024),
            },
          }),
        );
      });
      const wait = Effect.sleep(SAMPLE_INTERVAL);
      // The layer builds before the rest of the server, so the first sample covers
      // startup work such as migrations and projection bootstrap. That can block the
      // loop for seconds on a large database, so skip it rather than warn at every
      // launch. Layers build outside any span, so this fiber retains no parent span.
      yield* wait.pipe(
        Effect.andThen(sample),
        Effect.andThen(wait.pipe(Effect.andThen(tick), Effect.forever)),
        Effect.forkScoped,
      );
    }),
  );

export const layer = layerWith(makeNodeSampler);

/**
 * The decisions the usage meter makes before it draws anything: which
 * providers get rows, and which rows each one gets.
 *
 * Split out of the component so all of it is testable without mounting the
 * sidebar, its atoms, and a server connection.
 *
 * @module sidebarUsageMeter.logic
 */
import type { ProviderRateLimits, RateLimitWindow, RateLimitWindowKind } from "@t3tools/contracts";

export type RateLimitProvider = ProviderRateLimits["provider"];

/**
 * Driver slug behind each quota reader. The names differ -- `claudeAgent` is
 * the driver, `claude` the quota source -- so this is the join between them.
 */
export const PROVIDER_DRIVER: Record<RateLimitProvider, string> = {
  claude: "claudeAgent",
  codex: "codex",
  grok: "grok",
};

/** Display order, fixed so rows never reshuffle as snapshots land. */
export const PROVIDER_ORDER: ReadonlyArray<RateLimitProvider> = ["claude", "codex", "grok"];

/**
 * Window order, shortest first: the near window is the one you are about to
 * hit, the far one is the one you cannot wait out.
 */
export const WINDOW_ORDER: ReadonlyArray<RateLimitWindowKind> = ["session", "weekly", "monthly"];

/**
 * One line in the meter.
 *
 * A row is a *window*, not a provider, because how many windows a provider has
 * is a property of the plan rather than of the provider: Claude Pro reports a
 * 5-hour and a weekly bucket, Max reports only the 5-hour one, Codex reports
 * both, and Grok reports a weekly credit period or a monthly budget depending
 * on billing. Collapsing that to one line per provider hid whichever window
 * happened not to be selected.
 */
export type UsageMeterRow = {
  readonly provider: RateLimitProvider;
  /** The provider's name is printed once per group; later rows indent under it. */
  readonly isFirstOfProvider: boolean;
  /** Null on a provider that reported no window at all. */
  readonly window: RateLimitWindow | null;
  readonly entry: ProviderRateLimits;
};

/**
 * Windows in display order, one per kind.
 *
 * `status` gates this rather than the array being empty: an `error` snapshot can
 * still carry windows from a previous successful read, and stale numbers drawn
 * as a live measurement are worse than no numbers.
 */
export function orderedWindows(entry: ProviderRateLimits): ReadonlyArray<RateLimitWindow> {
  if (entry.status !== "ok") return [];
  const byKind = new Map<RateLimitWindowKind, RateLimitWindow>();
  for (const window of entry.windows) {
    if (!byKind.has(window.kind)) byKind.set(window.kind, window);
  }
  return WINDOW_ORDER.flatMap((kind) => {
    const window = byKind.get(kind);
    return window === undefined ? [] : [window];
  });
}

/**
 * Rows to draw: a provider needs both an enabled driver and a snapshot.
 *
 * A provider the user turned off should not take a line in the sidebar,
 * whether or not its CLI still has credentials sitting on disk -- which it
 * will, because disabling a provider in Ronin does not log the CLI out.
 */
export function buildUsageRows(
  snapshots: ReadonlyArray<ProviderRateLimits>,
  enabledDrivers: ReadonlySet<string>,
): ReadonlyArray<UsageMeterRow> {
  const byProvider = new Map(snapshots.map((entry) => [entry.provider, entry]));

  return PROVIDER_ORDER.filter((provider) => enabledDrivers.has(PROVIDER_DRIVER[provider])).flatMap(
    (provider): ReadonlyArray<UsageMeterRow> => {
      const entry = byProvider.get(provider);
      if (entry === undefined) return [];

      const windows = orderedWindows(entry);
      // Still one row, so "Grok — not signed in" is visible rather than the
      // provider silently vanishing from a list it belongs in.
      if (windows.length === 0) {
        return [{ provider, isFirstOfProvider: true, window: null, entry }];
      }

      return windows.map((window, index) => ({
        provider,
        isFirstOfProvider: index === 0,
        window,
        entry,
      }));
    },
  );
}

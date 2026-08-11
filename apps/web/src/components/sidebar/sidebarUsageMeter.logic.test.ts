import type { ProviderRateLimits, RateLimitWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildUsageRows, orderedWindows, PROVIDER_DRIVER } from "./sidebarUsageMeter.logic";

function window(
  kind: RateLimitWindow["kind"],
  usedPercent: number,
  windowMinutes: number,
): RateLimitWindow {
  return { kind, usedPercent, windowMinutes, resetsAt: null };
}

function snapshot(
  provider: ProviderRateLimits["provider"],
  overrides: Partial<ProviderRateLimits> = {},
): ProviderRateLimits {
  return {
    provider,
    status: "ok",
    windows: [],
    planLabel: null,
    observedAt: "2026-02-02T00:00:00.000Z",
    message: null,
    ...overrides,
  };
}

const ALL_ENABLED = new Set(Object.values(PROVIDER_DRIVER));

function shape(rows: ReturnType<typeof buildUsageRows>) {
  return rows.map((row) => `${row.provider}:${row.window?.kind ?? "none"}`);
}

describe("orderedWindows", () => {
  it("sorts shortest window first regardless of report order", () => {
    const windows = orderedWindows(
      snapshot("codex", {
        windows: [window("weekly", 12, 10_080), window("session", 40, 300)],
      }),
    );

    expect(windows.map((entry) => entry.kind)).toEqual(["session", "weekly"]);
  });

  it("keeps one window per kind", () => {
    const windows = orderedWindows(
      snapshot("claude", {
        windows: [window("session", 40, 300), window("session", 90, 299)],
      }),
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]?.usedPercent).toBe(40);
  });

  it("reports nothing for a provider that is not ok", () => {
    // An `error` snapshot can still carry windows from a previous successful
    // read. Stale numbers drawn as a live measurement are worse than none.
    expect(orderedWindows(snapshot("grok", { status: "unavailable" }))).toEqual([]);
    expect(
      orderedWindows(
        snapshot("codex", { status: "error", windows: [window("weekly", 50, 10_080)] }),
      ),
    ).toEqual([]);
  });
});

describe("buildUsageRows", () => {
  it("gives a provider one row per window it reports", () => {
    // Codex reports both buckets, so both get a line. Collapsing to one hid
    // whichever window happened not to be selected.
    const rows = buildUsageRows(
      [snapshot("codex", { windows: [window("session", 0, 300), window("weekly", 12, 10_080)] })],
      ALL_ENABLED,
    );

    expect(shape(rows)).toEqual(["codex:session", "codex:weekly"]);
    expect(rows.map((row) => row.isFirstOfProvider)).toEqual([true, false]);
  });

  it("follows the plan rather than a fixed row count", () => {
    // Pro reports a 5-hour and a weekly bucket; Max reports only the 5-hour
    // one. The row count is a property of the plan, so it comes from the data.
    const pro = buildUsageRows(
      [snapshot("claude", { windows: [window("session", 82, 300), window("weekly", 30, 10_080)] })],
      ALL_ENABLED,
    );
    const max = buildUsageRows(
      [snapshot("claude", { windows: [window("session", 82, 300)] })],
      ALL_ENABLED,
    );

    expect(shape(pro)).toEqual(["claude:session", "claude:weekly"]);
    expect(shape(max)).toEqual(["claude:session"]);
  });

  it("keeps one row for a provider with nothing to report", () => {
    // A row saying "not signed in" is information; a provider silently
    // vanishing from a list it belongs in reads as a bug.
    const rows = buildUsageRows(
      [snapshot("grok", { status: "unavailable", message: "Not signed in to Grok" })],
      ALL_ENABLED,
    );

    expect(shape(rows)).toEqual(["grok:none"]);
    expect(rows[0]?.isFirstOfProvider).toBe(true);
  });

  it("drops a provider whose driver is disabled", () => {
    const rows = buildUsageRows(
      [snapshot("claude"), snapshot("codex"), snapshot("grok")],
      new Set([PROVIDER_DRIVER.claude, PROVIDER_DRIVER.codex]),
    );

    expect(rows.map((row) => row.provider)).toEqual(["claude", "codex"]);
  });

  it("drops a disabled provider even when its CLI still has credentials", () => {
    // Turning a provider off in Ronin does not log its CLI out, so a snapshot
    // keeps arriving. The enabled list is the authority over what gets a row.
    const rows = buildUsageRows(
      [snapshot("grok", { windows: [window("weekly", 67, 10_080)] })],
      new Set([PROVIDER_DRIVER.claude]),
    );

    expect(rows).toEqual([]);
  });

  it("keeps a fixed order regardless of the order snapshots arrive in", () => {
    // Snapshots resolve concurrently, so arrival order is a race. Rows
    // reshuffling under the cursor would be worse than any ordering choice.
    const rows = buildUsageRows(
      [snapshot("grok"), snapshot("claude"), snapshot("codex")],
      ALL_ENABLED,
    );

    expect(rows.map((row) => row.provider)).toEqual(["claude", "codex", "grok"]);
  });

  it("skips an enabled provider that has not reported yet", () => {
    const rows = buildUsageRows([snapshot("claude")], ALL_ENABLED);

    expect(shape(rows)).toEqual(["claude:none"]);
  });
});

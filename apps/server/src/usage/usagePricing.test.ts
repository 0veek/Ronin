import { describe, expect, it } from "@effect/vitest";

import { cursorRateModel } from "./cursorUsageReader.ts";
import type { UsageSpeed } from "./usageTranscripts.ts";
import {
  cacheSavingsUsd,
  lookupRate,
  normalizeModelName,
  parseRateTable,
  priceUsage,
} from "./usagePricing.ts";

const rate = (input: number, cacheRead?: number) => ({
  input_cost_per_token: input,
  output_cost_per_token: input * 5,
  ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead }),
});

describe("usage pricing", () => {
  const totals = {
    uncachedInputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningTokens: 500_000,
  };
  const record = (
    model: string,
    reportedCostUsd: number | null = null,
    speed: UsageSpeed = "standard",
  ) => ({
    model,
    totals,
    reportedCostUsd,
    speed,
  });

  it("prices Cursor cache savings at the base model rate", () => {
    const table = parseRateTable({
      "claude-fable-5-1": rate(10e-6, 1e-6),
      "xai/grok-4.7": rate(2e-6, 0.5e-6),
    });
    const cursorRecord = (model: string) => ({
      model,
      rateModel: cursorRateModel(model),
      totals: {
        uncachedInputTokens: 0,
        cachedInputTokens: 1_000_000,
        cacheCreationTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
      speed: "standard" as const,
      reportedCostUsd: 0.25,
    });

    expect(cacheSavingsUsd(table, cursorRecord("claude-fable-5-1-thinking-high"))).toBeCloseTo(9);
    expect(cacheSavingsUsd(table, cursorRecord("cursor-grok-4.7-high-fast"))).toBeCloseTo(1.5);
    expect(cacheSavingsUsd(table, cursorRecord("default"))).toBe(0);
    expect(priceUsage(table, cursorRecord("grok-4.7-xhigh-fast"))).toMatchObject({
      costUsd: 0.25,
      costSource: "providerReported",
    });
  });

  it("keeps the existing model-name normalization contract", () => {
    expect(normalizeModelName(" Anthropic/Claude-Opus-5 ")).toBe("claude-opus-5");
  });

  it("prices Claude fast requests at the published model multiplier", () => {
    const table = parseRateTable({
      "claude-opus-5-5": { ...rate(4e-6, 2e-7), provider_specific_entry: { fast: 2 } },
      "claude-fable-5-1": rate(1e-5, 2.5e-7),
    });
    expect(priceUsage(table, record("claude-opus-5-5", null, "fast")).costUsd).toBeCloseTo(
      2 * priceUsage(table, record("claude-opus-5-5")).costUsd,
    );
    expect(cacheSavingsUsd(table, record("claude-opus-5-5", null, "fast"))).toBeCloseTo(
      2 * cacheSavingsUsd(table, record("claude-opus-5-5")),
    );
    expect(priceUsage(table, record("claude-fable-5-1", null, "fast"))).toEqual(
      priceUsage(table, record("claude-fable-5-1")),
    );
  });

  it("splits costs by token category and scales provider-reported costs consistently", () => {
    const table = parseRateTable({
      example: { ...rate(1e-6, 0.1e-6), provider_specific_entry: { fast: 2 } },
    });
    const priced = priceUsage(table, record("example", null, "fast"));
    expect(priced.categoryCostUsd).toMatchObject({ input: 2, cacheWrite: 2, output: 10 });
    expect(priced.categoryCostUsd?.cacheRead).toBeCloseTo(0.2);
    expect(priced.speedPremiumUsd).toBeCloseTo(7.1);
    const reported = priceUsage(table, record("example", 7.1, "fast"));
    expect(reported.categoryCostUsd).toMatchObject({ input: 1, cacheWrite: 1, output: 5 });
    expect(reported.categoryCostUsd?.cacheRead).toBeCloseTo(0.1);
    expect(reported.speedPremiumUsd).toBeCloseTo(3.55);
    expect(priceUsage(new Map(), record("unknown", 3))).toEqual({
      costUsd: 3,
      costSource: "providerReported",
      categoryCostUsd: null,
      speedPremiumUsd: 0,
    });
  });

  it("prices Codex priority and ultrafast requests at their published tier rates", () => {
    const table = parseRateTable({
      "gpt-6-astra": {
        ...rate(1e-5, 1e-6),
        input_cost_per_token_priority: 2e-5,
        output_cost_per_token_priority: 1e-4,
        cache_read_input_token_cost_priority: 2e-6,
        input_cost_per_token_ultrafast: 6e-5,
        output_cost_per_token_ultrafast: 3e-4,
        // No ultrafast cache rate: keeps the standard 10:1 input-to-cache ratio.
      },
      "gpt-6-sol": rate(2e-6, 2e-7),
    });
    const cost = (model: string, speed: UsageSpeed) =>
      priceUsage(table, record(model, null, speed)).costUsd;
    const standard = cost("gpt-6-astra", "standard");

    expect(cost("gpt-6-astra", "fast")).toBeCloseTo(2 * standard);
    expect(cost("gpt-6-astra", "ultrafast")).toBeCloseTo(6 * standard);
    expect(cacheSavingsUsd(table, record("gpt-6-astra", null, "ultrafast"))).toBeCloseTo(
      6 * cacheSavingsUsd(table, record("gpt-6-astra")),
    );
    // A tier the model does not publish bills at the standard rate.
    expect(cost("gpt-6-sol", "ultrafast")).toBe(cost("gpt-6-sol", "standard"));
  });

  it("keeps the canonical Fable rate separate from DeepInfra in either order", () => {
    const canonical = ["claude-fable-5", rate(1e-5, 1e-6)] as const;
    const deepInfra = ["deepinfra/anthropic/claude-fable-5", rate(1e-5)] as const;

    for (const entries of [
      [canonical, deepInfra],
      [deepInfra, canonical],
    ]) {
      const table = parseRateTable(Object.fromEntries(entries));

      expect(lookupRate(table, "claude-fable-5")?.cacheReadCostPerToken).toBe(1e-6);
      expect(lookupRate(table, "deepinfra/anthropic/claude-fable-5")?.cacheReadCostPerToken).toBe(
        1e-5,
      );
      expect(lookupRate(table, "other/claude-fable-5")).toBeNull();
    }
  });

  it("prices a bracketed context-tier variant at the base model's rate", () => {
    const table = parseRateTable({ "claude-fable-5-1": rate(1e-5, 2.5e-7) });

    expect(lookupRate(table, "claude-fable-5-1[1m]")).toEqual(
      lookupRate(table, "claude-fable-5-1"),
    );
    expect(lookupRate(table, "anthropic/Claude-Fable-5-1[1m]")).toBeNull();
  });

  it("adds a bare alias when every qualified entry has the same rate", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(1),
    });

    expect(lookupRate(table, "example-model")).toEqual(
      lookupRate(table, "provider-a/example-model"),
    );
  });

  it("leaves an ambiguous bare name unpriced", () => {
    const table = parseRateTable({
      "provider-a/example-model": rate(1),
      "provider-b/example-model": rate(3),
    });

    expect(lookupRate(table, "provider-a/example-model")?.inputCostPerToken).toBe(1);
    expect(lookupRate(table, "provider-b/example-model")?.inputCostPerToken).toBe(3);
    expect(lookupRate(table, "example-model")).toBeNull();
  });
});

import { describe, expect, it } from "@effect/vitest";

import { cursorRateModel } from "./cursorUsageReader.ts";
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
      fast: false,
      reportedCostUsd: 0.25,
    });

    expect(cacheSavingsUsd(table, cursorRecord("claude-fable-5-1-thinking-high"))).toBeCloseTo(9);
    expect(cacheSavingsUsd(table, cursorRecord("cursor-grok-4.7-high-fast"))).toBeCloseTo(1.5);
    expect(cacheSavingsUsd(table, cursorRecord("default"))).toBe(0);
    expect(priceUsage(table, cursorRecord("grok-4.7-xhigh-fast"))).toEqual({
      costUsd: 0.25,
      costSource: "providerReported",
    });
  });

  it("keeps the existing model-name normalization contract", () => {
    expect(normalizeModelName(" Anthropic/Claude-Opus-5 ")).toBe("claude-opus-5");
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

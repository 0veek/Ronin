import {
  EnvironmentId,
  UsageDay,
  USAGE_CONTRACT_VERSION,
  type UsageProviderKind,
  type UsageSummary,
} from "@t3tools/contracts";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { expect, it } from "vite-plus/test";
import type { EnvironmentUsageStatus } from "./usage";
import { withoutProviders } from "./usageProviderFilter";

it("filters sources and buckets together, so session counts and totals restore together", () => {
  const day = UsageDay.make("2026-10-15");
  const providers: readonly UsageProviderKind[] = ["codex", "claude"];
  const summary: UsageSummary = {
    contractVersion: USAGE_CONTRACT_VERSION,
    readAt: "2026-10-15T00:00:00Z",
    timeZone: "UTC",
    sinceDay: day,
    untilDay: day,
    buckets: providers.map((provider, index) => ({
      day,
      provider,
      model: provider,
      sourcePath: `/${provider}`,
      totals: {
        uncachedInputTokens: 100,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 10,
        reasoningTokens: 0,
      },
      costUsd: index + 1,
      cacheSavingsUsd: 0,
      costSource: "modelPriced",
      records: 1,
      unpricedRecords: 0,
      sessions: 1,
    })),
    sources: providers.map((provider) => ({
      fingerprint: {
        hostId: "host",
        provider,
        resolvedHomePath: `/${provider}`,
        volumeId: provider,
      },
      status: "ok",
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: 1,
      message: null,
    })),
    pricing: { status: "fresh", source: "test", fetchedAt: null, knownModels: 2 },
    scanDurationMs: 1,
  };
  const environments: readonly EnvironmentUsageStatus[] = [
    {
      environmentId: EnvironmentId.make("test"),
      label: "Test",
      isPending: false,
      canReadDiagnostics: true,
      error: null,
      summary,
      needsCursorKeychainAccess: false,
    },
  ];
  const filtered = withoutProviders(environments, new Set(["codex"]));
  const merged = mergeUsage(
    filtered.flatMap((environment) =>
      environment.summary
        ? [
            {
              environmentId: environment.environmentId,
              label: environment.label,
              summary: environment.summary,
            },
          ]
        : [],
    ),
    USAGE_CONTRACT_VERSION,
  );
  expect(merged.costUsd).toBe(2);
  expect(merged.sessions).toBe(1);
  expect(merged.providers.map((provider) => provider.provider)).toEqual(["claude"]);
  expect(withoutProviders(environments, new Set())).toBe(environments);
  expect(summary.buckets).toHaveLength(2);
});

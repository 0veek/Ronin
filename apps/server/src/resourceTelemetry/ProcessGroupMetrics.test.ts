import { assert, describe, it } from "@effect/vitest";
import type { ResourceTelemetryProcess, ResourceTelemetrySnapshot } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as TestClock from "effect/testing/TestClock";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { groupProcesses, layer } from "./ProcessGroupMetrics.ts";
import * as ServerConfig from "../config.ts";
import * as ResourceTelemetry from "./ResourceTelemetry.ts";

const testConfig = (otlpMetricsUrl: string | undefined) =>
  ServerConfig.ServerConfig.pipe(
    Effect.map((config) => ({ ...config, otlpMetricsUrl })),
    Effect.provide(
      ServerConfig.layerTest(globalThis.process.cwd(), { prefix: "process-metrics-test-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

const process = (
  pid: number,
  ppid: number,
  name: string,
  category: ResourceTelemetryProcess["category"] = "server-child",
  command = name,
) =>
  ({
    identity: { pid, startTimeMs: 1 },
    ppid,
    name,
    command,
    category,
    residentBytes: pid * 1_000,
    cpuPercent: pid,
  }) as ResourceTelemetryProcess;

describe("groupProcesses", () => {
  it("recognizes every additional Ronin provider, including a Pi script", () => {
    const totals = groupProcesses([
      process(1, 0, "server", "server"),
      process(2, 1, "droid"),
      process(3, 1, "kilo"),
      process(4, 1, "pi"),
      process(5, 1, "muse"),
      process(6, 1, "node", "server-child", "node /opt/pi-coding-agent/dist/cli.js"),
      process(7, 4, "bash"),
    ]);
    assert.deepStrictEqual([...totals.keys()], ["server", "droid", "kilo", "pi", "muse"]);
    assert.deepStrictEqual(totals.get("pi"), { residentBytes: 17_000, cpuPercent: 17, count: 3 });
  });
  it("sums each direct child of the server with its whole subtree", () => {
    const totals = groupProcesses([
      process(10, 1, "node", "server"),
      process(11, 10, "t3-resource-mon", "resource-monitor"),
      process(20, 10, "claude"),
      process(21, 20, "bash"),
      process(22, 21, "cargo"),
      process(30, 10, "codex"),
      process(40, 10, "zsh"),
      process(50, 10, "chrome-headless"),
      process(60, 10, "git", "server-child", "git checkout claude/fix"),
      process(70, 99, "orphan"),
      // An older Claude package runs as a script under node.
      process(
        80,
        10,
        "node",
        "server-child",
        "node /opt/node_modules/@anthropic-ai/claude-code/cli.js",
      ),
      process(90, 10, "node", "server-child", "node /srv/tools/report.js"),
    ]);

    assert.deepStrictEqual(Object.fromEntries(totals), {
      server: { residentBytes: 10_000, cpuPercent: 10, count: 1 },
      "resource-monitor": { residentBytes: 11_000, cpuPercent: 11, count: 1 },
      // The agent's shell and the build it ran belong to the agent, not the terminal group.
      claude: { residentBytes: 143_000, cpuPercent: 143, count: 4 },
      codex: { residentBytes: 30_000, cpuPercent: 30, count: 1 },
      terminal: { residentBytes: 40_000, cpuPercent: 40, count: 1 },
      browser: { residentBytes: 50_000, cpuPercent: 50, count: 1 },
      // `git` whose arguments mention claude, a parentless process, and a node script.
      other: { residentBytes: 220_000, cpuPercent: 220, count: 3 },
    });
  });
});

describe("process metric sampling", () => {
  it.effect("does not request telemetry when metrics export is disabled", () =>
    Effect.gen(function* () {
      let count = 0;
      const config = yield* testConfig(undefined);
      yield* Layer.build(
        layer.pipe(
          Layer.provide(Layer.succeed(ServerConfig.ServerConfig, config)),
          Layer.provide(
            Layer.mock(ResourceTelemetry.ResourceTelemetry)({
              refresh: Effect.sync(() => {
                count += 1;
                throw new Error("Disabled export must not sample telemetry");
              }),
            }),
          ),
        ),
      );
      yield* TestClock.adjust("2 minutes");
      assert.strictEqual(count, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("samples each minute and clears gauges for a group that disappears", () =>
    Effect.gen(function* () {
      const sampled = yield* Deferred.make<void>();
      const config = yield* testConfig("http://collector/v1/metrics");
      let count = 0;
      const refresh = Effect.gen(function* () {
        count += 1;
        yield* Deferred.succeed(sampled, undefined);
        return {
          processes:
            count === 1 ? [process(10, 1, "node", "server"), process(20, 10, "claude")] : [],
        } as unknown as ResourceTelemetrySnapshot;
      });
      yield* Layer.build(
        layer.pipe(
          Layer.provide(Layer.succeed(ServerConfig.ServerConfig, config)),
          Layer.provide(Layer.mock(ResourceTelemetry.ResourceTelemetry)({ refresh })),
        ),
      );
      yield* Deferred.await(sampled);
      yield* TestClock.adjust("1 minute");
      assert.strictEqual(count, 2);
      const gauges = (yield* Metric.snapshot).filter(
        (value) =>
          value.id.startsWith("t3_process_group_") &&
          value.attributes?.group === "claude" &&
          value.type === "Gauge",
      );
      assert.strictEqual(gauges.length, 3);
      assert.isTrue(gauges.every((value) => value.type === "Gauge" && value.state.value === 0));
    }).pipe(Effect.scoped),
  );
});

import * as NodeCrypto from "node:crypto";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AutomationId,
  AutomationRunId,
  ProjectId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ThreadId,
  type Automation,
  type AutomationRun,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as TestClock from "effect/testing/TestClock";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { AutomationService } from "./AutomationService.ts";
import * as Store from "./AutomationStore.ts";
import * as Webhooks from "./AutomationWebhooks.ts";

const id = AutomationId.make("webhook-test");
const automation: Automation = {
  id,
  projectId: ProjectId.make("project-1"),
  title: "Review event",
  prompt: "Review {{body.action}} / {{query.source}}",
  schedule: {
    _tag: "webhook",
    signature: { header: "x-signature", encoding: "hex", prefix: "sha256=" },
  },
  envMode: "worktree",
  modelSelection: null,
  enabled: true,
  stopAfterConsecutiveFailures: 3,
  consecutiveFailureCount: 0,
  disabledReason: null,
  disabledAt: null,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  lastRunAt: null,
  nextRunAt: null,
};
const token = "webhook-token";
const secret = "private-signing-secret";
const bodyText = '{"action":"opened"}';
const request = {
  id,
  token,
  method: "POST",
  path: "/api/hooks/webhook-test",
  query: "source=github&token=hidden",
  bodyText,
  body: new TextEncoder().encode(bodyText),
  headers: {
    "content-type": "application/json",
    authorization: "Bearer private",
    "x-signature": `sha256=${NodeCrypto.createHmac("sha256", secret).update(bodyText).digest("hex")}`,
  },
};

const run: AutomationRun = {
  id: AutomationRunId.make("run-1"),
  automationId: id,
  startedAt: automation.createdAt,
  outcome: "started",
  threadId: ThreadId.make("run-thread"),
  detail: null,
};
const withWebhooks = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  dispatch: AutomationService["Service"]["runWebhook"],
) =>
  effect.pipe(
    Effect.provide(
      Webhooks.layer.pipe(
        Layer.provide(Layer.mock(AutomationService)({ runWebhook: dispatch })),
        Layer.provideMerge(Store.layer),
        Layer.provideMerge(SqlitePersistenceMemory),
        Layer.provide(NodeCryptoLayer.layer),
        Layer.provide(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  );

it.effect(
  "verifies exact bytes, renders only requested data, and redacts logged credentials",
  () => {
    const prompts: string[] = [];
    return withWebhooks(
      Effect.gen(function* () {
        const store = yield* Store.AutomationStore;
        const hooks = yield* Webhooks.AutomationWebhooks;
        yield* store.upsert(automation, { token, secret });
        const accepted = yield* hooks.trigger(request);
        expect(accepted.status).toBe("accepted");
        yield* hooks.drain;
        expect(prompts).toEqual(["Review opened / github"]);
        const summaries = yield* hooks.list(id);
        expect(summaries).toHaveLength(1);
        expect(summaries[0]?.signatureVerified).toBe(true);
        const detail = yield* hooks.get(id, summaries[0]!.id);
        expect(detail.headers.authorization).toBe("[redacted]");
        expect(detail.headers["x-signature"]).toBe("[redacted]");
        expect(detail.query).toBe("source=github&token=[redacted]");
        expect(detail.renderedPrompt).toBe("Review opened / github");
        expect(detail).not.toHaveProperty("secret");
        expect((yield* store.get(id))._tag).toBe("Some");
      }),
      ({ prompt }) =>
        Effect.sync(() => {
          prompts.push(prompt);
          return run;
        }),
    );
  },
);

it.effect(
  "rejects unknown tokens, tampered bodies and disabled automations before starting work",
  () => {
    let starts = 0;
    return withWebhooks(
      Effect.gen(function* () {
        const store = yield* Store.AutomationStore;
        const hooks = yield* Webhooks.AutomationWebhooks;
        yield* store.upsert(automation, { token, secret });
        expect((yield* hooks.trigger({ ...request, token: "wrong" })).status).toBe("not_found");
        expect(
          (yield* hooks.trigger({ ...request, body: new TextEncoder().encode("changed") })).status,
        ).toBe("rejected_signature");
        yield* store.upsert({ ...automation, enabled: false });
        expect((yield* hooks.trigger(request)).status).toBe("disabled");
        yield* hooks.drain;
        expect(starts).toBe(0);
        expect((yield* hooks.list(id)).map((row) => row.outcome).sort()).toEqual([
          "disabled",
          "rejected_signature",
        ]);
      }),
      () =>
        Effect.sync(() => {
          starts++;
          return run;
        }),
    );
  },
);

it.effect("bounds queued deliveries and releases their slots without polling", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    yield* withWebhooks(
      Effect.gen(function* () {
        const store = yield* Store.AutomationStore;
        const hooks = yield* Webhooks.AutomationWebhooks;
        yield* store.upsert(automation, { token, secret });
        const results = yield* Effect.forEach(
          Array.from({ length: 21 }),
          () => hooks.trigger(request),
          { concurrency: "unbounded" },
        );
        expect(results.filter((result) => result.status === "accepted")).toHaveLength(20);
        expect(results.filter((result) => result.status === "rate_limited")).toHaveLength(1);
        yield* Deferred.succeed(release, undefined);
        yield* hooks.drain;
        expect((yield* hooks.trigger(request)).status).toBe("accepted");
        yield* hooks.drain;
      }),
      () => Deferred.await(release).pipe(Effect.as(run)),
    );
  }),
);

it.effect(
  "keeps fifty deliveries, limits requests per minute, and recovers on the next window",
  () =>
    withWebhooks(
      Effect.gen(function* () {
        const store = yield* Store.AutomationStore;
        const hooks = yield* Webhooks.AutomationWebhooks;
        yield* store.upsert(automation, { token, secret });
        const ids = [];
        for (let count = 0; count < 60; count++) {
          const result = yield* hooks.trigger(request);
          expect(result.status).toBe("accepted");
          if (result.status === "accepted") ids.push(result.deliveryId);
          yield* hooks.drain;
        }
        expect((yield* hooks.list(id)).map((delivery) => delivery.id)).toEqual(
          ids.slice(-50).toReversed(),
        );
        expect((yield* hooks.trigger(request)).status).toBe("rate_limited");
        expect((yield* hooks.trigger(request)).status).toBe("rate_limited");
        const deliveries = yield* hooks.list(id);
        expect(deliveries).toHaveLength(50);
        expect(deliveries.filter((delivery) => delivery.outcome === "rate_limited")).toHaveLength(
          1,
        );
        yield* TestClock.adjust("1 minute");
        expect((yield* hooks.trigger(request)).status).toBe("accepted");
        yield* hooks.drain;
      }),
      () => Effect.succeed(run),
    ),
);

it.effect("checks filled-in prompts with provider limits and bounds UTF-8 log bytes", () => {
  const prompts: string[] = [];
  return withWebhooks(
    Effect.gen(function* () {
      const store = yield* Store.AutomationStore;
      const hooks = yield* Webhooks.AutomationWebhooks;
      yield* store.upsert(
        { ...automation, prompt: "{{body}}", schedule: { _tag: "webhook", signature: null } },
        { token, secret: null },
      );
      for (const text of [
        " ",
        "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1),
        "é".repeat(40_000),
      ]) {
        const result = yield* hooks.trigger({
          ...request,
          bodyText: text,
          body: new TextEncoder().encode(text),
        });
        expect(result.status).toBe("accepted");
        yield* hooks.drain;
        if (result.status !== "accepted") throw new Error("Expected a saved delivery");
        const delivery = yield* hooks.get(id, result.deliveryId);
        expect(new TextEncoder().encode(delivery.body).byteLength).toBeLessThanOrEqual(64 * 1024);
        expect(
          new TextEncoder().encode(delivery.renderedPrompt ?? "").byteLength,
        ).toBeLessThanOrEqual(64 * 1024);
        expect(delivery.outcome).toBe(text.startsWith("é") ? "accepted" : "dispatch_failed");
      }
      expect(prompts).toEqual(["é".repeat(40_000)]);
    }),
    ({ prompt }) =>
      Effect.sync(() => {
        prompts.push(prompt);
        return run;
      }),
  );
});

it.effect("records bounded delivery and run outcomes without request data in metrics", () =>
  withWebhooks(
    Effect.gen(function* () {
      const store = yield* Store.AutomationStore;
      const hooks = yield* Webhooks.AutomationWebhooks;
      yield* store.upsert(automation, { token, secret });
      yield* hooks.trigger({ ...request, token: "wrong" });
      yield* hooks.trigger(request);
      yield* hooks.drain;
      const snapshots = (yield* Metric.snapshot).filter((metric) =>
        metric.id.startsWith("t3_webhook_"),
      );
      const counter = (name: string, outcome: string) =>
        snapshots.find((metric) => metric.id === name && metric.attributes?.outcome === outcome);
      expect(counter("t3_webhook_deliveries_total", "accepted")).toMatchObject({
        type: "Counter",
        attributes: { source: "direct" },
        state: { count: 1 },
      });
      expect(counter("t3_webhook_deliveries_total", "not_found")).toMatchObject({
        state: { count: 1 },
      });
      expect(counter("t3_webhook_runs_total", "started")).toMatchObject({ state: { count: 1 } });
      expect(
        snapshots.find((metric) => metric.id === "t3_webhook_delivery_duration"),
      ).toMatchObject({ type: "Histogram", state: { count: 2 } });
      for (const metric of snapshots)
        expect(
          Object.keys(metric.attributes ?? {}).every((key) =>
            ["outcome", "source", "time_unit"].includes(key),
          ),
        ).toBe(true);
    }),
    () => Effect.succeed(run),
  ).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
);

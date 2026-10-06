import {
  AutomationError,
  AutomationId,
  AutomationWebhookDelivery,
  AutomationWebhookDeliveryId,
  AutomationWebhookDeliverySummary,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Metrics from "../observability/Metrics.ts";
import { AutomationStore } from "./AutomationStore.ts";
import { AutomationService } from "./AutomationService.ts";
import { constantTimeEquals, verifyWebhookSignature } from "./webhookVerification.ts";
import {
  redactHeaders,
  redactQuery,
  renderWebhookPrompt,
  type WebhookRequest,
} from "./webhookTemplate.ts";

const LOG_LIMIT = 64 * 1024;
const truncateLogText = (text: string) =>
  new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, LOG_LIMIT), { stream: true });
const RETAIN_DELIVERIES = 50;
const MAX_QUEUED = 20;
const RATE_PER_MINUTE = 60;
const decodeDelivery = Schema.decodeUnknownEffect(Schema.fromJsonString(AutomationWebhookDelivery));
const decodeSummary = Schema.decodeUnknownEffect(
  Schema.fromJsonString(AutomationWebhookDeliverySummary),
);
const encodeDelivery = Schema.encodeSync(Schema.fromJsonString(AutomationWebhookDelivery));

export type WebhookResult =
  | { readonly status: "accepted"; readonly deliveryId: AutomationWebhookDeliveryId }
  | { readonly status: "not_found" | "disabled" | "rejected_signature" | "rate_limited" };

export class AutomationWebhooks extends Context.Service<
  AutomationWebhooks,
  {
    readonly trigger: (
      input: WebhookRequest & {
        readonly id: AutomationId;
        readonly token: string;
        readonly body: Uint8Array;
      },
    ) => Effect.Effect<WebhookResult, AutomationError>;
    readonly list: (
      id: AutomationId,
    ) => Effect.Effect<ReadonlyArray<AutomationWebhookDeliverySummary>, AutomationError>;
    readonly get: (
      id: AutomationId,
      deliveryId: AutomationWebhookDeliveryId,
    ) => Effect.Effect<AutomationWebhookDelivery, AutomationError>;
    /** Receipts for maintenance/tests that need all already accepted deliveries to finish. */
    readonly drain: Effect.Effect<void>;
  }
>()("t3/automation/AutomationWebhooks") {}

export const layer = Layer.effect(
  AutomationWebhooks,
  Effect.gen(function* () {
    const store = yield* AutomationStore;
    const service = yield* AutomationService;
    const sql = yield* SqlClient.SqlClient;
    const crypto = yield* Crypto.Crypto;
    const scope = yield* Scope.Scope;
    const rate = new Map<string, { start: number; count: number }>();
    const queued = new Map<string, number>();
    const pending = new Set<Fiber.Fiber<void, never>>();
    const safeError = (detail: string) => new AutomationError({ reason: "writeFailed", detail });

    const record = (delivery: AutomationWebhookDelivery) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO automation_webhook_deliveries (delivery_id, automation_id, received_at, payload_json)
      SELECT ${delivery.id}, ${delivery.automationId}, ${delivery.receivedAt}, ${encodeDelivery(delivery)}
      WHERE EXISTS (SELECT 1 FROM automations WHERE automation_id = ${delivery.automationId})
      ON CONFLICT (delivery_id) DO UPDATE SET payload_json = excluded.payload_json`;
            yield* sql`DELETE FROM automation_webhook_deliveries WHERE automation_id = ${delivery.automationId}
      AND delivery_id NOT IN (SELECT delivery_id FROM automation_webhook_deliveries WHERE automation_id = ${delivery.automationId}
      ORDER BY received_at DESC, rowid DESC LIMIT ${RETAIN_DELIVERIES})`;
          }),
        )
        .pipe(Effect.mapError(() => safeError("Could not record webhook delivery.")));

    const triggerUnobserved: AutomationWebhooks["Service"]["trigger"] = (input) =>
      Effect.gen(function* () {
        const respond = <A extends WebhookResult>(
          result: A,
          outcome: WebhookResult["status"] | "prompt_too_long" | "queue_full" = result.status,
        ) =>
          Metrics.increment(Metrics.webhookDeliveriesTotal, { outcome, source: "direct" }).pipe(
            Effect.as(result),
          );
        const credentials = yield* store.getWebhookCredentials(input.id);
        if (credentials === null || !constantTimeEquals(input.token, credentials.token))
          return yield* respond({ status: "not_found" });
        const found = yield* store.get(input.id);
        if (Option.isNone(found) || found.value.schedule._tag !== "webhook")
          return yield* respond({ status: "not_found" });
        const automation = found.value;
        const signature =
          automation.schedule._tag === "webhook" ? automation.schedule.signature : null;
        const now = yield* Clock.currentTimeMillis;
        // Only live windows remain, including after an automation is deleted.
        for (const [key, window] of rate) if (now - window.start >= 60_000) rate.delete(key);
        const window = rate.get(input.id) ?? { start: now, count: 0 };
        window.count++;
        rate.set(input.id, window);
        const deliveryId = AutomationWebhookDeliveryId.make(
          yield* crypto.randomUUIDv4.pipe(Effect.orDie),
        );
        const text = truncateLogText(input.bodyText);
        const delivery: AutomationWebhookDelivery = {
          id: deliveryId,
          automationId: input.id,
          receivedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
          method: input.method,
          contentType: input.headers["content-type"] ?? null,
          bodyBytes: input.body.byteLength,
          outcome: "accepted",
          signatureVerified: false,
          missingFields: [],
          error: null,
          query: redactQuery(input.query),
          headers: redactHeaders(input.headers),
          body: text,
          bodyTruncated: text.length < input.bodyText.length,
          renderedPrompt: null,
        };
        if (window.count > RATE_PER_MINUTE) {
          if (window.count === RATE_PER_MINUTE + 1)
            yield* record({ ...delivery, outcome: "rate_limited" });
          return yield* respond({ status: "rate_limited" });
        }
        if (!automation.enabled) {
          yield* record({ ...delivery, outcome: "disabled" });
          return yield* respond({ status: "disabled" });
        }
        if (
          signature !== null &&
          (credentials.secret === null ||
            !verifyWebhookSignature({
              signature,
              secret: credentials.secret,
              headers: input.headers,
              body: input.body,
            }))
        ) {
          yield* record({ ...delivery, outcome: "rejected_signature" });
          return yield* respond({ status: "rejected_signature" });
        }
        const rendered = renderWebhookPrompt(automation.prompt, input);
        const accepted: AutomationWebhookDelivery = {
          ...delivery,
          signatureVerified: signature !== null,
          missingFields: rendered.missing,
          renderedPrompt: truncateLogText(rendered.prompt),
        };
        if (
          rendered.prompt.trim().length === 0 ||
          rendered.prompt.trim().length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS
        ) {
          yield* record({
            ...accepted,
            outcome: "dispatch_failed",
            error: "The filled-in prompt is empty or too long.",
          });
          return yield* respond({ status: "accepted", deliveryId }, "prompt_too_long");
        }
        const key = `${input.id}\0${automation.createdAt}`;
        // Once accepted, disconnecting the sender must not cancel its saved delivery.
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            if ((queued.get(key) ?? 0) >= MAX_QUEUED)
              return yield* respond({ status: "rate_limited" }, "queue_full");
            queued.set(key, (queued.get(key) ?? 0) + 1);
            const release = Effect.sync(() => {
              const count = (queued.get(key) ?? 1) - 1;
              if (count === 0) queued.delete(key);
              else queued.set(key, count);
            });
            yield* record(accepted).pipe(Effect.onError(() => release));
            const dispatch = service
              .runWebhook({ id: input.id, token: input.token, prompt: rendered.prompt })
              .pipe(
                Effect.exit,
                Effect.flatMap((exit) =>
                  Metrics.increment(Metrics.webhookRunsTotal, {
                    outcome: Exit.isFailure(exit)
                      ? "failed"
                      : exit.value.outcome === "started"
                        ? "started"
                        : "skipped",
                  }).pipe(Effect.andThen(Effect.suspend(() => exit))),
                ),
                Effect.flatMap((run) =>
                  run.outcome === "started"
                    ? Effect.void
                    : record({
                        ...accepted,
                        outcome: "dispatch_failed",
                        error: "The run did not start.",
                      }),
                ),
                Effect.catchCause(() =>
                  record({
                    ...accepted,
                    outcome: "dispatch_failed",
                    error: "The run did not start.",
                  }).pipe(Effect.ignore),
                ),
                Effect.ensuring(release),
              );
            const fiber = yield* dispatch.pipe(Effect.interruptible, Effect.forkIn(scope));
            pending.add(fiber);
            fiber.addObserver(() => pending.delete(fiber));
            return yield* respond({ status: "accepted", deliveryId });
          }),
        );
      });

    const trigger: AutomationWebhooks["Service"]["trigger"] = (input) =>
      triggerUnobserved(input).pipe(
        Effect.tapError(() =>
          Metrics.increment(Metrics.webhookDeliveriesTotal, { outcome: "error", source: "direct" }),
        ),
        Metrics.withMetrics({
          timer: Metrics.webhookDeliveryDuration,
          attributes: { source: "direct" },
        }),
        Effect.withSpan("AutomationWebhooks.trigger"),
      );

    const list: AutomationWebhooks["Service"]["list"] = (id) =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          payload: string;
        }>`SELECT json_remove(payload_json, '$.query', '$.headers', '$.body', '$.bodyTruncated', '$.renderedPrompt') AS payload FROM automation_webhook_deliveries
      WHERE automation_id = ${id} ORDER BY received_at DESC, rowid DESC LIMIT ${RETAIN_DELIVERIES}`;
        return yield* Effect.forEach(rows, (row) => decodeSummary(row.payload));
      }).pipe(Effect.mapError(() => safeError("Could not list webhook deliveries.")));

    const get: AutomationWebhooks["Service"]["get"] = (id, deliveryId) =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          payload: string;
        }>`SELECT payload_json AS payload FROM automation_webhook_deliveries WHERE automation_id = ${id} AND delivery_id = ${deliveryId}`;
        const row = rows[0];
        if (row === undefined) return yield* safeError("That delivery is no longer available.");
        return yield* decodeDelivery(row.payload);
      }).pipe(Effect.mapError(() => safeError("Could not load webhook delivery.")));

    return AutomationWebhooks.of({
      trigger,
      list,
      get,
      drain: Effect.suspend(() => Fiber.awaitAll([...pending])),
    });
  }),
);

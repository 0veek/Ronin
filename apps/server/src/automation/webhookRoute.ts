import { AutomationId } from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import * as Metrics from "../observability/Metrics.ts";
import { AutomationWebhooks } from "./AutomationWebhooks.ts";
import { WEBHOOK_ROUTE_PREFIX } from "./AutomationStore.ts";

export const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
const json = (status: number, outcome: string, body: Record<string, string>) =>
  HttpServerResponse.jsonUnsafe(body, {
    status,
    headers: { "x-ronin-hook-outcome": outcome, "cache-control": "no-store" },
  });

const handler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const params = yield* HttpRouter.params;
  const webhooks = yield* AutomationWebhooks;
  const tooLarge = (error: string) =>
    Metrics.increment(Metrics.webhookDeliveriesTotal, {
      outcome: "body_too_large",
      source: "direct",
    }).pipe(Effect.as(json(413, "body_too_large", { error })));
  const length = Number(request.headers["content-length"] ?? "0");
  if (!Number.isFinite(length) || length < 0 || length > WEBHOOK_MAX_BODY_BYTES)
    return yield* tooLarge("body_too_large");
  const body = yield* request.arrayBuffer.pipe(
    Effect.map((buffer) => new Uint8Array(buffer)),
    Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(WEBHOOK_MAX_BODY_BYTES)),
    Effect.option,
  );
  if (Option.isNone(body) || body.value.byteLength > WEBHOOK_MAX_BODY_BYTES)
    return yield* tooLarge("body_too_large_or_unreadable");
  const id = params.hookId;
  const token = params.token;
  if (id === undefined || token === undefined)
    return json(404, "not_found", { error: "hook_not_found" });
  const queryIndex = request.url.indexOf("?");
  const headers = Object.fromEntries(
    Object.entries(request.headers).flatMap(([name, value]) =>
      typeof value === "string" ? [[name.toLowerCase(), value]] : [],
    ),
  );
  const result = yield* webhooks
    .trigger({
      id: AutomationId.make(id),
      token,
      method: request.method,
      // Neither logs nor prompt interpolation may disclose the URL token.
      path: `${WEBHOOK_ROUTE_PREFIX}/${encodeURIComponent(id)}`,
      query: queryIndex === -1 ? "" : request.url.slice(queryIndex + 1),
      headers,
      body: body.value,
      bodyText: new TextDecoder().decode(body.value),
    })
    .pipe(Effect.option);
  if (Option.isNone(result)) return json(500, "error", { error: "internal_error" });
  switch (result.value.status) {
    case "accepted":
      return json(202, "accepted", { deliveryId: result.value.deliveryId });
    case "not_found":
      return json(404, "not_found", { error: "hook_not_found" });
    case "disabled":
      return json(409, "disabled", { error: "hook_disabled" });
    case "rejected_signature":
      return json(401, "rejected_signature", { error: "invalid_signature" });
    case "rate_limited":
      return json(429, "rate_limited", { error: "rate_limited" });
  }
}).pipe(Effect.catchCause(() => Effect.succeed(json(500, "error", { error: "internal_error" }))));

export const layer = Layer.mergeAll(
  HttpRouter.add("GET", `${WEBHOOK_ROUTE_PREFIX}/:hookId/:token`, handler),
  HttpRouter.add("POST", `${WEBHOOK_ROUTE_PREFIX}/:hookId/:token`, handler),
  HttpRouter.add("PUT", `${WEBHOOK_ROUTE_PREFIX}/:hookId/:token`, handler),
  HttpRouter.add("PATCH", `${WEBHOOK_ROUTE_PREFIX}/:hookId/:token`, handler),
);

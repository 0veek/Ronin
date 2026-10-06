import { describe, expect, it } from "vite-plus/test";
import { AutomationWebhookDeliveryId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { AutomationWebhooks, type WebhookResult } from "./AutomationWebhooks.ts";
import { layer, WEBHOOK_MAX_BODY_BYTES } from "./webhookRoute.ts";
import { untracedRequestsLayer } from "../http.ts";

const fixture = (
  result: WebhookResult = {
    status: "accepted",
    deliveryId: AutomationWebhookDeliveryId.make("delivery-test"),
  },
) => {
  const requests: Array<Parameters<AutomationWebhooks["Service"]["trigger"]>[0]> = [];
  const web = HttpRouter.toWebHandler(
    layer.pipe(
      Layer.provideMerge(
        Layer.mock(AutomationWebhooks)({
          trigger: (request) =>
            Effect.sync(() => {
              requests.push(request);
              return result;
            }),
        }),
      ),
      Layer.provideMerge(untracedRequestsLayer),
    ),
    { disableLogger: true },
  );
  return { ...web, requests };
};

describe("webhook ingress HTTP", () => {
  for (const method of ["GET", "POST", "PUT", "PATCH"]) {
    it(`accepts ${method} with exact body bytes and strips the bearer token from interpolation`, async () => {
      const web = fixture();
      try {
        const response = await web.handler(
          new Request("http://environment.test/api/hooks/automation/token-private?source=test", {
            method,
            ...(method === "GET" ? {} : { body: "exact body\n" }),
          }),
        );
        expect(response.status).toBe(202);
        expect(web.requests[0]?.path).toBe("/api/hooks/automation");
        expect(web.requests[0]?.query).toBe("source=test");
        expect(web.requests[0]?.bodyText).toBe(method === "GET" ? "" : "exact body\n");
        expect(response.headers.get("cache-control")).toBe("no-store");
      } finally {
        await web.dispose();
      }
    });
  }

  it("bounds chunked bodies before calling the automation service", async () => {
    const web = fixture();
    try {
      const response = await web.handler(
        new Request("http://environment.test/api/hooks/automation/token-private", {
          method: "POST",
          body: "a".repeat(WEBHOOK_MAX_BODY_BYTES + 1),
        }),
      );
      expect(response.status).toBe(413);
      expect(web.requests).toEqual([]);
    } finally {
      await web.dispose();
    }
  });

  for (const [status, expected] of [
    ["not_found", 404],
    ["disabled", 409],
    ["rejected_signature", 401],
    ["rate_limited", 429],
  ] as const) {
    it(`returns ${expected} for ${status}`, async () => {
      const web = fixture({ status });
      try {
        const response = await web.handler(
          new Request("http://environment.test/api/hooks/automation/token-private", {
            method: "POST",
            body: "{}",
          }),
        );
        expect(response.status).toBe(expected);
        expect(await response.text()).not.toContain("token-private");
      } finally {
        await web.dispose();
      }
    });
  }
});

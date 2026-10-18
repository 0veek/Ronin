import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { OtlpEndpointCheckInput } from "@t3tools/contracts";
import { DEFAULT_SIGNAL_EXPORT } from "@t3tools/shared/observability";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientResponse,
} from "effect/unstable/http";
import { describe, expect } from "vite-plus/test";
import * as ServerConfig from "../config.ts";
import * as OtlpEndpointCheck from "./OtlpEndpointCheck.ts";

function fixture(status: number | null) {
  const requests: Array<{
    url: string;
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
  }> = [];
  const client = HttpClient.make((request, _url, signal, fiber) => {
    expect(Context.getOrUndefined(fiber.context, FetchHttpClient.RequestInit)?.redirect).toBe(
      "manual",
    );
    requests.push({
      url: request.url,
      headers: request.headers,
      body: request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
      signal,
    });
    return status === null
      ? Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          }),
        )
      : Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status })));
  });
  const configLayer = Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return ServerConfig.make({
        ...config,
        otlpTracesUrl: "https://collector/v1/traces",
        otlpTracesExport: { ...DEFAULT_SIGNAL_EXPORT, headers: { "x-api-key": "fake-key" } },
      });
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "ronin-otlp-check-" })));
  return {
    requests,
    layer: OtlpEndpointCheck.layer.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
      Layer.provide(configLayer),
      Layer.provide(NodeServices.layer),
    ),
  };
}

describe("OTLP endpoint check", () => {
  it.effect(
    "pairs credentials with the exact running signal endpoint and releases responses",
    () => {
      const { requests, layer } = fixture(200);
      return Effect.gen(function* () {
        const service = yield* OtlpEndpointCheck.OtlpEndpointCheck;
        for (const url of [
          "https://collector/v1/traces",
          "https://collector/v1/traces?tenant=other",
          "https://elsewhere/v1/traces",
        ]) {
          assert.equal((yield* service.check({ signal: "traces", url }))._tag, "Accepted");
        }
        yield* service.check({ signal: "metrics", url: "https://collector/v1/traces" });
        assert.equal(requests[0]?.headers["x-api-key"], "fake-key");
        assert.equal(requests[0]?.body, '{"resourceSpans":[]}');
        assert.equal(requests[3]?.body, '{"resourceMetrics":[]}');
        for (const request of requests.slice(1)) assert.isUndefined(request.headers["x-api-key"]);
        assert.isTrue(requests.every((request) => request.signal.aborted));
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect.each([307, 401, 500, null])(
    "reports receiver rejection or connection failure: %s",
    (status) => {
      const { layer } = fixture(status);
      return Effect.gen(function* () {
        const service = yield* OtlpEndpointCheck.OtlpEndpointCheck;
        const result = yield* service.check({
          signal: "traces",
          url: "https://collector/v1/traces",
        });
        assert.deepEqual(
          result,
          status === null ? { _tag: "Unreachable", timedOut: false } : { _tag: "Rejected", status },
        );
      }).pipe(Effect.provide(layer));
    },
  );
  it("accepts only HTTP receivers and supported signals", () => {
    const decode = Schema.decodeUnknownSync(OtlpEndpointCheckInput);
    expect(decode({ signal: "traces", url: "https://collector/v1/traces" }).url).toBe(
      "https://collector/v1/traces",
    );
    for (const url of ["data:text/plain,ok", "file:///tmp/test", "collector:4318/v1/traces"])
      expect(() => decode({ signal: "traces", url })).toThrow();
    expect(() => decode({ signal: "logs", url: "https://collector/v1/logs" })).toThrow();
  });
});

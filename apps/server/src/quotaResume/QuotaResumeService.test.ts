import {
  ComposerContextId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationMessageContext,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { RateLimitService } from "../rateLimits/RateLimitService.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { make } from "./QuotaResumeService.ts";

const threadId = ThreadId.make("quota-recovery");
const request = {
  threadId,
  provider: "codex" as const,
  windowKind: null,
  explicitResetAt: "2099-01-01T00:00:00.000Z",
  detail: "Usage limit reached",
  text: "Fix [log](t3-context://v1/terminal/ctx_log)",
  attachments: [],
};
const context: OrchestrationMessageContext = {
  version: 1,
  records: [
    {
      version: 1,
      contextId: ComposerContextId.make("ctx_log"),
      kind: "terminal",
      label: "log",
      terminalId: "term-1",
      terminalLabel: "Terminal",
      lineStart: 0,
      lineEnd: 0,
      text: "The failure details",
    },
  ],
};

function harness() {
  const commands: OrchestrationCommand[] = [];
  let seed = 0;
  const service = make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(OrchestrationEngineService)({
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command);
              return { sequence: commands.length };
            }),
        }),
        Layer.mock(RateLimitService)({
          readSnapshot: Effect.succeed({ providers: [], readAt: "1970-01-01T00:00:00.000Z" }),
        }),
        Layer.mock(ServerSettingsService)({
          getSettings: Effect.succeed({ quotaResume: { maximumWait: "6h" } } as never),
        }),
        Layer.succeed(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => {
              seed++;
              return Uint8Array.from({ length: size }, (_, index) => (seed + index) % 256);
            },
            digest: (_algorithm, data) => Effect.succeed(data),
          }),
        ),
      ),
    ),
  );
  return { service, commands };
}

describe("quota recovery", () => {
  it.effect("replays the complete structured prompt", () =>
    Effect.gen(function* () {
      const test = harness();
      const service = yield* test.service;
      yield* service.park({ ...request, context });
      yield* service.runNow(threadId);
      const replay = test.commands.find((command) => command.type === "thread.turn.start");
      expect(replay?.type === "thread.turn.start" ? replay.message.context : null).toEqual(context);
    }),
  );

  it.effect("starts each unrelated user prompt with a fresh retry budget", () =>
    Effect.gen(function* () {
      const service = yield* harness().service;
      for (let index = 0; index < 4; index++) {
        expect((yield* service.park({ ...request, text: `New prompt ${index}` }))?.attempt).toBe(1);
        yield* service.runNow(threadId);
        yield* service.supersede(threadId);
      }
    }),
  );

  it.effect("keeps the retry limit across automatic replays and healthy session updates", () =>
    Effect.gen(function* () {
      const service = yield* harness().service;
      for (let attempt = 1; attempt <= 3; attempt++) {
        expect((yield* service.park(request))?.attempt).toBe(attempt);
        yield* service.runNow(threadId);
        yield* service.supersede(threadId, { resetAttempts: false });
      }
      expect(yield* service.park(request)).toBeNull();
      yield* service.supersede(threadId);
      expect((yield* service.park(request))?.attempt).toBe(1);
    }),
  );
});

import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderTurnId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { makeLegacyProviderAdapterV2 } from "./LegacyProviderAdapter.ts";

for (const driverName of [
  "codex",
  "claudeAgent",
  "opencode",
  "antigravity",
  "droid",
  "kilo",
  "pi",
] as const) {
  it.effect(
    `resolves ${driverName} rewind against native history, including an imported prefix`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const driver = ProviderDriverKind.make(driverName);
          const instanceId = ProviderInstanceId.make(driverName);
          const threadId = ThreadId.make("legacy-rewind");
          const runtimePolicy = {
            runtimeMode: "full-access" as const,
            interactionMode: "default" as const,
            cwd: "/workspace",
          };
          const modelSelection = { instanceId, model: "test" };
          const providers = yield* ProviderService;
          const adapter = makeLegacyProviderAdapterV2(
            {
              instanceId,
              driverKind: driver,
              adapter: { capabilities: { sessionModelSwitch: "in-session" } },
            },
            providers,
          );
          const runtime = yield* adapter.openSession({
            threadId,
            providerSessionId: ProviderSessionId.make("session"),
            modelSelection,
            runtimePolicy,
          });
          const providerThread = yield* runtime.ensureThread({
            threadId,
            modelSelection,
            runtimePolicy,
          });
          const turns = [1, 2, 3].map((n) => ({
            id: ProviderTurnId.make(`projected-${n}`),
            providerThreadId: providerThread.id,
            nodeId: NodeId.make(`node-${n}`),
            runAttemptId: null,
            nativeTurnRef: { driver, nativeId: `native-${n}`, strength: "strong" as const },
            ordinal: n,
            status: "completed" as const,
            startedAt: providerThread.createdAt,
            completedAt: providerThread.createdAt,
          }));
          assert.isDefined(runtime.prepareRollback);
          const boundary = yield* runtime.prepareRollback!({
            providerThread,
            providerThreadTurns: turns,
            target: {
              type: "provider_turn",
              checkpointId: CheckpointId.make("checkpoint"),
              appRunOrdinal: 2,
              providerTurn: turns[1]!,
            },
          });
          assert.equal(boundary, 3);
        }),
      ).pipe(
        Effect.provide(
          Layer.mock(ProviderService)({
            getContinuationState: () => Effect.succeed(Option.none()),
            stopSession: () => Effect.void,
            listSessions: () =>
              Effect.succeed([
                {
                  provider: ProviderDriverKind.make(driverName),
                  providerInstanceId: ProviderInstanceId.make(driverName),
                  threadId: ThreadId.make("legacy-rewind"),
                  status: "ready",
                  runtimeMode: "full-access",
                  cwd: "/workspace",
                  model: "test",
                  createdAt: "2026-10-04T00:00:00.000Z",
                  updatedAt: "2026-10-04T00:00:00.000Z",
                },
              ]),
            readThread: (threadId) =>
              Effect.succeed({
                threadId,
                turns: ["imported-prefix", "native-1", "native-2", "native-3"].map((id) => ({
                  id: TurnId.make(id),
                  items: [],
                })),
              }),
          }),
        ),
      ),
  );
}

import { assert, it } from "@effect/vitest";
import { ThreadId, TurnId, type ProviderGoal } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type * as CodexRpc from "effect-codex-app-server/rpc";
import type * as CodexSchema from "effect-codex-app-server/schema";
import { makeCodexGoalController } from "./CodexGoals.ts";
import { providerGoalFromCodex } from "../nativeGoals.ts";
import type { CodexSessionRuntimeSendTurnInput } from "./CodexSessionRuntime.ts";

type NativeGoal = CodexSchema.V2ThreadGoalUpdatedNotification["goal"];
const activeGoal: NativeGoal = {
  threadId: "native-thread",
  objective: "Old objective",
  status: "active",
  tokensUsed: 1234,
  tokenBudget: null,
  timeUsedSeconds: 60,
  createdAt: 0,
  updatedAt: 0,
};

function harness(
  initial: NativeGoal | null = null,
  gates?: { start?: Effect.Effect<void>; activate?: Effect.Effect<void> },
) {
  let native = initial;
  let reported: ProviderGoal | null = initial === null ? null : providerGoalFromCodex(initial);
  const calls: Array<{ method: string; payload: unknown }> = [];
  const starts: Array<CodexSessionRuntimeSendTurnInput> = [];
  const replies: Array<string> = [];
  const result = { threadId: ThreadId.make("app-thread"), turnId: TurnId.make("native-turn") };
  const controller = makeCodexGoalController({
    readThreadId: Effect.succeed("native-thread"),
    getGoal: Effect.sync(() => reported),
    rememberGoal: (_threadId, goal) =>
      Effect.sync(() => {
        reported = goal === null ? null : providerGoalFromCodex(goal);
      }),
    completeCommand: (reply) =>
      Effect.sync(() => {
        replies.push(reply);
        return { ...result, turnId: TurnId.make("local-command") };
      }),
    startNativeTurn: (input) =>
      Effect.gen(function* () {
        starts.push(input);
        yield* gates?.start ?? Effect.void;
        return result;
      }),
    client: {
      request: <M extends CodexRpc.ClientRequestMethod>(
        method: M,
        payload: CodexRpc.ClientRequestParamsByMethod[M],
      ) =>
        Effect.gen(function* () {
          calls.push({ method, payload });
          let response: unknown;
          if (method === "thread/goal/get") response = { goal: native };
          else if (method === "thread/goal/clear") {
            response = { cleared: native !== null };
            native = null;
          } else if (method === "thread/goal/set") {
            const params = payload as CodexRpc.ClientRequestParamsByMethod["thread/goal/set"];
            native = {
              ...(native ?? { ...activeGoal, tokensUsed: 0, timeUsedSeconds: 0 }),
              ...(params.objective == null ? {} : { objective: params.objective }),
              status: params.status ?? "active",
            };
            response = { goal: native };
            if (params.status === "active") yield* gates?.activate ?? Effect.void;
          } else return yield* Effect.die(`Unexpected native request: ${method}`);
          return response as CodexRpc.ClientRequestResponsesByMethod[M];
        }),
    },
  });
  return { ...controller, calls, starts, replies, goal: () => reported };
}

it.effect(
  "replaces a goal and starts with this turn's model and permissions before activation",
  () =>
    Effect.gen(function* () {
      const runtime = harness(activeGoal);
      yield* runtime.sendTurn({
        input: "/goal New objective",
        model: "test-model",
        interactionMode: "plan",
        effort: "high",
      });
      assert.deepEqual(runtime.starts, [
        { input: "New objective", model: "test-model", interactionMode: "plan", effort: "high" },
      ]);
      assert.deepEqual(
        runtime.calls.map((call) => call.method),
        ["thread/goal/get", "thread/goal/clear", "thread/goal/set", "thread/goal/set"],
      );
      assert.deepEqual(runtime.calls[2]?.payload, {
        threadId: "native-thread",
        objective: "New objective",
        status: "paused",
      });
      assert.equal(runtime.goal()?.status, "active");
      assert.equal(runtime.goal()?.tokensUsed, 0);
    }),
);

it.effect("shows, pauses and clears without adding native turns; resume retains accounting", () =>
  Effect.gen(function* () {
    const runtime = harness(activeGoal);
    yield* runtime.sendTurn({ input: "/goal" });
    yield* runtime.sendTurn({ input: "/goal pause" });
    assert.equal(runtime.starts.length, 0);
    assert.equal(runtime.goal()?.status, "paused");
    yield* runtime.sendTurn({ input: "/goal resume", model: "new-model" });
    assert.deepEqual(runtime.starts, [{ input: "", model: "new-model" }]);
    assert.equal(runtime.goal()?.tokensUsed, 1234);
    yield* runtime.sendTurn({ input: "/goal clear" });
    assert.isNull(runtime.goal());
    assert.equal(runtime.starts.length, 1);
    assert.deepEqual(runtime.replies, [
      "Goal active: Old objective",
      "Goal paused. Send /goal resume to continue.",
      "Goal cleared.",
    ]);
  }),
);

it.effect("does not invent a goal on resume or interpret an attached message as a command", () =>
  Effect.gen(function* () {
    const runtime = harness();
    yield* runtime.sendTurn({ input: "/goal resume" });
    assert.deepEqual(runtime.replies, ["No goal is set."]);
    const prompt = {
      input: "/goal describe this",
      attachments: [{ type: "image" as const, url: "https://example.test/image.png" }],
    };
    yield* runtime.sendTurn(prompt);
    assert.deepEqual(runtime.starts, [prompt]);
    assert.equal(runtime.calls.length, 1);
  }),
);

for (const phase of ["start", "activate"] as const) {
  it.effect(`Stop wins while goal ${phase} is in flight`, () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const runtime = harness(activeGoal, {
        [phase]: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
      });
      const sending = yield* runtime.sendTurn({ input: "/goal resume" }).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      assert.isTrue(yield* runtime.pause());
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(sending);
      assert.equal(runtime.goal()?.status, "paused");
      if (phase === "start")
        assert.isFalse(
          runtime.calls.some(
            (call) =>
              call.method === "thread/goal/set" &&
              (call.payload as { status: string }).status === "active",
          ),
        );
    }),
  );
}

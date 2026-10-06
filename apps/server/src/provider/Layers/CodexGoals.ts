import type { ProviderGoal, ProviderTurnStartResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as CodexClient from "effect-codex-app-server/client";
import type * as CodexSchema from "effect-codex-app-server/schema";
import type {
  CodexSessionRuntimeError,
  CodexSessionRuntimeSendTurnInput,
} from "./CodexSessionRuntime.ts";
import { parseCodexGoalCommand, providerGoalFromCodex, describeCodexGoal } from "../nativeGoals.ts";

/** Native goal control for one Codex session, including Stop racing activation. */
export function makeCodexGoalController(options: {
  readonly client: Pick<CodexClient.CodexAppServerClient["Service"], "request">;
  readonly readThreadId: Effect.Effect<string, CodexSessionRuntimeError>;
  readonly getGoal: Effect.Effect<ProviderGoal | null>;
  readonly rememberGoal: (
    threadId: string,
    goal: CodexSchema.V2ThreadGoalUpdatedNotification["goal"] | null,
  ) => Effect.Effect<void, CodexSessionRuntimeError>;
  readonly startNativeTurn: (
    input: CodexSessionRuntimeSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, CodexSessionRuntimeError>;
  readonly completeCommand: (
    reply: string,
  ) => Effect.Effect<ProviderTurnStartResult, CodexSessionRuntimeError>;
}) {
  let goalActivation: { stopped: boolean } | undefined;
  const sendTurn = Effect.fn("CodexSessionRuntime.sendTurn")(function* (
    input: CodexSessionRuntimeSendTurnInput,
  ) {
    const command =
      (input.attachments?.length ?? 0) === 0 ? parseCodexGoalCommand(input.input ?? "") : null;
    if (command === null) return yield* options.startNativeTurn(input);
    const threadId = yield* options.readThreadId;
    const current = (yield* options.client.request("thread/goal/get", { threadId })).goal ?? null;
    yield* options.rememberGoal(threadId, current);
    if (command.type === "show") {
      const goal = current === null ? null : providerGoalFromCodex(current);
      return yield* options.completeCommand(
        goal === null ? "No goal is set." : describeCodexGoal(goal),
      );
    }
    if (command.type === "clear") {
      const { cleared } = yield* options.client.request("thread/goal/clear", { threadId });
      yield* options.rememberGoal(threadId, null);
      return yield* options.completeCommand(cleared ? "Goal cleared." : "No goal to clear.");
    }
    if (current === null && command.type !== "set")
      return yield* options.completeCommand("No goal is set.");
    if (command.type === "pause") {
      const { goal } = yield* options.client.request("thread/goal/set", {
        threadId,
        status: "paused",
      });
      yield* options.rememberGoal(threadId, goal);
      return yield* options.completeCommand("Goal paused. Send /goal resume to continue.");
    }
    if (command.type === "set") {
      if (current !== null) yield* options.client.request("thread/goal/clear", { threadId });
      const { goal } = yield* options.client.request("thread/goal/set", {
        threadId,
        objective: command.objective,
        status: "paused",
      });
      yield* options.rememberGoal(threadId, goal);
    }
    // Activate only after a configured first turn starts; native auto-start
    // would otherwise reuse the previous turn's model and permission settings.
    const activation = { stopped: false };
    goalActivation = activation;
    return yield* Effect.gen(function* () {
      const started = yield* options.startNativeTurn({
        ...input,
        input: command.type === "set" ? command.objective : "",
      });
      if (!activation.stopped) {
        const { goal } = yield* options.client.request("thread/goal/set", {
          threadId,
          status: "active",
        });
        yield* options.rememberGoal(threadId, goal);
        // Stop can race activation while the request is in flight.
        if (activation.stopped) {
          const paused = yield* options.client.request("thread/goal/set", {
            threadId,
            status: "paused",
          });
          yield* options.rememberGoal(threadId, paused.goal);
        }
      }
      return started;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (goalActivation === activation) goalActivation = undefined;
        }),
      ),
    );
  });

  const pause = Effect.fn("CodexGoals.pause")(function* () {
    const stoppingGoal =
      (yield* options.getGoal)?.status === "active" || goalActivation !== undefined;
    if (goalActivation !== undefined) goalActivation.stopped = true;
    if (stoppingGoal) {
      const threadId = yield* options.readThreadId;
      const { goal } = yield* options.client.request("thread/goal/set", {
        threadId,
        status: "paused",
      });
      yield* options.rememberGoal(threadId, goal);
    }
    return stoppingGoal;
  });
  return { sendTurn, pause };
}

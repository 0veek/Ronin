import type { MessageId, ProviderSendTurnInput } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Carries Ronin's prepared skill, debug and provider-handoff prompt to the V2 worker. */
export class PreparedTurnRequests extends Context.Service<
  PreparedTurnRequests,
  {
    readonly put: (messageId: MessageId, request: ProviderSendTurnInput) => Effect.Effect<void>;
    readonly take: (messageId: MessageId) => Effect.Effect<ProviderSendTurnInput | undefined>;
    readonly clearThread: (threadId: ProviderSendTurnInput["threadId"]) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/compat/PreparedTurnRequests") {}

export const layer = Layer.sync(PreparedTurnRequests, () => {
  const requests = new Map<MessageId, ProviderSendTurnInput>();
  return {
    put: (messageId, request) =>
      Effect.sync(() => {
        requests.set(messageId, request);
      }),
    take: (messageId) =>
      Effect.sync(() => {
        const request = requests.get(messageId);
        requests.delete(messageId);
        return request;
      }),
    clearThread: (threadId) =>
      Effect.sync(() => {
        for (const [messageId, request] of requests)
          if (request.threadId === threadId) requests.delete(messageId);
      }),
  };
});

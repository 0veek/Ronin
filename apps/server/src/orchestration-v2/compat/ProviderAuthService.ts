import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export class ProviderAuthCommandError extends Schema.TaggedErrorClass<ProviderAuthCommandError>()(
  "ProviderAuthCommandError",
  { detail: Schema.String },
) {}

// Ronin's provider adapters process their native authentication commands.
export class ProviderAuthService extends Context.Service<
  ProviderAuthService,
  {
    readonly tryHandlePromptCommand: (input: {
      readonly instanceId: ProviderInstanceId;
      readonly text: string;
      readonly hasAttachments: boolean;
    }) => Effect.Effect<boolean, ProviderAuthCommandError>;
  }
>()("t3/orchestration-v2/compat/ProviderAuthService") {}
export const layer = Layer.succeed(ProviderAuthService, {
  tryHandlePromptCommand: () => Effect.succeed(false),
});

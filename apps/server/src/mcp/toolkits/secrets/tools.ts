import {
  McpCapabilityUnavailableError,
  SecretRef,
  SecretRequestError,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { SecretRequests } from "../../../secrets/SecretRequests.ts";
import { ThreadManagementService } from "../../../orchestration-v2/ThreadManagementService.ts";
import { EventSinkV2 } from "../../../orchestration-v2/EventSink.ts";

export const RequestSecretInput = Schema.Struct({
  label: TrimmedNonEmptyString,
  reason: Schema.String,
  placeholder: Schema.optional(Schema.String),
  clientRequestId: Schema.optional(TrimmedNonEmptyString),
  timeoutMs: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 3_600_000 })),
  ),
});
export const RequestSecretResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("saved"), secretRef: SecretRef }),
  Schema.Struct({ status: Schema.Literals(["declined", "cancelled", "timed_out"]) }),
]);
export type RequestSecretResult = typeof RequestSecretResult.Type;

export const RequestSecretTool = Tool.make("request_secret", {
  description:
    "Ask the user for a secret in a private input card in this thread. The value never enters chat or model context. Returns a one-use secretRef for a tool that explicitly accepts one; never ask the user to paste a secret into chat. Use a stable clientRequestId when retrying the same request. An unanswered card closes when this call times out or the agent stops.",
  parameters: RequestSecretInput,
  success: RequestSecretResult,
  failure: Schema.Union([SecretRequestError, McpCapabilityUnavailableError]),
  dependencies: [McpInvocationContext, SecretRequests, ThreadManagementService, EventSinkV2],
})
  .annotate(Tool.Title, "Request a private secret")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const SecretsToolkit = Toolkit.make(RequestSecretTool);

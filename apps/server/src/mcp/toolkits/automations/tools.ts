import {
  Automation,
  AutomationError,
  AutomationId,
  AutomationWebhookSignature,
  McpCapabilityUnavailableError,
  SecretRef,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";
import { AutomationService } from "../../../automation/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";

export const SaveWebhookAutomationTool = Tool.make("save_webhook_automation", {
  description:
    "Create or edit a webhook automation in this thread's project. It opens a new worktree and thread for each accepted delivery. Use {{body.path}}, {{headers.name}}, {{query.name}}, {{body}}, or {{request}} in the prompt to select the data sent to the agent. The returned webhook.path is relative to this environment. For HMAC-SHA256 verification, get a one-use secretRef with request_secret first; omit secretRef on an edit to retain the existing signing secret. Requires an active full-access, non-plan turn. Omit id to create an automation.",
  parameters: Schema.Struct({
    id: Schema.optional(AutomationId),
    title: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
    prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
    signature: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          ...AutomationWebhookSignature.fields,
          secretRef: Schema.optional(SecretRef),
        }),
      ),
    ),
    enabled: Schema.optional(Schema.Boolean),
  }),
  success: Automation,
  failure: Schema.Union([AutomationError, McpCapabilityUnavailableError]),
  dependencies: [McpInvocationContext, AutomationService, ProjectionSnapshotQuery],
})
  .annotate(Tool.Title, "Save webhook automation")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const AutomationsToolkit = Toolkit.make(SaveWebhookAutomationTool);

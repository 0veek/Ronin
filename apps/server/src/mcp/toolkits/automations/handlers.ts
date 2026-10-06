import { AutomationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AutomationService } from "../../../automation/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import { AutomationsToolkit } from "./tools.ts";

export const AutomationsToolkitHandlersLive = AutomationsToolkit.toLayer(
  Effect.gen(function* () {
    const automations = yield* AutomationService;
    const snapshots = yield* ProjectionSnapshotQuery;
    return {
      save_webhook_automation: (input) =>
        Effect.gen(function* () {
          const scope = yield* requireMcpCapability("automations");
          const caller = yield* snapshots.getThreadShellById(scope.threadId).pipe(
            Effect.mapError(
              () =>
                new AutomationError({
                  reason: "readFailed",
                  detail: "Could not read the calling thread.",
                }),
            ),
          );
          if (
            Option.isNone(caller) ||
            caller.value.archivedAt !== null ||
            caller.value.latestTurn?.state !== "running" ||
            (caller.value.session?.providerInstanceId ?? caller.value.modelSelection.instanceId) !==
              scope.providerInstanceId ||
            caller.value.runtimeMode !== "full-access" ||
            caller.value.interactionMode === "plan"
          ) {
            return yield* new AutomationError({
              reason: "writeFailed",
              detail:
                "Webhook automations require an active full-access, non-plan turn owned by this provider.",
            });
          }
          const thread = caller.value;
          const fields = {
            title: input.title,
            prompt: input.prompt,
            schedule: { _tag: "webhook" as const, signature: input.signature ?? null },
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          };
          if (input.id !== undefined) {
            const owned = (yield* automations.list(thread.projectId)).some(
              (automation) => automation.id === input.id,
            );
            if (!owned)
              return yield* new AutomationError({
                reason: "notFound",
                detail: "That automation is not in this thread's project.",
              });
            return yield* automations.update({ id: input.id, ...fields });
          }
          return yield* automations.create({
            projectId: thread.projectId,
            envMode: "worktree",
            modelSelection: thread.modelSelection,
            ...fields,
          });
        }),
    };
  }),
);

import { expect, it } from "@effect/vitest";
import {
  AutomationId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type AutomationCreateInput,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AutomationService } from "../../../automation/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { McpInvocationContext } from "../../McpInvocationContext.ts";
import { AutomationsToolkit } from "./tools.ts";
import { AutomationsToolkitHandlersLive } from "./handlers.ts";

const now = "2026-10-06T00:00:00.000Z";
const caller: OrchestrationThreadShell = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Caller",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: {
    turnId: TurnId.make("turn-1"),
    state: "running",
    requestedAt: now,
    startedAt: now,
    completedAt: null,
    assistantMessageId: null,
  },
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: now,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const makeToolkit = (thread: OrchestrationThreadShell) =>
  Effect.gen(function* () {
    const saved: Array<AutomationCreateInput> = [];
    const dependencies = Layer.mergeAll(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadShellById: () => Effect.succeed(Option.some(thread)),
      }),
      Layer.mock(AutomationService)({
        list: () => Effect.succeed([]),
        create: (input) =>
          Effect.sync(() => {
            saved.push(input);
            return {
              ...input,
              id: AutomationId.make("created"),
              schedule: { _tag: "webhook" as const, signature: null },
              modelSelection: input.modelSelection ?? null,
              enabled: true,
              stopAfterConsecutiveFailures: 3,
              consecutiveFailureCount: 0,
              disabledReason: null,
              disabledAt: null,
              createdAt: now,
              updatedAt: now,
              lastRunAt: null,
              nextRunAt: null,
            };
          }),
      }),
    );
    const toolkit = yield* AutomationsToolkit.pipe(
      Effect.provide(AutomationsToolkitHandlersLive.pipe(Layer.provide(dependencies))),
    );
    const call = (id?: AutomationId) =>
      toolkit
        .handle("save_webhook_automation", {
          ...(id === undefined ? {} : { id }),
          title: "Handle events",
          prompt: "Review {{body}}",
        })
        .pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.provide(dependencies),
          Effect.provideService(McpInvocationContext, {
            environmentId: EnvironmentId.make("env-1"),
            threadId: caller.id,
            providerSessionId: "session-1",
            providerInstanceId: caller.modelSelection.instanceId,
            capabilities: new Set(["automations"] as const),
            issuedAt: 0,
          }),
        );
    return { call, saved };
  });

it.effect("creates webhook worktrees only in the calling thread's project and model", () =>
  Effect.gen(function* () {
    const { call, saved } = yield* makeToolkit(caller);
    yield* call();
    expect(saved).toMatchObject([
      {
        projectId: caller.projectId,
        modelSelection: caller.modelSelection,
        envMode: "worktree",
        schedule: { _tag: "webhook" },
      },
    ]);
  }),
);

for (const [name, changes] of [
  ["plan", { interactionMode: "plan" }],
  ["approval-required", { runtimeMode: "approval-required" }],
  ["idle", { latestTurn: null }],
  [
    "another provider",
    { modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "test" } },
  ],
] as const) {
  it.effect(`rejects unattended automation writes from ${name} callers`, () =>
    Effect.gen(function* () {
      const { call, saved } = yield* makeToolkit({ ...caller, ...changes });
      expect(yield* call().pipe(Effect.flip)).toMatchObject({
        _tag: "AutomationError",
        reason: "writeFailed",
      });
      expect(saved).toEqual([]);
    }),
  );
}

it.effect("does not edit another project's webhook automation", () =>
  Effect.gen(function* () {
    const { call, saved } = yield* makeToolkit(caller);
    expect(
      yield* call(AutomationId.make("other-project-automation")).pipe(Effect.flip),
    ).toMatchObject({ _tag: "AutomationError", reason: "notFound" });
    expect(saved).toEqual([]);
  }),
);

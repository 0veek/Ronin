/**
 * AutomationService - the rules around a scheduled prompt.
 *
 * Owns three things the store deliberately does not: what a valid automation
 * looks like after an edit, when the next run is, and what firing one actually
 * does. Firing is intentionally thin — it opens a thread and starts a turn,
 * and from that instant the run is an ordinary thread that the sidebar,
 * checkpointing, and provider switching all treat like any other.
 *
 * @module AutomationService
 */
import {
  type Automation,
  applyAutomationEnabledChange,
  applyAutomationRunOutcome,
  AutomationError,
  AutomationId,
  type AutomationRun,
  AutomationRunId,
  type AutomationCreateInput,
  type AutomationUpdateInput,
  CommandId,
  DEFAULT_AUTOMATION_STOP_AFTER_CONSECUTIVE_FAILURES,
  MessageId,
  type ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { prepareThreadWorktree } from "../git/prepareThreadWorktree.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import { AutomationStore } from "./AutomationStore.ts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { isStale, nextRunAtMs, shouldFireNow } from "./automationSchedule.ts";

export interface AutomationServiceShape {
  readonly list: (projectId: ProjectId | null) => Effect.Effect<ReadonlyArray<Automation>>;
  readonly create: (input: AutomationCreateInput) => Effect.Effect<Automation, AutomationError>;
  readonly update: (input: AutomationUpdateInput) => Effect.Effect<Automation, AutomationError>;
  readonly remove: (id: AutomationId) => Effect.Effect<boolean, AutomationError>;
  readonly runNow: (id: AutomationId) => Effect.Effect<AutomationRun, AutomationError>;
  readonly listRuns: (input: {
    readonly automationId: AutomationId | null;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<AutomationRun>>;
  /**
   * Fire everything that is due and re-arm it.
   *
   * Called by the scheduler on its tick. Safe to call at any time: an
   * automation that is not due is left alone.
   */
  readonly tick: Effect.Effect<void>;
}

export class AutomationService extends Context.Service<AutomationService, AutomationServiceShape>()(
  "t3/automation/AutomationService",
) {}

/**
 * Thread title for a run.
 *
 * Prefixed rather than titled from the prompt: a list of threads all called
 * "Triage new issues" is much easier to read than a list of first lines, and
 * the automation's own name is what the user chose to call this work.
 */
export function automationThreadTitle(automation: Automation): string {
  const title = automation.title.trim();
  return title.length === 0 ? "Automation" : title;
}

export const make = Effect.gen(function* () {
  const store = yield* AutomationStore;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  // `orDie` because the only failure is the platform refusing to produce a
  // UUID. There is no automation behaviour that could recover from that, and a
  // live error channel would widen every caller's signature for nothing.
  const randomUUID = crypto.randomUUIDv4.pipe(Effect.orDie);

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const reschedule = (automation: Automation, nowMs: number): Automation => {
    if (!automation.enabled) return { ...automation, nextRunAt: null };
    const next = nextRunAtMs({
      schedule: automation.schedule,
      afterMs: nowMs,
      lastRunAtMs: automation.lastRunAt === null ? null : Date.parse(automation.lastRunAt),
    });
    return {
      ...automation,
      nextRunAt: next === null ? null : DateTime.formatIso(DateTime.makeUnsafe(next)),
    };
  };

  const list = (projectId: ProjectId | null) => store.list(projectId);

  const requireProject = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const snapshot = yield* snapshotQuery.getSnapshot().pipe(Effect.orElseSucceed(() => null));
      // A read failure is not proof the project is missing, and refusing to
      // save on a transient database hiccup would be worse than saving an
      // automation whose project turns out to be gone (the run simply skips).
      if (snapshot === null) return;
      if (!snapshot.projects.some((project) => project.id === projectId)) {
        return yield* new AutomationError({
          reason: "projectNotFound",
          detail: "That project no longer exists.",
        });
      }
    });

  const create: AutomationServiceShape["create"] = Effect.fn("create")(function* (
    input: AutomationCreateInput,
  ) {
    yield* requireProject(input.projectId);
    const nowMs = yield* Clock.currentTimeMillis;
    const createdAt = yield* nowIso;
    const base: Automation = {
      id: AutomationId.make(yield* randomUUID),
      projectId: input.projectId,
      title: input.title,
      prompt: input.prompt,
      schedule: input.schedule,
      envMode: input.envMode,
      modelSelection: input.modelSelection ?? null,
      enabled: input.enabled ?? true,
      stopAfterConsecutiveFailures:
        input.stopAfterConsecutiveFailures === undefined
          ? DEFAULT_AUTOMATION_STOP_AFTER_CONSECUTIVE_FAILURES
          : input.stopAfterConsecutiveFailures,
      consecutiveFailureCount: 0,
      disabledReason: null,
      disabledAt: null,
      createdAt,
      updatedAt: createdAt,
      lastRunAt: null,
      nextRunAt: null,
    };
    const automation = reschedule(base, nowMs);
    yield* store.upsert(automation);
    return automation;
  });

  const update: AutomationServiceShape["update"] = Effect.fn("update")(function* (
    input: AutomationUpdateInput,
  ) {
    const existing = yield* store.get(input.id);
    if (Option.isNone(existing)) {
      return yield* new AutomationError({
        reason: "notFound",
        detail: "That automation no longer exists.",
      });
    }
    const nowMs = yield* Clock.currentTimeMillis;
    const updatedAt = yield* nowIso;
    const withToggle =
      input.enabled === undefined
        ? existing.value
        : applyAutomationEnabledChange({
            automation: existing.value,
            enabled: input.enabled,
            nowIso: updatedAt,
          });
    const merged: Automation = {
      ...withToggle,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
      ...(input.envMode === undefined ? {} : { envMode: input.envMode }),
      ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
      ...(input.stopAfterConsecutiveFailures === undefined
        ? {}
        : { stopAfterConsecutiveFailures: input.stopAfterConsecutiveFailures }),
      updatedAt,
    };
    // Re-armed from now rather than from the old next-run time: changing a
    // schedule from "every 6 hours" to "every 15 minutes" should take effect
    // now, not after the six hours already elapsed.
    const automation = reschedule(merged, nowMs);
    yield* store.upsert(automation);
    return automation;
  });

  const remove = (id: AutomationId) => store.remove(id);

  const recordRun = (input: {
    readonly automation: Automation;
    readonly outcome: AutomationRun["outcome"];
    readonly threadId: ThreadId | null;
    readonly detail: string | null;
  }) =>
    Effect.gen(function* () {
      const run: AutomationRun = {
        id: AutomationRunId.make(yield* randomUUID),
        automationId: input.automation.id,
        startedAt: yield* nowIso,
        outcome: input.outcome,
        threadId: input.threadId,
        detail: input.detail,
      };
      yield* store.appendRun(run);
      return run;
    });

  /**
   * Open a thread for this automation and start its turn.
   *
   * The `bootstrap` field on `thread.turn.start` is a WebSocket-layer
   * convenience — `ws.ts` expands it into separate commands before dispatch,
   * and the decider itself requires the thread to already exist. Firing from
   * here therefore has to do that expansion itself: create, prepare, start.
   *
   * A failure after the thread exists deletes it again, so a run that could
   * not start leaves no empty thread behind in the sidebar.
   */
  const fire = (automation: Automation) =>
    Effect.gen(function* () {
      const project = yield* snapshotQuery
        .getProjectShellById(automation.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(project)) {
        return yield* recordRun({
          automation,
          outcome: "skipped",
          threadId: null,
          detail: "The project no longer exists.",
        });
      }

      const threadId = ThreadId.make(yield* randomUUID);
      const createdAt = yield* nowIso;
      const modelSelection = automation.modelSelection ?? project.value.defaultModelSelection;
      if (modelSelection === null) {
        // Without a model there is nothing to send to. Skipping with a reason
        // is far better than starting a turn that fails on arrival.
        return yield* recordRun({
          automation,
          outcome: "skipped",
          threadId: null,
          detail: "This project has no default model.",
        });
      }

      const workspaceRoot = project.value.workspaceRoot;

      const deleteCreatedThread = orchestrationEngine
        .dispatch({
          type: "thread.delete",
          commandId: CommandId.make(`server:automation-cleanup:${yield* randomUUID}`),
          threadId,
        })
        .pipe(Effect.ignoreCause({ log: true }));

      const startProgram = Effect.gen(function* () {
        yield* orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`server:automation-create:${yield* randomUUID}`),
          threadId,
          projectId: automation.projectId,
          title: automationThreadTitle(automation),
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
        });

        // Isolation is the whole promise of worktree mode, so a repo that
        // cannot give us one fails the run rather than quietly writing into
        // the checkout somebody is using.
        if (automation.envMode === "worktree") {
          const status = yield* gitWorkflow.localStatus({ cwd: workspaceRoot });
          if (!status.isRepo || status.refName === null) {
            return yield* new AutomationError({
              reason: "writeFailed",
              detail: "This project is not a Git repository, so it cannot run in a worktree.",
            });
          }
          const settings = yield* settingsService.getSettings.pipe(
            Effect.orElseSucceed(() => null),
          );
          const branchToken = (yield* randomUUID).replace(/-/g, "");
          const worktree = yield* prepareThreadWorktree({
            gitWorkflow,
            projectCwd: workspaceRoot,
            baseBranch: status.refName,
            branch: buildTemporaryWorktreeBranchName(() => branchToken),
            startFromOrigin: settings?.newWorktreesStartFromOrigin ?? false,
          });
          yield* orchestrationEngine.dispatch({
            type: "thread.meta.update",
            commandId: CommandId.make(`server:automation-worktree:${yield* randomUUID}`),
            threadId,
            branch: worktree.refName,
            worktreePath: worktree.path,
          });
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`server:automation:${yield* randomUUID}`),
          threadId,
          message: {
            messageId: MessageId.make(yield* randomUUID),
            role: "user",
            text: automation.prompt,
            attachments: [],
          },
          modelSelection,
          titleSeed: automationThreadTitle(automation),
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt,
        });
      });

      const started = yield* startProgram.pipe(
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.logWarning("automation could not start its turn", {
            automationId: automation.id,
            cause: Cause.pretty(cause),
          }).pipe(Effect.andThen(deleteCreatedThread), Effect.as(false)),
        ),
      );

      return yield* recordRun({
        automation,
        outcome: started ? "started" : "failed",
        threadId: started ? threadId : null,
        detail: started ? null : "The turn could not be started.",
      });
    });

  const runNow: AutomationServiceShape["runNow"] = Effect.fn("runNow")(function* (
    id: AutomationId,
  ) {
    const existing = yield* store.get(id);
    if (Option.isNone(existing)) {
      return yield* new AutomationError({
        reason: "notFound",
        detail: "That automation no longer exists.",
      });
    }
    const automation = existing.value;
    const run = yield* fire(automation);
    const nowMs = yield* Clock.currentTimeMillis;
    const lastRunAt = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
    // A manual run counts as a run: it re-anchors an interval schedule, which
    // is what "run it now, then keep going from here" should mean. Failure
    // evidence is folded in here so a play-button rerun cannot wipe a streak
    // unless the turn actually started and the row is still enabled.
    const withOutcome = applyAutomationRunOutcome({
      automation: { ...automation, lastRunAt },
      outcome: run.outcome,
      nowIso: lastRunAt,
    });
    yield* store.upsert(reschedule(withOutcome, nowMs));
    return run;
  });

  const listRuns: AutomationServiceShape["listRuns"] = (input) => store.listRuns(input);

  const tick = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const due = yield* store.listDue(DateTime.formatIso(DateTime.makeUnsafe(nowMs)));
    for (const automation of due) {
      const dueMs = automation.nextRunAt === null ? null : Date.parse(automation.nextRunAt);

      if (isStale({ nextRunAtMs: dueMs, nowMs })) {
        // The machine was off, or asleep, long past the point where this run
        // is still the thing the user wanted. Advance without firing, and log
        // it so the history explains the gap rather than showing nothing.
        yield* recordRun({
          automation,
          outcome: "skipped",
          threadId: null,
          detail: "Missed while the machine was unavailable.",
        });
        yield* store.upsert(
          reschedule(
            {
              ...automation,
              lastRunAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
            },
            nowMs,
          ),
        );
        continue;
      }

      if (!shouldFireNow({ nextRunAtMs: dueMs, nowMs })) continue;

      const run = yield* fire(automation);
      const lastRunAt = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
      const withOutcome = applyAutomationRunOutcome({
        automation: { ...automation, lastRunAt },
        outcome: run.outcome,
        nowIso: lastRunAt,
      });
      // A one-shot is done after it is attempted, unless the failure policy
      // already paused it — that reason must stay visible.
      const fired: Automation =
        automation.schedule._tag === "once" && withOutcome.enabled
          ? {
              ...withOutcome,
              enabled: false,
              nextRunAt: null,
              disabledReason: "schedule",
              disabledAt: lastRunAt,
            }
          : withOutcome;
      yield* store.upsert(reschedule(fired, nowMs));
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("automation tick failed", { cause: Cause.pretty(cause) }),
    ),
  );

  return AutomationService.of({ list, create, update, remove, runNow, listRuns, tick });
});

export const layer = Layer.effect(AutomationService, make);

/** Inert service, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  AutomationService,
  AutomationService.of({
    list: () => Effect.succeed([]),
    create: () =>
      Effect.fail(new AutomationError({ reason: "writeFailed", detail: "Not available." })),
    update: () =>
      Effect.fail(new AutomationError({ reason: "notFound", detail: "Not available." })),
    remove: () => Effect.succeed(false),
    runNow: () =>
      Effect.fail(new AutomationError({ reason: "notFound", detail: "Not available." })),
    listRuns: () => Effect.succeed([]),
    tick: Effect.void,
  }),
);

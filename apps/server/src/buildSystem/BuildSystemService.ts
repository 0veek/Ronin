/**
 * BuildSystemService - the rules around a team of models.
 *
 * The store is just rows. This is the part that decides whether a roster is
 * valid, opens the threads a run lives in, and turns an orchestrator's last
 * fenced block into the next turn. Firing still goes through the ordinary
 * engine — create, prepare, start — so the sidebar, checkpoints and diffs
 * treat every role as a normal thread.
 *
 * @module BuildSystemService
 */
import {
  BUILD_SYSTEM_MAX_CONSECUTIVE_NUDGES,
  BUILD_SYSTEM_MAX_TEAMMATES,
  BuildSystem,
  BuildSystemError,
  BuildSystemId,
  type BuildSystemCreateInput,
  type BuildSystemOrchestrator,
  type BuildSystemRole,
  BuildSystemRoleId,
  type BuildSystemRoleInput,
  BuildSystemRun,
  BuildSystemRunId,
  type BuildSystemRunPending,
  type BuildSystemRunStatus,
  BuildSystemRunStep,
  BuildSystemRunStepId,
  type BuildSystemRunStepKind,
  type BuildSystemUpdateInput,
  CommandId,
  DEFAULT_BUILD_SYSTEM_MAX_DELEGATIONS,
  duplicateBuildSystemRoleNames,
  findBuildSystemRole,
  isBuildSystemRunActive,
  MessageId,
  type ModelSelection,
  type OrchestrationCheckpointFile,
  type OrchestrationSessionStatus,
  type ProjectId,
  ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { prepareThreadWorktree } from "../git/prepareThreadWorktree.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../serverSettings.ts";
import { BuildSystemStore } from "./BuildSystemStore.ts";
import { describeDirectiveFailure, parseBuildSystemDirective } from "./directive.ts";
import {
  buildSystemRoleThreadTitle,
  buildSystemThreadTitle,
  type ChangedFileSummary,
  renderDelegationBrief,
  renderDirectiveNudge,
  renderGateDenial,
  renderOrchestratorPreamble,
  renderTeammateFailure,
  renderTeammateReport,
  renderUserReply,
} from "./messages.ts";

export interface BuildSystemServiceShape {
  readonly list: (projectId: ProjectId | null) => Effect.Effect<ReadonlyArray<BuildSystem>>;
  readonly create: (input: BuildSystemCreateInput) => Effect.Effect<BuildSystem, BuildSystemError>;
  readonly update: (input: BuildSystemUpdateInput) => Effect.Effect<BuildSystem, BuildSystemError>;
  readonly remove: (id: BuildSystemId) => Effect.Effect<boolean, BuildSystemError>;
  readonly startRun: (input: {
    readonly buildSystemId: BuildSystemId;
    readonly task: string;
  }) => Effect.Effect<BuildSystemRun, BuildSystemError>;
  readonly cancelRun: (runId: BuildSystemRunId) => Effect.Effect<BuildSystemRun, BuildSystemError>;
  readonly resolveGate: (input: {
    readonly runId: BuildSystemRunId;
    readonly approved: boolean;
    readonly note: string | null;
  }) => Effect.Effect<BuildSystemRun, BuildSystemError>;
  readonly replyUser: (input: {
    readonly runId: BuildSystemRunId;
    readonly reply: string;
  }) => Effect.Effect<BuildSystemRun, BuildSystemError>;
  readonly listRuns: (input: {
    readonly buildSystemId: BuildSystemId | null;
    readonly projectId: ProjectId | null;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<BuildSystemRun>>;
  readonly getRun: (
    runId: BuildSystemRunId,
  ) => Effect.Effect<
    { readonly run: BuildSystemRun | null; readonly steps: ReadonlyArray<BuildSystemRunStep> },
    never
  >;
  /**
   * A turn on a run thread finished and its checkpoint exists.
   *
   * Called from the reactor on `thread.turn-diff-completed`. The files come
   * from that event so the orchestrator can be shown what changed without a
   * second diff query.
   */
  readonly handleTurnSettled: (input: {
    readonly threadId: ThreadId;
    /** The turn the checkpoint belongs to; null when recovery replays one. */
    readonly turnId: TurnId | null;
    readonly files: ReadonlyArray<OrchestrationCheckpointFile>;
    readonly assistantMessageId: string | null;
  }) => Effect.Effect<void>;
  /**
   * A run thread's session landed on an error or an interrupt.
   *
   * Success is handled by {@link handleTurnSettled}. This path is only the
   * ones that never produced a usable reply.
   */
  readonly handleSessionSet: (input: {
    readonly threadId: ThreadId;
    readonly status: OrchestrationSessionStatus;
    readonly lastError: string | null;
  }) => Effect.Effect<void>;
  /**
   * Pick up runs that were live when the process last died.
   *
   * A turn that finished while we were down is advanced. A turn that is still
   * running is failed — nobody is watching it any more, and restarting a
   * mid-flight provider session from here would lie about who is in charge.
   */
  readonly recover: Effect.Effect<void>;
}

export class BuildSystemService extends Context.Service<
  BuildSystemService,
  BuildSystemServiceShape
>()("t3/buildSystem/BuildSystemService") {}

const notFound = (detail: string) => new BuildSystemError({ reason: "notFound", detail });
const runNotFound = (detail: string) => new BuildSystemError({ reason: "runNotFound", detail });
const invalid = (detail: string) => new BuildSystemError({ reason: "invalid", detail });

function lastAssistantText(
  messages: ReadonlyArray<{ readonly id: string; readonly role: string; readonly text: string }>,
  assistantMessageId: string | null,
): string {
  if (assistantMessageId !== null) {
    const named = messages.find((message) => message.id === assistantMessageId);
    if (named !== undefined && named.role === "assistant" && named.text.trim().length > 0) {
      return named.text;
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === "assistant" && message.text.trim().length > 0) {
      return message.text;
    }
  }
  return "";
}

function toChangedFiles(
  files: ReadonlyArray<OrchestrationCheckpointFile>,
): ReadonlyArray<ChangedFileSummary> {
  return files.map((file) => ({
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
  }));
}

/** The most recent step of a kind, whatever was recorded after it. */
function lastStepOfKind(
  steps: ReadonlyArray<BuildSystemRunStep>,
  kind: BuildSystemRunStepKind,
): BuildSystemRunStep | null {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.kind === kind) return step;
  }
  return null;
}

function consecutiveStepCount(
  steps: ReadonlyArray<BuildSystemRunStep>,
  kind: BuildSystemRunStepKind,
): number {
  let count = 0;
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index]?.kind !== kind) break;
    count += 1;
  }
  return count;
}

function mintRole(role: BuildSystemRoleInput, id: string): BuildSystemRole {
  return {
    id: role.id ?? BuildSystemRoleId.make(id),
    name: role.name,
    instructions: role.instructions ?? null,
    modelSelection: role.modelSelection,
    gate: role.gate ?? false,
  };
}

function mintOrchestrator(input: {
  readonly modelSelection: ModelSelection;
  readonly instructions?: string | null | undefined;
}): BuildSystemOrchestrator {
  return {
    modelSelection: input.modelSelection,
    instructions: input.instructions ?? null,
  };
}

export const make = Effect.gen(function* () {
  const store = yield* BuildSystemStore;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const randomUUID = crypto.randomUUIDv4.pipe(Effect.orDie);
  const lock = yield* Semaphore.make(1);
  /**
   * Runs this process has already advanced. Recovery must not fail a teammate
   * turn that we ourselves just started after picking up a settled orchestrator
   * turn from the previous life.
   */
  const touchedThisProcess = new Set<string>();
  /**
   * The user message this process minted for the turn it is waiting on, by
   * thread. A run thread is an ordinary thread, so a person can type into one
   * while the team is working; without this, the reply to *their* message would
   * be read as the team's next directive. Empty after a restart, where a
   * settled turn is accepted as it always was.
   */
  const awaitedUserMessage = new Map<ThreadId, MessageId>();

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const withLock = <A, E, R>(effect: Effect.Effect<A, E, R>) => lock.withPermits(1)(effect);

  /**
   * The thread whose turn the run is waiting on.
   *
   * While delegating this is the thread of the last delegation, not the last
   * entry in `roleThreads`: a role keeps its thread for the whole run, so
   * delegating to an earlier teammate again does not move it to the end of
   * that list.
   */
  const awaitedThreadId = (run: BuildSystemRun) =>
    Effect.gen(function* () {
      if (run.status === "delegating") {
        const delegation = lastStepOfKind(yield* store.listSteps(run.id), "delegation");
        return delegation?.threadId ?? run.roleThreads.at(-1)?.threadId ?? null;
      }
      if (run.status === "orchestrating" || run.status === "starting") {
        return run.orchestratorThreadId;
      }
      return null;
    });

  /**
   * Whether the turn that just settled is the one this coordinator started.
   *
   * The user message we minted carries the turn it opened, so a reply to
   * something a person typed into the thread mid-run is recognisable and left
   * alone. Anything we cannot tell apart — no expectation after a restart, no
   * turn on either side — counts as ours: stalling a run is worse than acting
   * on one turn too many.
   */
  const startedByUs = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly messages: ReadonlyArray<{ readonly id: string; readonly turnId: string | null }>;
  }) => {
    const expected = awaitedUserMessage.get(input.threadId);
    if (expected === undefined || input.turnId === null) return true;
    const ours = input.messages.find((message) => message.id === expected);
    if (ours === undefined || ours.turnId === null) return true;
    return ours.turnId === input.turnId;
  };

  const forgetAwaitedTurns = (run: BuildSystemRun) => {
    if (run.orchestratorThreadId !== null) awaitedUserMessage.delete(run.orchestratorThreadId);
    for (const entry of run.roleThreads) awaitedUserMessage.delete(entry.threadId);
  };

  const requireProject = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const snapshot = yield* snapshotQuery.getSnapshot().pipe(Effect.orElseSucceed(() => null));
      if (snapshot === null) return;
      if (!snapshot.projects.some((project) => project.id === projectId)) {
        return yield* new BuildSystemError({
          reason: "projectNotFound",
          detail: "That project no longer exists.",
        });
      }
    });

  const validateRoster = (teammates: ReadonlyArray<{ readonly name: string }>) => {
    if (teammates.length > BUILD_SYSTEM_MAX_TEAMMATES) {
      return invalid(`A team can have at most ${String(BUILD_SYSTEM_MAX_TEAMMATES)} teammates.`);
    }
    const duplicates = duplicateBuildSystemRoleNames(teammates);
    if (duplicates.length > 0) {
      return invalid(
        `Two teammates cannot share a name (${duplicates.join(", ")}). The orchestrator delegates by name.`,
      );
    }
    return null;
  };

  const list = (projectId: ProjectId | null) => store.list(projectId);

  const create: BuildSystemServiceShape["create"] = Effect.fn("create")(function* (
    input: BuildSystemCreateInput,
  ) {
    yield* requireProject(input.projectId);
    const rosterError = validateRoster(input.teammates);
    if (rosterError !== null) return yield* rosterError;
    const createdAt = yield* nowIso;
    const teammates: Array<BuildSystemRole> = [];
    for (const role of input.teammates) {
      teammates.push(mintRole(role, yield* randomUUID));
    }
    const buildSystem: BuildSystem = {
      id: BuildSystemId.make(yield* randomUUID),
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      orchestrator: mintOrchestrator(input.orchestrator),
      teammates,
      maxDelegations: input.maxDelegations ?? DEFAULT_BUILD_SYSTEM_MAX_DELEGATIONS,
      createdAt,
      updatedAt: createdAt,
    };
    yield* store.upsert(buildSystem);
    return buildSystem;
  });

  const update: BuildSystemServiceShape["update"] = Effect.fn("update")(function* (
    input: BuildSystemUpdateInput,
  ) {
    const existing = yield* store.get(input.id);
    if (Option.isNone(existing)) {
      return yield* notFound("That build system no longer exists.");
    }
    let teammates = existing.value.teammates;
    if (input.teammates !== undefined) {
      const rosterError = validateRoster(input.teammates);
      if (rosterError !== null) return yield* rosterError;
      const minted: Array<BuildSystemRole> = [];
      for (const role of input.teammates) {
        minted.push(mintRole(role, yield* randomUUID));
      }
      teammates = minted;
    }
    const updatedAt = yield* nowIso;
    const buildSystem: BuildSystem = {
      ...existing.value,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.orchestrator === undefined
        ? {}
        : { orchestrator: mintOrchestrator(input.orchestrator) }),
      teammates,
      ...(input.maxDelegations === undefined ? {} : { maxDelegations: input.maxDelegations }),
      updatedAt,
    };
    yield* store.upsert(buildSystem);
    return buildSystem;
  });

  const remove = (id: BuildSystemId) =>
    Effect.gen(function* () {
      const active = (yield* store.listActiveRuns()).some((run) => run.buildSystemId === id);
      if (active) {
        return yield* new BuildSystemError({
          reason: "runInProgress",
          detail: "Cancel this team's running work before deleting it.",
        });
      }
      return yield* store.remove(id);
    });

  const recordStep = (input: {
    readonly run: BuildSystemRun;
    readonly kind: BuildSystemRunStepKind;
    readonly roleId?: BuildSystemRole["id"] | null;
    readonly roleName?: string | null;
    readonly threadId?: ThreadId | null;
    readonly detail?: string | null;
  }) =>
    Effect.gen(function* () {
      const sequence = yield* store.nextStepSequence(input.run.id);
      const step: BuildSystemRunStep = {
        id: BuildSystemRunStepId.make(yield* randomUUID),
        runId: input.run.id,
        sequence,
        kind: input.kind,
        roleId: input.roleId ?? null,
        roleName: input.roleName ?? null,
        threadId: input.threadId ?? null,
        detail: input.detail ?? null,
        at: yield* nowIso,
      };
      yield* store.appendStep(step);
      return step;
    });

  const saveRun = (run: BuildSystemRun, patch: Partial<BuildSystemRun>) =>
    Effect.gen(function* () {
      const next: BuildSystemRun = {
        ...run,
        ...patch,
        updatedAt: yield* nowIso,
      };
      yield* store.upsertRun(next);
      touchedThisProcess.add(next.id);
      return next;
    });

  const settleRun = (
    run: BuildSystemRun,
    status: Extract<BuildSystemRunStatus, "completed" | "failed" | "cancelled">,
    extra: Partial<BuildSystemRun> = {},
  ) =>
    nowIso.pipe(
      Effect.flatMap((settledAt) =>
        saveRun(run, {
          status,
          pending: null,
          settledAt,
          ...extra,
        }),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          forgetAwaitedTurns(run);
        }),
      ),
    );

  const asWriteFailed =
    (detail: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, BuildSystemError, R> =>
      effect.pipe(
        Effect.catchCause((cause) => {
          const squashed = Cause.squash(cause);
          if (Schema.is(BuildSystemError)(squashed)) {
            return Effect.fail(squashed);
          }
          return Effect.fail(
            new BuildSystemError({ reason: "writeFailed", detail, cause: squashed }),
          );
        }),
      );

  const requireActiveRun = (runId: BuildSystemRunId) =>
    Effect.gen(function* () {
      const existing = yield* store.getRun(runId);
      if (Option.isNone(existing)) {
        return yield* runNotFound("That run no longer exists.");
      }
      if (!isBuildSystemRunActive(existing.value.status)) {
        return yield* new BuildSystemError({
          reason: "runNotActive",
          detail: "That run has already finished.",
        });
      }
      return existing.value;
    });

  const startTurn = (input: {
    readonly threadId: ThreadId;
    readonly modelSelection: ModelSelection;
    readonly text: string;
    readonly titleSeed?: string;
  }) =>
    Effect.gen(function* () {
      const commandToken = yield* randomUUID;
      const messageId = MessageId.make(yield* randomUUID);
      const createdAt = yield* nowIso;
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`server:build-system:${commandToken}`),
        threadId: input.threadId,
        message: {
          messageId,
          role: "user",
          text: input.text,
          attachments: [],
        },
        modelSelection: input.modelSelection,
        ...(input.titleSeed === undefined ? {} : { titleSeed: input.titleSeed }),
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt,
      });
      awaitedUserMessage.set(input.threadId, messageId);
    });

  const interruptThread = (threadId: ThreadId) =>
    Effect.all([randomUUID, nowIso], { concurrency: 1 }).pipe(
      Effect.flatMap(([commandToken, createdAt]) =>
        orchestrationEngine.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.make(`server:build-system-interrupt:${commandToken}`),
          threadId,
          createdAt,
        }),
      ),
      Effect.ignoreCause({ log: true }),
    );

  const deleteThread = (threadId: ThreadId) =>
    randomUUID.pipe(
      Effect.flatMap((commandToken) =>
        orchestrationEngine.dispatch({
          type: "thread.delete",
          commandId: CommandId.make(`server:build-system-cleanup:${commandToken}`),
          threadId,
        }),
      ),
      Effect.ignoreCause({ log: true }),
    );

  const createThread = (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
    readonly title: string;
    readonly modelSelection: ModelSelection;
    readonly branch: string | null;
    readonly worktreePath: string | null;
  }) =>
    Effect.all([randomUUID, nowIso], { concurrency: 1 }).pipe(
      Effect.flatMap(([commandToken, createdAt]) =>
        orchestrationEngine.dispatch({
          type: "thread.create",
          commandId: CommandId.make(`server:build-system-create:${commandToken}`),
          threadId: input.threadId,
          projectId: input.projectId,
          title: input.title,
          modelSelection: input.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: input.branch,
          worktreePath: input.worktreePath,
          createdAt,
        }),
      ),
    );

  const prepareOrchestratorWorktree = (input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot: string;
  }) =>
    Effect.gen(function* () {
      const status = yield* gitWorkflow.localStatus({ cwd: input.workspaceRoot });
      if (!status.isRepo || status.refName === null) {
        return { branch: null as string | null, worktreePath: null as string | null };
      }
      const settings = yield* settingsService.getSettings.pipe(Effect.orElseSucceed(() => null));
      const branchToken = (yield* randomUUID).replace(/-/g, "");
      const worktree = yield* prepareThreadWorktree({
        gitWorkflow,
        projectCwd: input.workspaceRoot,
        baseBranch: status.refName,
        branch: buildTemporaryWorktreeBranchName(() => branchToken),
        startFromOrigin: settings?.newWorktreesStartFromOrigin ?? false,
      });
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make(`server:build-system-worktree:${yield* randomUUID}`),
        threadId: input.threadId,
        branch: worktree.refName,
        worktreePath: worktree.path,
      });
      return { branch: worktree.refName, worktreePath: worktree.path };
    });

  const orchestratorWorkspace = (run: BuildSystemRun) =>
    Effect.gen(function* () {
      if (run.orchestratorThreadId === null) {
        return { branch: null as string | null, worktreePath: null as string | null };
      }
      const shell = yield* snapshotQuery
        .getThreadShellById(run.orchestratorThreadId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(shell)) {
        return { branch: null, worktreePath: null };
      }
      return { branch: shell.value.branch, worktreePath: shell.value.worktreePath };
    });

  const ensureRoleThread = (run: BuildSystemRun, role: BuildSystemRole) =>
    Effect.gen(function* () {
      const existing = run.roleThreads.find((entry) => entry.roleId === role.id);
      if (existing !== undefined) {
        return { run, threadId: existing.threadId, isFirst: false };
      }
      const workspace = yield* orchestratorWorkspace(run);
      const threadId = ThreadId.make(yield* randomUUID);
      yield* createThread({
        threadId,
        projectId: run.projectId,
        title: buildSystemRoleThreadTitle({
          buildSystemName: run.config.name,
          roleName: role.name,
        }),
        modelSelection: role.modelSelection,
        branch: workspace.branch,
        worktreePath: workspace.worktreePath,
      });
      const next = yield* saveRun(run, {
        roleThreads: [...run.roleThreads, { roleId: role.id, threadId }],
      });
      return { run: next, threadId, isFirst: true };
    });

  const beginDelegation = (input: {
    readonly run: BuildSystemRun;
    readonly role: BuildSystemRole;
    readonly task: string;
    readonly context: string | null;
  }) =>
    Effect.gen(function* () {
      if (input.run.delegationCount >= input.run.config.maxDelegations) {
        yield* recordStep({
          run: input.run,
          kind: "failed",
          detail: `Stopped after ${String(input.run.config.maxDelegations)} delegations.`,
        });
        return yield* settleRun(input.run, "failed", {
          failureDetail: `Stopped after ${String(input.run.config.maxDelegations)} delegations.`,
        });
      }
      const ensured = yield* ensureRoleThread(input.run, input.role);
      yield* startTurn({
        threadId: ensured.threadId,
        modelSelection: input.role.modelSelection,
        text: renderDelegationBrief({
          role: input.role,
          buildSystemName: input.run.config.name,
          task: input.task,
          context: input.context,
          isFirstDelegation: ensured.isFirst,
        }),
        titleSeed: buildSystemRoleThreadTitle({
          buildSystemName: input.run.config.name,
          roleName: input.role.name,
        }),
      });
      const next = yield* saveRun(ensured.run, {
        status: "delegating",
        pending: null,
        delegationCount: ensured.run.delegationCount + 1,
      });
      yield* recordStep({
        run: next,
        kind: "delegation",
        roleId: input.role.id,
        roleName: input.role.name,
        threadId: ensured.threadId,
        detail: input.task,
      });
      return next;
    });

  const startOrchestratorTurn = (run: BuildSystemRun, text: string) =>
    Effect.gen(function* () {
      if (run.orchestratorThreadId === null) {
        yield* recordStep({
          run,
          kind: "failed",
          detail: "The orchestrator thread is gone.",
        });
        return yield* settleRun(run, "failed", {
          failureDetail: "The orchestrator thread is gone.",
        });
      }
      yield* startTurn({
        threadId: run.orchestratorThreadId,
        modelSelection: run.config.orchestrator.modelSelection,
        text,
        titleSeed: buildSystemThreadTitle(run.config),
      });
      return yield* saveRun(run, { status: "orchestrating", pending: null });
    });

  const nudgeOrchestrator = (run: BuildSystemRun, failureDescription: string) =>
    Effect.gen(function* () {
      const steps = yield* store.listSteps(run.id);
      const used = consecutiveStepCount(steps, "nudge") + 1;
      if (used > BUILD_SYSTEM_MAX_CONSECUTIVE_NUDGES) {
        const detail = "The orchestrator did not produce a usable directive.";
        yield* recordStep({ run, kind: "failed", detail });
        return yield* settleRun(run, "failed", { failureDetail: detail });
      }
      yield* recordStep({ run, kind: "nudge", detail: failureDescription });
      return yield* startOrchestratorTurn(
        run,
        renderDirectiveNudge({
          failureDescription,
          attemptsRemaining: BUILD_SYSTEM_MAX_CONSECUTIVE_NUDGES - used + 1,
        }),
      );
    });

  const actOnDirective = (run: BuildSystemRun, message: string) =>
    Effect.gen(function* () {
      const parsed = parseBuildSystemDirective(message);
      if (!parsed.ok) {
        return yield* nudgeOrchestrator(run, describeDirectiveFailure(parsed.failure));
      }
      const directive = parsed.directive;
      if (directive.action === "done") {
        yield* recordStep({ run, kind: "completed", detail: directive.summary });
        return yield* settleRun(run, "completed", { summary: directive.summary });
      }
      if (directive.action === "ask_user") {
        const pending: BuildSystemRunPending = {
          _tag: "question",
          question: directive.question,
        };
        const next = yield* saveRun(run, { status: "waiting-user", pending });
        yield* recordStep({ run: next, kind: "question", detail: directive.question });
        return next;
      }
      const role = findBuildSystemRole(run.config.teammates, directive.role);
      if (role === null) {
        return yield* nudgeOrchestrator(
          run,
          `There is no teammate named "${directive.role}". Use one of the names from the roster.`,
        );
      }
      if (role.gate) {
        const pending: BuildSystemRunPending = {
          _tag: "gate",
          roleId: role.id,
          roleName: role.name,
          task: directive.task,
          context: directive.context,
        };
        return yield* saveRun(run, { status: "waiting-gate", pending });
      }
      return yield* beginDelegation({
        run,
        role,
        task: directive.task,
        context: directive.context,
      });
    });

  const readThreadMessages = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const detail = yield* snapshotQuery
        .getThreadDetailById(threadId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(detail)) return [];
      return detail.value.messages;
    });

  const handleOrchestratorSettled = (
    run: BuildSystemRun,
    messages: ReadonlyArray<{ readonly id: string; readonly role: string; readonly text: string }>,
    assistantMessageId: string | null,
  ) =>
    Effect.gen(function* () {
      if (run.orchestratorThreadId === null) return run;
      return yield* actOnDirective(run, lastAssistantText(messages, assistantMessageId));
    });

  const handleTeammateSettled = (
    run: BuildSystemRun,
    threadId: ThreadId,
    messages: ReadonlyArray<{ readonly id: string; readonly role: string; readonly text: string }>,
    files: ReadonlyArray<OrchestrationCheckpointFile>,
    assistantMessageId: string | null,
  ) =>
    Effect.gen(function* () {
      const roleEntry = run.roleThreads.find((entry) => entry.threadId === threadId);
      const role =
        roleEntry === undefined
          ? null
          : (run.config.teammates.find((teammate) => teammate.id === roleEntry.roleId) ?? null);
      const roleName = role?.name ?? "teammate";
      const report = lastAssistantText(messages, assistantMessageId).trim();
      yield* recordStep({
        run,
        kind: "report",
        roleId: role?.id ?? null,
        roleName,
        threadId,
        detail: report.length === 0 ? "Finished without a written report." : report,
      });
      return yield* startOrchestratorTurn(
        run,
        renderTeammateReport({
          roleName,
          report: report.length === 0 ? "(no written report)" : report,
          changedFiles: toChangedFiles(files),
          delegationsRemaining: Math.max(0, run.config.maxDelegations - run.delegationCount),
        }),
      );
    });

  const handleTurnSettledUnlocked = (input: {
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly files: ReadonlyArray<OrchestrationCheckpointFile>;
    readonly assistantMessageId: string | null;
  }) =>
    Effect.gen(function* () {
      const found = yield* store.findActiveRunForThread(input.threadId);
      if (Option.isNone(found)) return;
      const run = found.value;
      const expected = yield* awaitedThreadId(run);
      if (expected !== input.threadId) return;
      const messages = yield* readThreadMessages(input.threadId);
      if (!startedByUs({ threadId: input.threadId, turnId: input.turnId, messages })) return;
      if (run.status === "orchestrating" || run.status === "starting") {
        yield* handleOrchestratorSettled(run, messages, input.assistantMessageId);
        return;
      }
      if (run.status === "delegating") {
        yield* handleTeammateSettled(
          run,
          input.threadId,
          messages,
          input.files,
          input.assistantMessageId,
        );
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("build system failed to advance a settled turn", {
          threadId: input.threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const handleSessionSetUnlocked = (input: {
    readonly threadId: ThreadId;
    readonly status: OrchestrationSessionStatus;
    readonly lastError: string | null;
  }) =>
    Effect.gen(function* () {
      if (input.status !== "error" && input.status !== "interrupted") return;
      const found = yield* store.findActiveRunForThread(input.threadId);
      if (Option.isNone(found)) return;
      const run = found.value;
      const expected = yield* awaitedThreadId(run);
      if (expected !== input.threadId) return;

      const detail =
        input.lastError?.trim() ||
        (input.status === "interrupted" ? "The turn was interrupted." : "The turn failed.");

      if (run.status === "delegating") {
        const roleEntry = run.roleThreads.find((entry) => entry.threadId === input.threadId);
        const roleName =
          roleEntry === undefined
            ? "teammate"
            : (run.config.teammates.find((teammate) => teammate.id === roleEntry.roleId)?.name ??
              "teammate");
        const steps = yield* store.listSteps(run.id);
        // A teammate failure is reported once. A second one in a row, with no
        // successful report between, means the team cannot make progress.
        const lastReport = lastStepOfKind(steps, "report");
        if (lastReport?.detail?.startsWith("Turn failed:") === true) {
          yield* recordStep({ run, kind: "failed", detail });
          yield* settleRun(run, "failed", { failureDetail: detail });
          return;
        }
        yield* recordStep({
          run,
          kind: "report",
          roleId: roleEntry?.roleId ?? null,
          roleName,
          threadId: input.threadId,
          detail: `Turn failed: ${detail}`,
        });
        yield* startOrchestratorTurn(run, renderTeammateFailure({ roleName, detail }));
        return;
      }

      if (run.status === "orchestrating" || run.status === "starting") {
        const steps = yield* store.listSteps(run.id);
        const last = steps.at(-1);
        if (last?.kind === "nudge" && last.detail?.startsWith("The previous turn failed")) {
          yield* recordStep({ run, kind: "failed", detail });
          yield* settleRun(run, "failed", { failureDetail: detail });
          return;
        }
        yield* nudgeOrchestrator(run, `The previous turn failed: ${detail}`);
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("build system failed to handle a session error", {
          threadId: input.threadId,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const startRunUnlocked = (input: { buildSystemId: BuildSystemId; task: string }) =>
    Effect.gen(function* () {
      const existing = yield* store.get(input.buildSystemId);
      if (Option.isNone(existing)) {
        return yield* notFound("That build system no longer exists.");
      }
      const buildSystem = existing.value;
      yield* requireProject(buildSystem.projectId);

      const project = yield* snapshotQuery
        .getProjectShellById(buildSystem.projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(project)) {
        return yield* new BuildSystemError({
          reason: "projectNotFound",
          detail: "That project no longer exists.",
        });
      }

      const startedAt = yield* nowIso;
      const runId = BuildSystemRunId.make(yield* randomUUID);
      const threadId = ThreadId.make(yield* randomUUID);
      let run: BuildSystemRun = {
        id: runId,
        buildSystemId: buildSystem.id,
        projectId: buildSystem.projectId,
        config: buildSystem,
        task: input.task,
        orchestratorThreadId: null,
        roleThreads: [],
        status: "starting",
        pending: null,
        delegationCount: 0,
        summary: null,
        failureDetail: null,
        startedAt,
        updatedAt: startedAt,
        settledAt: null,
      };
      yield* store.upsertRun(run);

      const started = yield* Effect.gen(function* () {
        yield* createThread({
          threadId,
          projectId: buildSystem.projectId,
          title: buildSystemThreadTitle(buildSystem),
          modelSelection: buildSystem.orchestrator.modelSelection,
          branch: null,
          worktreePath: null,
        });
        run = yield* saveRun(run, { orchestratorThreadId: threadId });
        yield* prepareOrchestratorWorktree({
          threadId,
          workspaceRoot: project.value.workspaceRoot,
        });
        yield* startTurn({
          threadId,
          modelSelection: buildSystem.orchestrator.modelSelection,
          text: renderOrchestratorPreamble({ buildSystem, task: input.task }),
          titleSeed: buildSystemThreadTitle(buildSystem),
        });
        return true;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("build system could not start its orchestrator", {
            buildSystemId: buildSystem.id,
            cause: Cause.pretty(cause),
          }).pipe(Effect.andThen(deleteThread(threadId)), Effect.as(false)),
        ),
      );

      if (!started) {
        yield* recordStep({
          run,
          kind: "failed",
          detail: "The orchestrator turn could not be started.",
        });
        return yield* settleRun(run, "failed", {
          orchestratorThreadId: null,
          failureDetail: "The orchestrator turn could not be started.",
        });
      }
      return yield* saveRun(run, { status: "orchestrating", orchestratorThreadId: threadId });
    });

  const cancelRunUnlocked = (runId: BuildSystemRunId) =>
    Effect.gen(function* () {
      const run = yield* requireActiveRun(runId);
      const activeThread = yield* awaitedThreadId(run);
      if (
        activeThread !== null &&
        (run.status === "orchestrating" || run.status === "delegating")
      ) {
        yield* interruptThread(activeThread);
      }
      yield* recordStep({ run, kind: "cancelled", detail: "Cancelled by the user." });
      return yield* settleRun(run, "cancelled");
    });

  const resolveGateUnlocked = (input: {
    runId: BuildSystemRunId;
    approved: boolean;
    note: string | null;
  }) =>
    Effect.gen(function* () {
      const run = yield* requireActiveRun(input.runId);
      if (run.status !== "waiting-gate" || run.pending?._tag !== "gate") {
        return yield* invalid("This run is not waiting on an approval.");
      }
      const pending = run.pending;
      const role = run.config.teammates.find((teammate) => teammate.id === pending.roleId);
      if (role === undefined) {
        return yield* invalid("That role is no longer on this team.");
      }
      if (input.approved) {
        yield* recordStep({
          run,
          kind: "gate-approved",
          roleId: role.id,
          roleName: role.name,
          detail: pending.task,
        });
        return yield* beginDelegation({
          run,
          role,
          task: pending.task,
          context: pending.context,
        });
      }
      yield* recordStep({
        run,
        kind: "gate-denied",
        roleId: role.id,
        roleName: role.name,
        detail: input.note,
      });
      return yield* startOrchestratorTurn(
        run,
        renderGateDenial({ roleName: role.name, note: input.note }),
      );
    });

  const replyUserUnlocked = (input: { runId: BuildSystemRunId; reply: string }) =>
    Effect.gen(function* () {
      const run = yield* requireActiveRun(input.runId);
      if (run.status !== "waiting-user" || run.pending?._tag !== "question") {
        return yield* invalid("This run is not waiting on a reply.");
      }
      yield* recordStep({ run, kind: "answer", detail: input.reply });
      return yield* startOrchestratorTurn(run, renderUserReply(input.reply));
    });

  const recoverOne = (run: BuildSystemRun) =>
    Effect.gen(function* () {
      if (touchedThisProcess.has(run.id)) return;
      if (!isBuildSystemRunActive(run.status)) return;
      if (run.status === "waiting-gate" || run.status === "waiting-user") return;

      const threadId = yield* awaitedThreadId(run);
      if (threadId === null) {
        yield* recordStep({
          run,
          kind: "failed",
          detail: "Interrupted by restart before a thread existed.",
        });
        yield* settleRun(run, "failed", {
          failureDetail: "Interrupted by restart before a thread existed.",
        });
        return;
      }

      const shell = yield* snapshotQuery
        .getThreadShellById(threadId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(shell)) {
        yield* recordStep({
          run,
          kind: "failed",
          detail: "Interrupted by restart; the awaited thread is gone.",
        });
        yield* settleRun(run, "failed", {
          failureDetail: "Interrupted by restart; the awaited thread is gone.",
        });
        return;
      }

      const status = shell.value.session?.status ?? "idle";
      if (status === "starting" || status === "running") {
        yield* recordStep({
          run,
          kind: "failed",
          detail: "Interrupted by restart.",
        });
        yield* settleRun(run, "failed", { failureDetail: "Interrupted by restart." });
        return;
      }
      if (status === "error" || status === "interrupted" || status === "stopped") {
        yield* handleSessionSetUnlocked({
          threadId,
          // A session that exited is only ever reported live, where it may just
          // be a provider closing after a healthy turn. Here the turn is over
          // and unwatched either way, so it is handled as an interrupt rather
          // than left to strand the run.
          status: status === "stopped" ? "interrupted" : status,
          lastError: shell.value.session?.lastError ?? "Interrupted by restart.",
        });
        return;
      }

      const detail = yield* snapshotQuery
        .getThreadDetailById(threadId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      const files = Option.isSome(detail) ? (detail.value.checkpoints.at(-1)?.files ?? []) : [];
      yield* handleTurnSettledUnlocked({
        threadId,
        turnId: null,
        files,
        assistantMessageId: null,
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("build system recovery failed for a run", {
          runId: run.id,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const startRun: BuildSystemServiceShape["startRun"] = Effect.fn("startRun")(function* (input: {
    readonly buildSystemId: BuildSystemId;
    readonly task: string;
  }) {
    return yield* withLock(startRunUnlocked(input)).pipe(
      asWriteFailed("The run could not be started."),
    );
  });

  const cancelRun: BuildSystemServiceShape["cancelRun"] = Effect.fn("cancelRun")(function* (
    runId: BuildSystemRunId,
  ) {
    return yield* withLock(cancelRunUnlocked(runId)).pipe(
      asWriteFailed("The run could not be cancelled."),
    );
  });

  const resolveGate: BuildSystemServiceShape["resolveGate"] = Effect.fn("resolveGate")(
    function* (input: {
      readonly runId: BuildSystemRunId;
      readonly approved: boolean;
      readonly note: string | null;
    }) {
      return yield* withLock(resolveGateUnlocked(input)).pipe(
        asWriteFailed("The approval could not be recorded."),
      );
    },
  );

  const replyUser: BuildSystemServiceShape["replyUser"] = Effect.fn("replyUser")(function* (input: {
    readonly runId: BuildSystemRunId;
    readonly reply: string;
  }) {
    return yield* withLock(replyUserUnlocked(input)).pipe(
      asWriteFailed("The reply could not be sent."),
    );
  });

  const listRuns: BuildSystemServiceShape["listRuns"] = (input) => store.listRuns(input);

  const getRun: BuildSystemServiceShape["getRun"] = (runId) =>
    Effect.gen(function* () {
      const existing = yield* store.getRun(runId);
      const steps = yield* store.listSteps(runId);
      return {
        run: Option.isNone(existing) ? null : existing.value,
        steps,
      };
    });

  const handleTurnSettled: BuildSystemServiceShape["handleTurnSettled"] = (input) =>
    withLock(handleTurnSettledUnlocked(input));

  const handleSessionSet: BuildSystemServiceShape["handleSessionSet"] = (input) =>
    withLock(handleSessionSetUnlocked(input));

  const recover = Effect.gen(function* () {
    const active = yield* store.listActiveRuns();
    for (const run of active) {
      yield* withLock(recoverOne(run));
    }
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("build system recovery scan failed", { cause: Cause.pretty(cause) }),
    ),
  );

  return BuildSystemService.of({
    list,
    create,
    update,
    remove,
    startRun,
    cancelRun,
    resolveGate,
    replyUser,
    listRuns,
    getRun,
    handleTurnSettled,
    handleSessionSet,
    recover,
  });
});

export const layer = Layer.effect(BuildSystemService, make);

/** Inert service, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  BuildSystemService,
  BuildSystemService.of({
    list: () => Effect.succeed([]),
    create: () =>
      Effect.fail(new BuildSystemError({ reason: "writeFailed", detail: "Not available." })),
    update: () =>
      Effect.fail(new BuildSystemError({ reason: "notFound", detail: "Not available." })),
    remove: () => Effect.succeed(false),
    startRun: () =>
      Effect.fail(new BuildSystemError({ reason: "notFound", detail: "Not available." })),
    cancelRun: () =>
      Effect.fail(new BuildSystemError({ reason: "runNotFound", detail: "Not available." })),
    resolveGate: () =>
      Effect.fail(new BuildSystemError({ reason: "runNotFound", detail: "Not available." })),
    replyUser: () =>
      Effect.fail(new BuildSystemError({ reason: "runNotFound", detail: "Not available." })),
    listRuns: () => Effect.succeed([]),
    getRun: () => Effect.succeed({ run: null, steps: [] }),
    handleTurnSettled: () => Effect.void,
    handleSessionSet: () => Effect.void,
    recover: Effect.void,
  }),
);

import * as NodeOS from "node:os";

import {
  type ChatAttachment,
  CommandId,
  EventId,
  type MessageId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationThread,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderDriverKind,
  type ProviderHandoffActivityPayload,
  type ProviderHandoffMode,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type ProviderSwitchActivityPayload,
  type ProjectId,
  type OrchestrationSession,
  ThreadId,
  type ProviderSession,
  type ServerProviderSkill,
  type RuntimeMode,
  type TurnId,
} from "@t3tools/contracts";
import { isTemporaryWorktreeBranch, WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";

import { resolveThreadWorkspaceCwd } from "../../checkpointing/Utils.ts";
import {
  handoffMessageHasContent,
  handoffWrapOverhead,
  renderProviderHandoffBrief,
  selectHandoffMessages,
  wrapProviderHandoffInput,
} from "../providerHandoffBrief.ts";
import {
  buildProviderHandoffChangedFiles,
  buildProviderHandoffMessages,
  buildProviderHandoffPlan,
} from "../providerHandoffContext.ts";
import { increment, orchestrationEventsProcessedTotal } from "../../observability/Metrics.ts";
import { ServerConfig } from "../../config.ts";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import {
  debugModePromptOverheadChars,
  withProviderDebugModePrompt,
} from "../../provider/DebugModeInstructions.ts";
import {
  buildInlineSkillInstructions,
  resolveInvokedSkills,
} from "../../provider/skillPromptInjection.ts";
import {
  discoverSkillsCatalog,
  filterDisabledSkills,
  mergeSkillsIntoCatalog,
} from "../../provider/skillsCatalog.ts";
import type { ProviderServiceError } from "../../provider/Errors.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import {
  ProviderService,
  type ProviderContinuationState,
} from "../../provider/Services/ProviderService.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderCommandReactor,
  type ProviderCommandReactorShape,
} from "../Services/ProviderCommandReactor.ts";
import { forkParked, ServerActivation } from "../../serverActivation.ts";
import { canReplaceThreadTitle, DEFAULT_THREAD_TITLE } from "../threadTitles.ts";
import {
  resolveSourceControlWriterModelSelection,
  ServerSettingsService,
} from "../../serverSettings.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
const isProviderAdapterRequestError = Schema.is(ProviderAdapterRequestError);
const isProviderDriverKind = Schema.is(ProviderDriverKind);

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "thread.meta-updated"
      | "thread.runtime-mode-set"
      | "thread.provider-switched"
      | "thread.turn-start-requested"
      | "thread.turn-interrupt-requested"
      | "thread.agent-stop-requested"
      | "thread.approval-response-requested"
      | "thread.user-input-response-requested"
      | "thread.session-stop-requested"
      | "thread.settled";
  }
>;

/**
 * What the provider session bound to a thread already holds when a turn starts.
 *
 * The distinction drives the handoff brief: a session that has been live all
 * along needs nothing, a session resumed from its own native cursor needs only
 * what happened while it was away, and a session started cold needs the
 * conversation reconstructed for it.
 */
type ProviderSessionContinuity =
  /** The session was already running and has followed the whole conversation. */
  | { readonly kind: "live" }
  /** Started or restarted from a cursor belonging to this continuation group. */
  | {
      readonly kind: "resumed";
      readonly continuationKey: string;
      /**
       * Last message the group is recorded as having processed, when the ledger
       * has one. Absent for a resume off a live cursor, where the session never
       * stopped following the thread in the first place.
       */
      readonly deliveredThroughMessageId?: MessageId | undefined;
    }
  /** Started with no provider-side memory of this thread. */
  | { readonly kind: "fresh" };

const PROVIDER_SWITCH_ACTIVITY_KIND = "provider.switched";
const PROVIDER_HANDOFF_ACTIVITY_KIND = "provider.handoff";

/**
 * Slack left after the envelope and the user's message are accounted for.
 * Skills are already folded into that message; this is only for the few
 * characters a provider may add around the turn.
 */
const PROVIDER_HANDOFF_BRIEF_RESERVED_CHARS = 256;

function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function mapProviderSessionStatusToOrchestrationStatus(
  status: "connecting" | "ready" | "running" | "error" | "closed",
): OrchestrationSession["status"] {
  switch (status) {
    case "connecting":
      return "starting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    default:
      return "ready";
  }
}

const turnStartKeyForEvent = (event: ProviderIntentEvent): string =>
  event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`;

const HANDLED_TURN_START_KEY_MAX = 10_000;
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30);
const SKILLS_CATALOG_CACHE_MAX = 64;
const SKILLS_CATALOG_CACHE_TTL = Duration.seconds(10);
/**
 * Continuation keys are stable for the life of an instance's configuration, and
 * a brief resolves one per distinct author in the thread. Caching them keeps a
 * handoff on a long, multi-provider thread from re-reading the registry once
 * per author on every turn.
 */
const CONTINUATION_KEY_CACHE_MAX = 64;
const CONTINUATION_KEY_CACHE_TTL = Duration.seconds(30);
const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
const MAX_REGENERATION_ATTACHMENTS = 4;
const MAX_THREAD_TITLE_CONTEXT_CHARS = 8_000;
const MAX_FIRST_USER_TITLE_CONTEXT_CHARS = 2_000;
const THREAD_TITLE_CONTEXT_TRUNCATION_MARKER = "[Earlier content truncated]\n\n";
const FIRST_USER_CONTEXT_TRUNCATION_MARKER = "\n[First user message truncated]";

type ThreadTitleMessage = {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
};

function formatThreadTitleSection(message: ThreadTitleMessage): string | undefined {
  if (message.role === "system") {
    return undefined;
  }
  const text = message.text.trim();
  const attachmentSummary = (message.attachments ?? [])
    .map((attachment) => attachment.name)
    .join(", ");
  const contents = [
    ...(text.length > 0 ? [text] : []),
    ...(attachmentSummary.length > 0 ? [`[Attachments: ${attachmentSummary}]`] : []),
  ].join("\n");
  return contents.length > 0 ? `${message.role.toUpperCase()}:\n${contents}` : undefined;
}

function limitFirstUserSection(section: string): string {
  if (section.length <= MAX_FIRST_USER_TITLE_CONTEXT_CHARS) {
    return section;
  }
  return `${section.slice(
    0,
    MAX_FIRST_USER_TITLE_CONTEXT_CHARS - FIRST_USER_CONTEXT_TRUNCATION_MARKER.length,
  )}${FIRST_USER_CONTEXT_TRUNCATION_MARKER}`;
}

function collectRecentThreadTitleContext(
  messages: ReadonlyArray<ThreadTitleMessage>,
  maxChars: number,
): {
  readonly context: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly truncated: boolean;
} {
  let context = "";
  let truncated = false;
  const retainedAttachments: Array<ChatAttachment> = [];

  for (const message of messages.toReversed()) {
    const section = formatThreadTitleSection(message);
    if (section === undefined) {
      continue;
    }

    const separator = context.length > 0 ? "\n\n" : "";
    const available = maxChars - context.length - separator.length;
    if (section.length > available) {
      if (available > 0) {
        context = `${section.slice(-available)}${separator}${context}`;
        retainedAttachments.unshift(...(message.attachments ?? []));
      }
      truncated = true;
      break;
    }
    context = `${section}${separator}${context}`;
    retainedAttachments.unshift(...(message.attachments ?? []));
  }

  return { context, attachments: retainedAttachments, truncated };
}

function formatThreadTitleContext(messages: ReadonlyArray<ThreadTitleMessage>): {
  readonly message: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
} {
  const recent = collectRecentThreadTitleContext(messages, MAX_THREAD_TITLE_CONTEXT_CHARS);
  if (!recent.truncated) {
    return {
      message: recent.context,
      attachments: recent.attachments.slice(-MAX_REGENERATION_ATTACHMENTS),
    };
  }

  const firstUserMessage = messages.find(
    (message) => message.role === "user" && formatThreadTitleSection(message),
  );
  const firstUserSection = firstUserMessage
    ? formatThreadTitleSection(firstUserMessage)
    : undefined;
  if (!firstUserMessage || !firstUserSection) {
    return {
      message: `${THREAD_TITLE_CONTEXT_TRUNCATION_MARKER}${recent.context}`,
      attachments: recent.attachments.slice(-MAX_REGENERATION_ATTACHMENTS),
    };
  }

  const pinnedSection = limitFirstUserSection(firstUserSection);
  const recentContextBudget =
    MAX_THREAD_TITLE_CONTEXT_CHARS -
    pinnedSection.length -
    "\n\n".length -
    THREAD_TITLE_CONTEXT_TRUNCATION_MARKER.length;
  const retainedRecent = collectRecentThreadTitleContext(messages, recentContextBudget);
  const pinnedAttachment = firstUserMessage.attachments?.[0];
  const recentAttachments = retainedRecent.attachments.filter(
    (attachment) => attachment.id !== pinnedAttachment?.id,
  );

  return {
    message: `${pinnedSection}\n\n${THREAD_TITLE_CONTEXT_TRUNCATION_MARKER}${retainedRecent.context}`,
    attachments: [
      ...(pinnedAttachment ? [pinnedAttachment] : []),
      ...recentAttachments.slice(
        -(MAX_REGENERATION_ATTACHMENTS - (pinnedAttachment === undefined ? 0 : 1)),
      ),
    ],
  };
}

export function providerErrorLabel(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

export function providerErrorLabelFromInstanceHint(input: {
  readonly instanceId?: string | undefined;
  readonly modelSelectionInstanceId?: string | undefined;
  readonly sessionProvider?: string | undefined;
}): string {
  return providerErrorLabel(
    input.instanceId ?? input.modelSelectionInstanceId ?? input.sessionProvider,
  );
}

function findProviderAdapterRequestError(
  cause: Cause.Cause<ProviderServiceError>,
): ProviderAdapterRequestError | undefined {
  const failReason = cause.reasons.find(Cause.isFailReason);
  return isProviderAdapterRequestError(failReason?.error) ? failReason.error : undefined;
}

function isUnknownPendingApprovalRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending approval request") ||
      detail.includes("unknown pending permission request") ||
      detail.includes("unknown pending codex approval request")
    );
  }
  const message = Cause.pretty(cause).toLowerCase();
  return (
    message.includes("unknown pending approval request") ||
    message.includes("unknown pending permission request") ||
    message.includes("unknown pending codex approval request")
  );
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = findProviderAdapterRequestError(cause);
  if (error) {
    const detail = error.detail.toLowerCase();
    return (
      detail.includes("unknown pending user-input request") ||
      detail.includes("unknown pending user input request") ||
      detail.includes("unknown pending codex user input request")
    );
  }
  const message = Cause.pretty(cause).toLowerCase();
  return (
    message.includes("unknown pending user-input request") ||
    message.includes("unknown pending user input request") ||
    message.includes("unknown pending codex user input request")
  );
}

function stalePendingRequestDetail(
  requestKind: "approval" | "user-input",
  requestId: string,
): string {
  return `Stale pending ${requestKind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`;
}

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/['"`]/g, "");

  const withoutPrefix = normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)
    ? normalized.slice(`${WORKTREE_BRANCH_PREFIX}/`.length)
    : normalized;

  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  const safeFragment = branchFragment.length > 0 ? branchFragment : "update";
  return `${WORKTREE_BRANCH_PREFIX}/${safeFragment}`;
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const providerRegistry = yield* ProviderRegistry;
  const gitWorkflow = yield* GitWorkflowService;
  const fileSystem = yield* FileSystem.FileSystem;
  const vcsStatusBroadcaster = yield* VcsStatusBroadcaster;
  const textGeneration = yield* TextGeneration;
  const serverSettingsService = yield* ServerSettingsService;
  const config = yield* ServerConfig;
  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const serverEventId = () => crypto.randomUUIDv4.pipe(Effect.map(EventId.make));
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  });
  const skillsCatalogCache = yield* Cache.make<string, ReadonlyArray<ServerProviderSkill>>({
    capacity: SKILLS_CATALOG_CACHE_MAX,
    timeToLive: SKILLS_CATALOG_CACHE_TTL,
    lookup: (cwd) =>
      Effect.tryPromise(() =>
        discoverSkillsCatalog({
          homeDir: NodeOS.homedir(),
          roninBaseDir: config.baseDir,
          cwd,
          includeDuplicateOrigins: false,
        }),
      ).pipe(Effect.orElseSucceed((): ReadonlyArray<ServerProviderSkill> => [])),
  });

  const continuationKeyCache = yield* Cache.make<ProviderInstanceId, Option.Option<string>>({
    capacity: CONTINUATION_KEY_CACHE_MAX,
    timeToLive: CONTINUATION_KEY_CACHE_TTL,
    lookup: (instanceId) =>
      providerService.getInstanceInfo(instanceId).pipe(
        Effect.map((info) => Option.some(info.continuationIdentity.continuationKey)),
        // An instance that is no longer configured has no key. Its messages
        // then stay in the brief, which is the safe direction.
        Effect.orElseSucceed(() => Option.none<string>()),
      ),
  });

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap((cached) =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached))),
      ),
    );

  const threadModelSelections = new Map<string, ModelSelection>();

  const appendProviderFailureActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind:
      | "provider.turn.start.failed"
      | "provider.turn.interrupt.failed"
      | "provider.agent.stop.failed"
      | "provider.approval.respond.failed"
      | "provider.user-input.respond.failed"
      | "provider.session.stop.failed";
    readonly summary: string;
    readonly detail: string;
    readonly turnId: TurnId | null;
    readonly createdAt: string;
    readonly requestId?: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("provider-failure-activity"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: "error",
            kind: input.kind,
            summary: input.summary,
            payload: {
              detail: input.detail,
              ...(input.requestId ? { requestId: input.requestId } : {}),
            },
            turnId: input.turnId,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  const formatFailureDetail = (cause: Cause.Cause<unknown>): string => {
    const failReason = cause.reasons.find(Cause.isFailReason);
    const providerError = isProviderAdapterRequestError(failReason?.error)
      ? failReason.error
      : undefined;
    if (providerError) {
      return providerError.detail;
    }
    return Cause.pretty(cause);
  };

  const setThreadSession = (input: {
    readonly threadId: ThreadId;
    readonly session: OrchestrationSession;
    readonly createdAt: string;
  }) =>
    serverCommandId("provider-session-set").pipe(
      Effect.flatMap((commandId) =>
        orchestrationEngine.dispatch({
          type: "thread.session.set",
          commandId,
          threadId: input.threadId,
          session: input.session,
          createdAt: input.createdAt,
        }),
      ),
    );

  const setThreadSessionErrorOnTurnStartFailure = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly detail: string;
    readonly createdAt: string;
  }) {
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return;
    }
    const session = thread.session;
    yield* setThreadSession({
      threadId: input.threadId,
      session: {
        ...(session ?? {
          threadId: input.threadId,
          providerName: null,
          providerInstanceId: thread.modelSelection.instanceId,
          runtimeMode: thread.runtimeMode,
        }),
        status: session?.status === "stopped" ? "stopped" : "error",
        activeTurnId: null,
        lastError: input.detail,
        updatedAt: input.createdAt,
      },
      createdAt: input.createdAt,
    });
  });

  const resolveProject = Effect.fnUntraced(function* (projectId: ProjectId) {
    return yield* projectionSnapshotQuery
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  /**
   * Recreates a thread's worktree from its branch when the directory has
   * disappeared. Provider sessions resume into the persisted cwd, so a missing
   * worktree makes every later turn fail as a bogus "session not found".
   * Best-effort: on failure the turn proceeds and reports the real error.
   */
  const ensureThreadWorktree = Effect.fnUntraced(function* (thread: {
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
  }) {
    const { worktreePath, branch } = thread;
    if (!worktreePath || !branch) {
      return;
    }
    const exists = yield* fileSystem.exists(worktreePath).pipe(Effect.orElseSucceed(() => true));
    if (exists) {
      return;
    }
    const project = yield* resolveProject(thread.projectId);
    if (!project) {
      return;
    }
    const cwd = project.workspaceRoot;
    yield* Effect.logWarning("provider command reactor recreating missing worktree", {
      threadId: thread.id,
      worktreePath,
      branch,
    });
    // A directory deleted without `git worktree remove` leaves an admin entry
    // that makes `git worktree add` refuse the path; prune clears it.
    yield* gitWorkflow.pruneWorktrees({ cwd }).pipe(
      Effect.andThen(gitWorkflow.createWorktree({ cwd, refName: branch, path: worktreePath })),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("provider command reactor failed to recreate worktree", {
              threadId: thread.id,
              worktreePath,
              cause: Cause.pretty(cause),
            }),
      ),
    );
  });

  const resolveThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId, { activityKinds: [] })
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const appendThreadActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind: string;
    readonly summary: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }) =>
    Effect.all({
      commandId: serverCommandId("provider-activity"),
      eventId: serverEventId(),
    }).pipe(
      Effect.flatMap(({ commandId, eventId }) =>
        orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId,
          threadId: input.threadId,
          activity: {
            id: eventId,
            tone: "info",
            kind: input.kind,
            summary: input.summary,
            payload: input.payload,
            turnId: null,
            createdAt: input.createdAt,
          },
          createdAt: input.createdAt,
        }),
      ),
    );

  /**
   * Reconstruct, for the provider about to take a turn, the part of the
   * conversation it does not already hold.
   *
   * Returns `undefined` when there is nothing to hand over — the session has
   * been live all along, the thread has no history yet, or a resumed session's
   * own cursor already covers everything.
   */
  const buildProviderHandoffBrief = Effect.fnUntraced(function* (input: {
    readonly thread: OrchestrationThread;
    readonly continuity: ProviderSessionContinuity;
    readonly providerName: string | null;
    /** The message being sent this turn; it is the request, not history. */
    readonly excludeMessageId?: MessageId | undefined;
    readonly maxChars: number;
  }) {
    if (input.continuity.kind === "live" || input.maxChars <= 0) {
      return undefined;
    }
    const history = buildProviderHandoffMessages({
      thread: input.thread,
      ...(input.excludeMessageId !== undefined ? { excludeMessageId: input.excludeMessageId } : {}),
    }).filter(handoffMessageHasContent);
    if (history.length === 0) {
      return undefined;
    }

    // Which instances share resume state with which. An instance that is no
    // longer configured simply has no key, which leaves its messages in the
    // brief — the safe direction.
    const continuationKeyByInstanceId = new Map<ProviderInstanceId, string>();
    for (const instanceId of new Set(
      history.flatMap((message) =>
        message.providerInstanceId !== undefined ? [message.providerInstanceId] : [],
      ),
    )) {
      const continuationKey = yield* Cache.get(continuationKeyCache, instanceId);
      if (Option.isSome(continuationKey)) {
        continuationKeyByInstanceId.set(instanceId, continuationKey.value);
      }
    }

    const selected = selectHandoffMessages({
      messages: history,
      continuationKeyByInstanceId,
      ...(input.continuity.kind === "resumed"
        ? {
            resumedContinuationKey: input.continuity.continuationKey,
            ...(input.continuity.deliveredThroughMessageId !== undefined
              ? { deliveredThroughMessageId: input.continuity.deliveredThroughMessageId }
              : {}),
          }
        : {}),
    });
    if (selected.length === 0) {
      return undefined;
    }

    const project = yield* resolveProject(input.thread.projectId);
    const brief = renderProviderHandoffBrief({
      workspace: {
        threadTitle: input.thread.title ?? null,
        branch: input.thread.branch,
        worktreePath: input.thread.worktreePath,
        cwd:
          resolveThreadWorkspaceCwd({
            thread: input.thread,
            projects: project ? [project] : [],
          }) ?? null,
      },
      messages: selected,
      changedFiles: buildProviderHandoffChangedFiles(input.thread),
      plan: buildProviderHandoffPlan(input.thread),
      fromProviderName:
        selected.findLast(
          (message) =>
            message.providerName !== undefined && message.providerName !== input.providerName,
        )?.providerName ?? null,
      mode: input.continuity.kind === "resumed" ? "resumed" : "briefed",
      maxChars: input.maxChars,
    });
    return brief;
  });

  const rejectStartedThreadModelChangeIfRequired = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly currentModelSelection: ModelSelection;
    readonly requestedModelSelection: ModelSelection | undefined;
  }) {
    const requestedModelSelection = input.requestedModelSelection;
    if (
      requestedModelSelection === undefined ||
      (input.currentModelSelection.instanceId === requestedModelSelection.instanceId &&
        input.currentModelSelection.model === requestedModelSelection.model)
    ) {
      return;
    }
    const providers = yield* providerRegistry.getProviders;
    const requiresNewThread =
      providers.find((snapshot) => snapshot.instanceId === input.currentModelSelection.instanceId)
        ?.requiresNewThreadForModelChange === true ||
      providers.find((snapshot) => snapshot.instanceId === requestedModelSelection.instanceId)
        ?.requiresNewThreadForModelChange === true;
    if (!requiresNewThread) {
      return;
    }
    return yield* new ProviderAdapterRequestError({
      provider: providerErrorLabelFromInstanceHint({
        instanceId: String(requestedModelSelection.instanceId),
        modelSelectionInstanceId: String(input.currentModelSelection.instanceId),
      }),
      method: "thread.turn.start",
      detail: `Thread '${input.threadId}' cannot switch models after the conversation has started. Start a new thread to use '${requestedModelSelection.model}'.`,
    });
  });

  const ensureSessionForThread = Effect.fn("ensureSessionForThread")(function* (
    threadId: ThreadId,
    createdAt: string,
    options?: {
      readonly modelSelection?: ModelSelection;
      readonly pendingTurnStart?: boolean;
    },
  ) {
    const thread = yield* resolveThread(threadId);
    if (!thread) {
      return yield* Effect.die(new Error(`Thread '${threadId}' was not found in read model.`));
    }

    const desiredRuntimeMode = thread.runtimeMode;
    const requestedModelSelection = options?.modelSelection;
    const resolveActiveSession = (threadId: ThreadId) =>
      providerService
        .listSessions()
        .pipe(Effect.map((sessions) => sessions.find((session) => session.threadId === threadId)));

    const activeSession = yield* resolveActiveSession(threadId);
    const activeThreadSession =
      thread.session !== null && thread.session.status !== "stopped" && activeSession
        ? thread.session
        : null;
    if (
      activeThreadSession !== null &&
      activeSession !== undefined &&
      (activeThreadSession.providerInstanceId === undefined ||
        activeSession.providerInstanceId === undefined)
    ) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(activeThreadSession.providerName ?? undefined),
        method: "thread.turn.start",
        detail: `Thread '${threadId}' has an active provider session without a provider instance id.`,
      });
    }
    const currentInstanceId =
      activeThreadSession !== null &&
      activeSession !== undefined &&
      activeSession.providerInstanceId !== undefined
        ? activeSession.providerInstanceId
        : thread.modelSelection.instanceId;
    const desiredModelSelection = requestedModelSelection ?? thread.modelSelection;
    const desiredInstanceId = desiredModelSelection.instanceId;
    const currentInfo = yield* providerService.getInstanceInfo(currentInstanceId).pipe(
      Effect.mapError(
        () =>
          new ProviderAdapterRequestError({
            provider: providerErrorLabelFromInstanceHint({
              instanceId: String(currentInstanceId),
              modelSelectionInstanceId: String(thread.modelSelection.instanceId),
              sessionProvider: thread.session?.providerName ?? undefined,
            }),
            method: "thread.turn.start",
            detail: `Thread '${threadId}' references unknown provider instance '${currentInstanceId}'. The instance is not configured in this build.`,
          }),
      ),
    );
    const desiredInfo = yield* providerService.getInstanceInfo(desiredInstanceId).pipe(
      Effect.mapError(
        () =>
          new ProviderAdapterRequestError({
            provider: providerErrorLabelFromInstanceHint({
              instanceId: String(desiredModelSelection.instanceId),
            }),
            method: "thread.turn.start",
            detail: `Requested provider instance '${desiredInstanceId}' is not configured in this build.`,
          }),
      ),
    );
    const desiredDriverKind = desiredInfo.driverKind;
    if (!isProviderDriverKind(desiredDriverKind)) {
      return yield* new ProviderAdapterRequestError({
        provider: providerErrorLabel(String(desiredDriverKind)),
        method: "thread.turn.start",
        detail: `Requested provider instance '${desiredInstanceId}' uses unknown provider driver '${desiredDriverKind}'. The driver is not installed in this build.`,
      });
    }
    const preferredProvider: ProviderDriverKind = desiredDriverKind;
    if (options?.pendingTurnStart === true && thread.session?.status !== "running") {
      yield* setThreadSession({
        threadId,
        session: {
          threadId,
          status: "starting",
          providerName: activeSession?.provider ?? preferredProvider,
          providerInstanceId: activeSession?.providerInstanceId ?? desiredInstanceId,
          runtimeMode: desiredRuntimeMode,
          activeTurnId: null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      });
    }
    if (thread.session !== null) {
      yield* rejectStartedThreadModelChangeIfRequired({
        threadId,
        currentModelSelection:
          activeSession?.model !== undefined
            ? {
                ...thread.modelSelection,
                instanceId: currentInstanceId,
                model: activeSession.model,
              }
            : thread.modelSelection,
        requestedModelSelection,
      });
    }
    // A thread that changes instance mid-conversation used to be rejected here,
    // once for crossing drivers and once for crossing continuation groups. Both
    // rejections existed because the incoming provider had no way to learn what
    // it had missed. It does now: the session ledger keeps each group's own
    // resume cursor, and anything the cursor cannot cover is handed over as a
    // brief. The restart path below carries the change out; all that is left to
    // do here is say so in the log.
    if (
      thread.session !== null &&
      requestedModelSelection !== undefined &&
      requestedModelSelection.instanceId !== currentInstanceId
    ) {
      yield* Effect.logInfo("provider command reactor handing thread to another provider", {
        threadId,
        currentInstanceId,
        currentDriverKind: currentInfo.driverKind,
        currentContinuationKey: currentInfo.continuationIdentity.continuationKey,
        desiredInstanceId,
        desiredDriverKind: desiredInfo.driverKind,
        desiredContinuationKey: desiredInfo.continuationIdentity.continuationKey,
      });
    }
    const project = yield* resolveProject(thread.projectId);
    const effectiveCwd = resolveThreadWorkspaceCwd({
      thread,
      projects: project ? [project] : [],
    });

    const startProviderSession = (input?: {
      readonly resumeCursor?: unknown;
      readonly provider?: ProviderDriverKind;
    }) =>
      providerService.startSession(threadId, {
        threadId,
        ...(preferredProvider ? { provider: preferredProvider } : {}),
        providerInstanceId: desiredInstanceId,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
        ...(thread.title ? { title: thread.title } : {}),
        modelSelection: desiredModelSelection,
        ...(input?.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
        runtimeMode: desiredRuntimeMode,
      });

    // What the instance we are about to start left behind on this thread the
    // last time anything in its continuation group ran here. A read failure is
    // not worth failing the turn over: the session then starts cold and the
    // handoff brief covers it, which is the same path a first-time instance
    // takes.
    const resolveDesiredContinuation = () =>
      providerService.getContinuationState({ threadId, instanceId: desiredInstanceId }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to read provider continuation", {
            threadId,
            desiredInstanceId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(Option.none<ProviderContinuationState>())),
        ),
      );

    const bindSessionToThread = (session: ProviderSession) =>
      Effect.gen(function* () {
        if (session.providerInstanceId === undefined) {
          return yield* new ProviderAdapterRequestError({
            provider: providerErrorLabel(session.provider),
            method: "thread.turn.start",
            detail: `Provider session '${session.threadId}' started without a provider instance id.`,
          });
        }
        yield* setThreadSession({
          threadId,
          session: {
            threadId,
            status:
              options?.pendingTurnStart === true && session.status === "ready"
                ? "starting"
                : mapProviderSessionStatusToOrchestrationStatus(session.status),
            providerName: session.provider,
            providerInstanceId: session.providerInstanceId,
            runtimeMode: desiredRuntimeMode,
            // Provider turn ids are not orchestration turn ids.
            activeTurnId: null,
            lastError: session.lastError ?? null,
            updatedAt: session.updatedAt,
          },
          createdAt,
        });
      });

    const existingSessionThreadId =
      thread.session && thread.session.status !== "stopped" && activeSession ? thread.id : null;
    if (existingSessionThreadId) {
      const runtimeModeChanged = thread.runtimeMode !== thread.session?.runtimeMode;
      const cwdChanged = effectiveCwd !== activeSession?.cwd;
      const desiredCapabilities = yield* providerService.getCapabilities(desiredInstanceId);
      const sessionModelSwitch = desiredCapabilities.sessionModelSwitch;
      const modelChanged =
        requestedModelSelection !== undefined &&
        requestedModelSelection.model !== activeSession?.model;
      const instanceChanged =
        requestedModelSelection !== undefined &&
        activeSession?.providerInstanceId !== requestedModelSelection.instanceId;
      const shouldRestartForModelChange = modelChanged && sessionModelSwitch === "unsupported";
      const previousModelSelection = threadModelSelections.get(threadId);
      // Options a provider reads once, at spawn — Claude's thinking effort,
      // Grok's `--reasoning-effort` — only reach the agent through a restart.
      // The model is compared separately above, so a provider that switches
      // models in session keeps doing that without a needless restart.
      const shouldRestartForModelOptionsChange =
        desiredCapabilities.sessionModelOptionsSwitch === "unsupported" &&
        requestedModelSelection !== undefined &&
        !Equal.equals(previousModelSelection?.options, requestedModelSelection.options);

      if (
        !runtimeModeChanged &&
        !cwdChanged &&
        !instanceChanged &&
        !shouldRestartForModelChange &&
        !shouldRestartForModelOptionsChange
      ) {
        return {
          sessionThreadId: existingSessionThreadId,
          boundInstanceId: desiredInstanceId,
          boundProviderName: preferredProvider,
          continuity: { kind: "live" } as const,
        };
      }

      // Instances that share a continuation key can resume each other's
      // sessions, so the live cursor carries across those. Across groups it
      // cannot: handing the outgoing provider's cursor to the incoming one
      // would resume the wrong conversation, or nothing at all. There the
      // incoming instance's own ledger row is the only usable starting point.
      const continuationCompatible =
        currentInfo.continuationIdentity.continuationKey ===
        desiredInfo.continuationIdentity.continuationKey;
      const liveCursor = continuationCompatible
        ? (activeSession?.resumeCursor ?? undefined)
        : undefined;
      const ledgerContinuation =
        liveCursor === undefined
          ? yield* resolveDesiredContinuation()
          : Option.none<ProviderContinuationState>();
      // Restarting because the model cannot change in session used to drop the
      // cursor, which threw the conversation away to change one setting. The
      // model is passed to the new session independently of where it resumes
      // from, so there is nothing to gain by starting cold.
      const resumeCursor =
        liveCursor ??
        (Option.isSome(ledgerContinuation) ? ledgerContinuation.value.resumeCursor : undefined);
      yield* Effect.logInfo("provider command reactor restarting provider session", {
        threadId,
        existingSessionThreadId,
        currentProvider: activeSession?.provider,
        currentInstanceId,
        desiredInstanceId,
        desiredProvider: desiredModelSelection.instanceId,
        currentRuntimeMode: thread.session?.runtimeMode,
        desiredRuntimeMode: thread.runtimeMode,
        runtimeModeChanged,
        previousCwd: activeSession?.cwd,
        desiredCwd: effectiveCwd,
        cwdChanged,
        modelChanged,
        instanceChanged,
        shouldRestartForModelChange,
        shouldRestartForModelOptionsChange,
        hasResumeCursor: resumeCursor !== undefined,
      });
      const restartedSession = yield* startProviderSession(
        resumeCursor !== undefined ? { resumeCursor } : undefined,
      );
      yield* Effect.logInfo("provider command reactor restarted provider session", {
        threadId,
        previousSessionId: existingSessionThreadId,
        restartedSessionThreadId: restartedSession.threadId,
        provider: restartedSession.provider,
        runtimeMode: restartedSession.runtimeMode,
        cwd: restartedSession.cwd,
      });
      yield* bindSessionToThread(restartedSession);
      return {
        sessionThreadId: restartedSession.threadId,
        boundInstanceId: restartedSession.providerInstanceId ?? desiredInstanceId,
        boundProviderName: restartedSession.provider,
        continuity:
          resumeCursor !== undefined
            ? ({
                kind: "resumed",
                continuationKey: desiredInfo.continuationIdentity.continuationKey,
                ...(Option.isSome(ledgerContinuation) &&
                ledgerContinuation.value.lastDeliveredMessageId !== null
                  ? {
                      deliveredThroughMessageId: ledgerContinuation.value.lastDeliveredMessageId,
                    }
                  : {}),
              } as const)
            : ({ kind: "fresh" } as const),
      };
    }

    // No live session: either the thread has never run, the server restarted,
    // or a switch retired the previous provider. In all three the ledger is the
    // only thing that knows whether this instance can pick up where it left off.
    const coldStartContinuation = yield* resolveDesiredContinuation();
    const startedSession = yield* startProviderSession(
      Option.isSome(coldStartContinuation)
        ? { resumeCursor: coldStartContinuation.value.resumeCursor }
        : undefined,
    );
    yield* bindSessionToThread(startedSession);
    return {
      sessionThreadId: startedSession.threadId,
      boundInstanceId: startedSession.providerInstanceId ?? desiredInstanceId,
      boundProviderName: startedSession.provider,
      continuity: Option.isSome(coldStartContinuation)
        ? ({
            kind: "resumed",
            continuationKey: coldStartContinuation.value.continuationKey,
            ...(coldStartContinuation.value.lastDeliveredMessageId !== null
              ? { deliveredThroughMessageId: coldStartContinuation.value.lastDeliveredMessageId }
              : {}),
          } as const)
        : ({ kind: "fresh" } as const),
    };
  });

  const buildSendTurnRequestForThread = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly messageId?: MessageId;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
    readonly modelSelection?: ModelSelection;
    readonly interactionMode?: ProviderInteractionMode;
    readonly createdAt: string;
  }) {
    // Debug mode prepends its instructions after the skills and handoff brief
    // are built, so reserve the room here rather than overflowing the turn.
    const debugPromptChars = debugModePromptOverheadChars(input.interactionMode);
    const thread = yield* resolveThread(input.threadId);
    if (!thread) {
      return yield* Effect.die(
        new Error(`Thread '${input.threadId}' was not found in read model.`),
      );
    }
    const ensured = yield* ensureSessionForThread(input.threadId, input.createdAt, {
      ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
      pendingTurnStart: true,
    });
    if (input.modelSelection !== undefined) {
      threadModelSelections.set(input.threadId, input.modelSelection);
    }
    const project = yield* resolveProject(thread.projectId);
    const skillCwd =
      resolveThreadWorkspaceCwd({
        thread,
        projects: project ? [project] : [],
      }) ?? config.cwd;
    const catalog = yield* Cache.get(skillsCatalogCache, skillCwd);
    const providerSnapshots = yield* providerRegistry.getProviders;
    const activeProvider = providerSnapshots.find(
      (provider) => provider.instanceId === ensured.boundInstanceId,
    );
    const settings = yield* serverSettingsService.getSettings;
    const availableSkills = filterDisabledSkills(
      mergeSkillsIntoCatalog({
        native: activeProvider?.skills ?? [],
        catalog: mergeSkillsIntoCatalog({
          native: catalog,
          catalog: providerSnapshots.flatMap((provider) => provider.skills ?? []),
        }),
      }),
      settings.skills.disabled,
    );
    const referencedSkills = resolveInvokedSkills(input.messageText, availableSkills);
    const skillInlineText =
      referencedSkills.length === 0
        ? ""
        : yield* Effect.tryPromise(() =>
            buildInlineSkillInstructions({
              skills: referencedSkills,
              nativeSkillPaths: (activeProvider?.skills ?? []).map((skill) => skill.path),
              maxChars: Math.max(
                0,
                PROVIDER_SEND_TURN_MAX_INPUT_CHARS -
                  input.messageText.length -
                  debugPromptChars -
                  2048,
              ),
            }),
          ).pipe(Effect.orElseSucceed(() => ""));
    const messageWithSkills = skillInlineText
      ? `${input.messageText}\n\n${skillInlineText}`
      : input.messageText;

    // A provider that is picking this thread up without having followed it
    // reads the conversation first, then the request. Built here rather than at
    // switch time so an interrupted or retried turn reconstructs the same brief
    // from the same durable history.
    const briefCeiling = yield* providerService.getCapabilities(ensured.boundInstanceId).pipe(
      Effect.map((capabilities) => capabilities.maxHandoffBriefChars),
      Effect.orElseSucceed(() => undefined),
    );
    const handoffBrief = yield* buildProviderHandoffBrief({
      thread,
      continuity: ensured.continuity,
      providerName: ensured.boundProviderName,
      ...(input.messageId !== undefined ? { excludeMessageId: input.messageId } : {}),
      maxChars: Math.max(
        0,
        Math.min(PROVIDER_SEND_TURN_MAX_INPUT_CHARS, briefCeiling ?? Number.POSITIVE_INFINITY) -
          handoffWrapOverhead(messageWithSkills) -
          debugPromptChars -
          PROVIDER_HANDOFF_BRIEF_RESERVED_CHARS,
      ),
    });
    if (handoffBrief !== undefined) {
      const handoff: ProviderHandoffMode =
        ensured.continuity.kind === "resumed" ? "resumed" : "briefed";
      yield* Effect.logInfo("provider command reactor handed conversation to provider", {
        threadId: input.threadId,
        handoff,
        briefChars: handoffBrief.chars,
        briefEstimatedTokens: handoffBrief.estimatedTokens,
        briefMessages: handoffBrief.messageCount,
        briefFullMessages: handoffBrief.fullMessageCount,
        briefSummarizedMessages: handoffBrief.summarizedMessageCount,
        briefOmittedMessages: handoffBrief.omittedMessageCount,
        briefCompressed: handoffBrief.compressed,
      });
      const activityPayload: ProviderHandoffActivityPayload = {
        instanceId: ensured.boundInstanceId,
        providerName: ensured.boundProviderName,
        handoff,
        briefChars: handoffBrief.chars,
        briefCompressed: handoffBrief.compressed,
        briefFullMessages: handoffBrief.fullMessageCount,
        briefSummarizedMessages: handoffBrief.summarizedMessageCount,
        briefOmittedMessages: handoffBrief.omittedMessageCount,
      };
      yield* appendThreadActivity({
        threadId: input.threadId,
        kind: PROVIDER_HANDOFF_ACTIVITY_KIND,
        summary:
          handoff === "resumed"
            ? "Provider resumed and caught up on the conversation"
            : "Provider took over with a conversation brief",
        payload: activityPayload,
        createdAt: input.createdAt,
      }).pipe(
        // The brief is already built; failing to record it must not cost the
        // user their turn.
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to record provider handoff", {
            threadId: input.threadId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    }

    const messageWithHandoff =
      handoffBrief === undefined
        ? messageWithSkills
        : wrapProviderHandoffInput({
            contextText: handoffBrief.text,
            messageText: messageWithSkills,
          });
    const normalizedInput = toNonEmptyProviderInput(
      withProviderDebugModePrompt({
        interactionMode: input.interactionMode,
        text: messageWithHandoff,
      }),
    );
    const normalizedAttachments = input.attachments ?? [];
    const activeSession = yield* providerService
      .listSessions()
      .pipe(
        Effect.map((sessions) => sessions.find((session) => session.threadId === input.threadId)),
      );
    const sessionModelSwitch =
      activeSession === undefined
        ? "in-session"
        : activeSession.providerInstanceId === undefined
          ? yield* new ProviderAdapterRequestError({
              provider: providerErrorLabel(activeSession.provider),
              method: "thread.turn.start",
              detail: `Active provider session '${activeSession.threadId}' is missing a provider instance id.`,
            })
          : (yield* providerService.getCapabilities(activeSession.providerInstanceId))
              .sessionModelSwitch;
    const requestedModelSelection =
      input.modelSelection ?? threadModelSelections.get(input.threadId) ?? thread.modelSelection;
    const modelForTurn =
      sessionModelSwitch === "unsupported" && input.modelSelection === undefined
        ? activeSession?.model !== undefined
          ? {
              ...requestedModelSelection,
              model: activeSession.model,
            }
          : requestedModelSelection
        : input.modelSelection;

    return {
      threadId: input.threadId,
      ...(normalizedInput ? { input: normalizedInput } : {}),
      ...(normalizedAttachments.length > 0 ? { attachments: normalizedAttachments } : {}),
      ...(modelForTurn !== undefined ? { modelSelection: modelForTurn } : {}),
      ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
    };
  });

  const maybeGenerateAndRenameWorktreeBranchForFirstTurn = Effect.fn(
    "maybeGenerateAndRenameWorktreeBranchForFirstTurn",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly messageText: string;
    readonly attachments?: ReadonlyArray<ChatAttachment>;
  }) {
    if (!input.branch || !input.worktreePath) {
      return;
    }
    if (!isTemporaryWorktreeBranch(input.branch)) {
      return;
    }

    const oldBranch = input.branch;
    const cwd = input.worktreePath;
    const attachments = input.attachments ?? [];
    yield* Effect.gen(function* () {
      const settings = yield* serverSettingsService.getSettings;
      const modelSelection =
        settings.sourceControlWriterModelSelection === null
          ? settings.textGenerationModelSelection
          : resolveSourceControlWriterModelSelection(
              settings,
              yield* providerRegistry.getProviders,
            );

      const generated = yield* textGeneration.generateBranchName({
        cwd,
        message: input.messageText,
        ...(attachments.length > 0 ? { attachments } : {}),
        modelSelection,
      });
      if (!generated) return;

      const targetBranch = buildGeneratedWorktreeBranchName(generated.branch);
      if (targetBranch === oldBranch) return;

      const renamed = yield* gitWorkflow.renameBranch({ cwd, oldBranch, newBranch: targetBranch });
      yield* orchestrationEngine.dispatch({
        type: "thread.meta.update",
        commandId: yield* serverCommandId("worktree-branch-rename"),
        threadId: input.threadId,
        branch: renamed.branch,
        worktreePath: cwd,
      });
      yield* vcsStatusBroadcaster.refreshStatus(cwd).pipe(Effect.ignoreCause({ log: true }));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("provider command reactor failed to generate or rename worktree branch", {
          threadId: input.threadId,
          cwd,
          oldBranch,
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  const maybeGenerateThreadTitleForFirstTurn = Effect.fn("maybeGenerateThreadTitleForFirstTurn")(
    function* (input: {
      readonly threadId: ThreadId;
      readonly cwd: string;
      readonly messageText: string;
      readonly attachments?: ReadonlyArray<ChatAttachment>;
      readonly titleSeed?: string;
    }) {
      const attachments = input.attachments ?? [];
      yield* Effect.gen(function* () {
        const { textGenerationModelSelection: modelSelection } =
          yield* serverSettingsService.getSettings;

        const generated = yield* textGeneration
          .generateThreadTitle({
            cwd: input.cwd,
            message: input.messageText,
            ...(attachments.length > 0 ? { attachments } : {}),
            modelSelection,
          })
          .pipe(
            Effect.retry({
              times: 2,
              schedule: Schedule.exponential("2 seconds"),
            }),
          );
        if (!generated) return;

        const thread = yield* resolveThread(input.threadId);
        if (!thread) return;
        if (!canReplaceThreadTitle(thread.title, input.titleSeed)) {
          return;
        }

        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: yield* serverCommandId("thread-title-rename"),
          threadId: input.threadId,
          title: generated.title,
        });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to generate or rename thread title", {
            threadId: input.threadId,
            cwd: input.cwd,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    },
  );

  const regenerateThreadTitle = Effect.fn("regenerateThreadTitle")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.meta-updated" }>,
    requestId: CommandId,
  ) {
    if (event.payload.regenerateTitle !== true) {
      return { _tag: "Superseded" } as const;
    }

    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread || thread.titleRegeneration?.requestId !== requestId) {
      return { _tag: "Superseded" } as const;
    }

    const { message, attachments } = formatThreadTitleContext(thread.messages);
    if (message.length === 0) {
      return { _tag: "Completed", title: undefined } as const;
    }

    const previousTitle = event.payload.previousTitle ?? thread.title;
    if (thread.title !== previousTitle) {
      return { _tag: "Superseded" } as const;
    }
    const project = yield* resolveProject(thread.projectId);
    const cwd =
      resolveThreadWorkspaceCwd({
        thread,
        projects: project ? [project] : [],
      }) ?? process.cwd();
    const { textGenerationModelSelection: modelSelection } =
      yield* serverSettingsService.getSettings;
    const generated = yield* textGeneration.generateThreadTitle({
      cwd,
      message,
      previousTitle,
      ...(attachments.length > 0 ? { attachments } : {}),
      modelSelection,
    });
    if (generated.title === DEFAULT_THREAD_TITLE || generated.title === previousTitle) {
      return { _tag: "Completed", title: undefined } as const;
    }

    const latestThread = yield* resolveThread(event.payload.threadId);
    if (
      !latestThread ||
      latestThread.titleRegeneration?.requestId !== requestId ||
      latestThread.title !== previousTitle
    ) {
      return { _tag: "Superseded" } as const;
    }

    return { _tag: "Completed", title: generated.title } as const;
  });
  const dispatchThreadTitleRegenerationCompletion = Effect.fn(
    "dispatchThreadTitleRegenerationCompletion",
  )(function* (input: {
    readonly threadId: ThreadId;
    readonly requestId: CommandId;
    readonly title?: string;
  }) {
    yield* orchestrationEngine.dispatch({
      type: "thread.title.regeneration.complete",
      commandId: yield* serverCommandId("thread-title-regeneration-complete"),
      threadId: input.threadId,
      requestId: input.requestId,
      ...(input.title !== undefined ? { title: input.title } : {}),
    });
  });
  const findInterruptedThreadTitleRegenerations = Effect.fn(
    "findInterruptedThreadTitleRegenerations",
  )(function* () {
    const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
    return readModel.threads.flatMap((thread) => {
      const requestId = thread.titleRegeneration?.requestId;
      return requestId === undefined ? [] : [{ threadId: thread.id, requestId }];
    });
  });
  const clearInterruptedThreadTitleRegenerations = Effect.fn(
    "clearInterruptedThreadTitleRegenerations",
  )(function* (
    interrupted: ReadonlyArray<{ readonly threadId: ThreadId; readonly requestId: CommandId }>,
  ) {
    yield* Effect.forEach(
      interrupted,
      ({ threadId, requestId }) => {
        return dispatchThreadTitleRegenerationCompletion({
          threadId,
          requestId,
        }).pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.interrupt;
            }
            return Effect.logWarning(
              "provider command reactor failed to clear interrupted title regeneration",
              {
                threadId,
                cause: Cause.pretty(cause),
              },
            );
          }),
        );
      },
      { discard: true },
    );
  });
  const processThreadTitleRegenerationSafely = Effect.fn("processThreadTitleRegenerationSafely")(
    function* (event: Extract<ProviderIntentEvent, { type: "thread.meta-updated" }>) {
      if (event.payload.regenerateTitle !== true) {
        return;
      }

      const requestId = event.payload.titleRegeneration?.requestId ?? event.commandId;
      if (requestId === null) {
        return;
      }
      const result = yield* regenerateThreadTitle(event, requestId).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning("provider command reactor failed to regenerate thread title", {
            threadId: event.payload.threadId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as({ _tag: "Completed", title: undefined } as const));
        }),
      );
      if (result._tag === "Superseded") {
        return;
      }

      const completion = {
        threadId: event.payload.threadId,
        requestId,
        ...(result.title !== undefined ? { title: result.title } : {}),
      };
      yield* dispatchThreadTitleRegenerationCompletion(completion).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning(
            "provider command reactor retrying title regeneration completion",
            {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            },
          ).pipe(Effect.andThen(dispatchThreadTitleRegenerationCompletion(completion)));
        }),
      );
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning(
            "provider command reactor failed to complete title regeneration",
            {
              threadId: event.payload.threadId,
              cause: Cause.pretty(cause),
            },
          );
        }),
      ),
  );
  const threadTitleRegenerationWorker = yield* makeDrainableWorker(
    processThreadTitleRegenerationSafely,
  );

  const processTurnStartRequested = Effect.fn("processTurnStartRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-start-requested" }>,
  ) {
    const key = turnStartKeyForEvent(event);
    if (yield* hasHandledTurnStartRecently(key)) {
      return;
    }

    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const message = thread.messages.find((entry) => entry.id === event.payload.messageId);
    if (!message || message.role !== "user") {
      yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.start.failed",
        summary: "Provider turn start failed",
        detail: `User message '${event.payload.messageId}' was not found for turn start request.`,
        turnId: null,
        createdAt: event.payload.createdAt,
      });
      return;
    }

    yield* ensureThreadWorktree(thread);

    const isFirstUserMessageTurn =
      thread.messages.filter((entry) => entry.role === "user").length === 1;
    if (isFirstUserMessageTurn) {
      const project = yield* resolveProject(thread.projectId);
      const generationCwd =
        resolveThreadWorkspaceCwd({
          thread,
          projects: project ? [project] : [],
        }) ?? process.cwd();
      const generationInput = {
        messageText: message.text,
        ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
        ...(event.payload.titleSeed !== undefined ? { titleSeed: event.payload.titleSeed } : {}),
      };

      yield* maybeGenerateAndRenameWorktreeBranchForFirstTurn({
        threadId: event.payload.threadId,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        ...generationInput,
      }).pipe(Effect.forkScoped);

      if (canReplaceThreadTitle(thread.title, event.payload.titleSeed)) {
        yield* maybeGenerateThreadTitleForFirstTurn({
          threadId: event.payload.threadId,
          cwd: generationCwd,
          ...generationInput,
        }).pipe(Effect.forkScoped);
      }
    }

    const handleTurnStartFailure = (cause: Cause.Cause<unknown>) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.void;
      }
      const detail = formatFailureDetail(cause);
      return setThreadSessionErrorOnTurnStartFailure({
        threadId: event.payload.threadId,
        detail,
        createdAt: event.payload.createdAt,
      }).pipe(
        Effect.flatMap(() =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.turn.start.failed",
            summary: "Provider turn start failed",
            detail,
            turnId: null,
            createdAt: event.payload.createdAt,
          }),
        ),
        Effect.asVoid,
      );
    };

    const recoverTurnStartFailure = (cause: Cause.Cause<unknown>) =>
      handleTurnStartFailure(cause).pipe(
        Effect.catchCause((recoveryCause) =>
          Effect.logWarning("provider command reactor failed to recover turn start failure", {
            eventType: event.type,
            threadId: event.payload.threadId,
            cause: Cause.pretty(recoveryCause),
            originalCause: Cause.pretty(cause),
          }),
        ),
      );

    const sendTurnRequest = yield* buildSendTurnRequestForThread({
      threadId: event.payload.threadId,
      messageId: event.payload.messageId,
      messageText: message.text,
      ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
      ...(event.payload.modelSelection !== undefined
        ? { modelSelection: event.payload.modelSelection }
        : {}),
      interactionMode: event.payload.interactionMode,
      createdAt: event.payload.createdAt,
    }).pipe(
      Effect.map(Option.some),
      Effect.catchCause((cause) => handleTurnStartFailure(cause).pipe(Effect.as(Option.none()))),
    );

    if (Option.isNone(sendTurnRequest)) {
      return;
    }

    yield* providerService
      .sendTurn(sendTurnRequest.value)
      .pipe(Effect.catchCause(recoverTurnStartFailure), Effect.forkScoped);
  });

  const processTurnInterruptRequested = Effect.fn("processTurnInterruptRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.turn-interrupt-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const session = thread.session;
    if (!session || session.status === "stopped") {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.turn.interrupt.failed",
        summary: "Provider turn interrupt failed",
        detail: "No active provider session is bound to this thread.",
        turnId: event.payload.turnId ?? null,
        createdAt: event.payload.createdAt,
      });
    }

    /**
     * A provider that cannot be interrupted leaves the thread pinned as running
     * with no way back, so the failure path stops the session outright and
     * records why. Re-reads the thread first and again after the stop: a turn
     * that finished on its own while the interrupt was failing must keep its
     * own terminal state rather than be overwritten with an error.
     */
    const recoverInterruptFailure = (cause: Cause.Cause<unknown>) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.interrupt;
      }

      const detail = formatFailureDetail(cause);
      return Effect.gen(function* () {
        const latestThread = yield* resolveThread(event.payload.threadId);
        const latestSession = latestThread?.session;
        if (
          !latestSession ||
          latestSession.status === "stopped" ||
          latestSession.status === "ready" ||
          (event.payload.turnId !== undefined &&
            latestSession.activeTurnId !== null &&
            latestSession.activeTurnId !== event.payload.turnId)
        ) {
          return;
        }

        yield* providerService.stopSession({ threadId: event.payload.threadId }).pipe(
          Effect.catchCause((stopCause) => {
            if (Cause.hasInterruptsOnly(stopCause)) {
              return Effect.interrupt;
            }
            return Effect.logWarning(
              "provider command reactor failed to stop session after interrupt failure",
              {
                threadId: event.payload.threadId,
                cause: Cause.pretty(stopCause),
                originalCause: detail,
              },
            );
          }),
        );
        const stoppedThread = yield* resolveThread(event.payload.threadId);
        const stoppedSession = stoppedThread?.session;
        if (
          !stoppedSession ||
          stoppedSession.status === "stopped" ||
          stoppedSession.status === "ready" ||
          (event.payload.turnId !== undefined &&
            stoppedSession.activeTurnId !== null &&
            stoppedSession.activeTurnId !== event.payload.turnId)
        ) {
          return;
        }

        yield* setThreadSession({
          threadId: event.payload.threadId,
          session: {
            ...stoppedSession,
            status: "stopped",
            activeTurnId: null,
            lastError: detail,
            updatedAt: event.payload.createdAt,
          },
          createdAt: event.payload.createdAt,
        });
        yield* appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.turn.interrupt.failed",
          summary: "Provider turn interrupt failed",
          detail,
          turnId: event.payload.turnId ?? null,
          createdAt: event.payload.createdAt,
        });
      });
    };

    // Orchestration turn ids are not provider turn ids, so interrupt by session.
    yield* providerService
      .interruptTurn({ threadId: event.payload.threadId })
      .pipe(Effect.catchCause(recoverInterruptFailure));
  });

  /**
   * Stop a single subagent, leaving its parent turn running.
   *
   * Reports rather than escalates when the provider cannot target one child:
   * falling back to a turn interrupt here would kill work the user did not ask
   * to stop.
   */
  const processAgentStopRequested = Effect.fn("processAgentStopRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.agent-stop-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.agent.stop.failed",
        summary: "Stopping the agent failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
      });
    }

    yield* providerService
      .stopAgent({
        threadId: event.payload.threadId,
        taskId: event.payload.taskId,
      })
      .pipe(
        // Includes ProviderOperationUnsupportedError: a client that asks a
        // provider without per-agent stop must be told, not logged at.
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.agent.stop.failed",
            summary: "Stopping the agent failed",
            detail: Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
          }),
        ),
      );
  });

  const processApprovalResponseRequested = Effect.fn("processApprovalResponseRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.approval-response-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const hasSession = thread.session && thread.session.status !== "stopped";
    if (!hasSession) {
      return yield* appendProviderFailureActivity({
        threadId: event.payload.threadId,
        kind: "provider.approval.respond.failed",
        summary: "Provider approval response failed",
        detail: "No active provider session is bound to this thread.",
        turnId: null,
        createdAt: event.payload.createdAt,
        requestId: event.payload.requestId,
      });
    }

    yield* providerService
      .respondToRequest({
        threadId: event.payload.threadId,
        requestId: event.payload.requestId,
        decision: event.payload.decision,
      })
      .pipe(
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.approval.respond.failed",
            summary: "Provider approval response failed",
            detail: isUnknownPendingApprovalRequestError(cause)
              ? stalePendingRequestDetail("approval", event.payload.requestId)
              : Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
            requestId: event.payload.requestId,
          }),
        ),
      );
  });

  const processUserInputResponseRequested = Effect.fn("processUserInputResponseRequested")(
    function* (
      event: Extract<ProviderIntentEvent, { type: "thread.user-input-response-requested" }>,
    ) {
      const thread = yield* resolveThread(event.payload.threadId);
      if (!thread) {
        return;
      }
      const hasSession = thread.session && thread.session.status !== "stopped";
      if (!hasSession) {
        return yield* appendProviderFailureActivity({
          threadId: event.payload.threadId,
          kind: "provider.user-input.respond.failed",
          summary: "Provider user input response failed",
          detail: "No active provider session is bound to this thread.",
          turnId: null,
          createdAt: event.payload.createdAt,
          requestId: event.payload.requestId,
        });
      }

      yield* providerService
        .respondToUserInput({
          threadId: event.payload.threadId,
          requestId: event.payload.requestId,
          answers: event.payload.answers,
        })
        .pipe(
          Effect.catchCause((cause) =>
            appendProviderFailureActivity({
              threadId: event.payload.threadId,
              kind: "provider.user-input.respond.failed",
              summary: "Provider user input response failed",
              detail: isUnknownPendingUserInputRequestError(cause)
                ? stalePendingRequestDetail("user-input", event.payload.requestId)
                : Cause.pretty(cause),
              turnId: null,
              createdAt: event.payload.createdAt,
              requestId: event.payload.requestId,
            }),
          ),
        );
    },
  );

  const processSessionStopRequested = Effect.fn("processSessionStopRequested")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.session-stop-requested" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }

    const now = event.payload.createdAt;
    if (thread.session && thread.session.status !== "stopped") {
      const stopped = yield* providerService.stopSession({ threadId: thread.id }).pipe(
        Effect.as(true),
        Effect.catchCause((cause) =>
          appendProviderFailureActivity({
            threadId: event.payload.threadId,
            kind: "provider.session.stop.failed",
            summary: "Provider session stop failed",
            detail: Cause.pretty(cause),
            turnId: null,
            createdAt: event.payload.createdAt,
          }).pipe(Effect.as(false)),
        ),
      );
      if (!stopped) {
        return;
      }
    }

    yield* setThreadSession({
      threadId: thread.id,
      session: {
        threadId: thread.id,
        status: "stopped",
        providerName: thread.session?.providerName ?? null,
        ...(thread.session?.providerInstanceId !== undefined
          ? { providerInstanceId: thread.session.providerInstanceId }
          : {}),
        runtimeMode: thread.session?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
        activeTurnId: null,
        lastError: thread.session?.lastError ?? null,
        updatedAt: now,
      },
      createdAt: now,
    });
  });

  /**
   * Retire the outgoing provider so the next turn binds the incoming one.
   *
   * Nothing is started here. The switch is only a decision, and the thread may
   * sit on it for a while; spinning up a session now would burn a provider
   * process to hold a conversation nobody is having yet. The next turn starts
   * the new session and carries the handoff.
   */
  const processProviderSwitched = Effect.fn("processProviderSwitched")(function* (
    event: Extract<ProviderIntentEvent, { type: "thread.provider-switched" }>,
  ) {
    const thread = yield* resolveThread(event.payload.threadId);
    if (!thread) {
      return;
    }
    const now = event.payload.switchedAt;

    // Stopping is safe: the directory has already mirrored this session's
    // resume cursor into the ledger, so the outgoing provider stays resumable
    // if the user switches back.
    if (thread.session && thread.session.status !== "stopped") {
      yield* providerService.stopSession({ threadId: thread.id }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("provider command reactor failed to stop outgoing provider session", {
            threadId: thread.id,
            cause: Cause.pretty(cause),
          }),
        ),
      );
      yield* setThreadSession({
        threadId: thread.id,
        session: {
          threadId: thread.id,
          status: "stopped",
          providerName: thread.session.providerName ?? null,
          ...(thread.session.providerInstanceId !== undefined
            ? { providerInstanceId: thread.session.providerInstanceId }
            : {}),
          runtimeMode: thread.session.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });
    }

    // The cached selection drives restart decisions on later turns; leaving the
    // retired provider's selection there would make the next turn look like a
    // model change on a provider that is no longer bound.
    threadModelSelections.set(event.payload.threadId, event.payload.modelSelection);

    const activityPayload: ProviderSwitchActivityPayload = {
      fromInstanceId: event.payload.fromInstanceId,
      fromProviderName: event.payload.fromProviderName,
      toInstanceId: event.payload.toInstanceId,
      toProviderName: null,
      model: event.payload.modelSelection.model,
    };
    yield* appendThreadActivity({
      threadId: event.payload.threadId,
      kind: PROVIDER_SWITCH_ACTIVITY_KIND,
      summary: event.payload.fromProviderName
        ? `Switched provider from ${event.payload.fromProviderName} to ${event.payload.toInstanceId}`
        : `Switched provider to ${event.payload.toInstanceId}`,
      payload: activityPayload,
      createdAt: now,
    });
  });

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (
    event: ProviderIntentEvent,
  ) {
    yield* Effect.annotateCurrentSpan({
      "orchestration.event_type": event.type,
      "orchestration.thread_id": event.payload.threadId,
      ...(event.commandId ? { "orchestration.command_id": event.commandId } : {}),
    });
    yield* increment(orchestrationEventsProcessedTotal, {
      eventType: event.type,
    });
    switch (event.type) {
      case "thread.meta-updated":
        yield* threadTitleRegenerationWorker.enqueue(event);
        return;
      case "thread.runtime-mode-set": {
        const thread = yield* resolveThread(event.payload.threadId);
        if (!thread?.session || thread.session.status === "stopped") {
          return;
        }
        const cachedModelSelection = threadModelSelections.get(event.payload.threadId);
        yield* ensureSessionForThread(
          event.payload.threadId,
          event.occurredAt,
          cachedModelSelection !== undefined ? { modelSelection: cachedModelSelection } : {},
        );
        return;
      }
      case "thread.provider-switched":
        yield* processProviderSwitched(event);
        return;
      case "thread.turn-start-requested":
        yield* processTurnStartRequested(event);
        return;
      case "thread.turn-interrupt-requested":
        yield* processTurnInterruptRequested(event);
        return;
      case "thread.agent-stop-requested":
        yield* processAgentStopRequested(event);
        return;
      case "thread.approval-response-requested":
        yield* processApprovalResponseRequested(event);
        return;
      case "thread.user-input-response-requested":
        yield* processUserInputResponseRequested(event);
        return;
      case "thread.session-stop-requested":
        yield* processSessionStopRequested(event);
        return;
      case "thread.settled": {
        const thread = yield* projectionSnapshotQuery.getThreadShellById(event.payload.threadId);
        if (
          Option.isNone(thread) ||
          thread.value.session == null ||
          thread.value.session.status === "stopped"
        ) {
          return;
        }
        yield* orchestrationEngine.dispatch({
          type: "thread.session.stop",
          commandId: CommandId.make(`session-stop-for-settle:${event.commandId ?? event.eventId}`),
          threadId: event.payload.threadId,
          createdAt: event.occurredAt,
          onlyIfSettled: true,
        });
        return;
      }
    }
  });

  const processDomainEventSafely = (event: ProviderIntentEvent) =>
    processDomainEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning("provider command reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processDomainEventSafely);

  const start: ProviderCommandReactorShape["start"] = Effect.fn("start")(function* () {
    const interruptedTitleRegenerations = yield* findInterruptedThreadTitleRegenerations().pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning(
          "provider command reactor failed to find interrupted title regenerations",
          { cause: Cause.pretty(cause) },
        ).pipe(Effect.as([]));
      }),
    );
    const processEvent = Effect.fn("processEvent")(function* (event: OrchestrationEvent) {
      if (
        (event.type === "thread.meta-updated" && event.payload.regenerateTitle === true) ||
        event.type === "thread.runtime-mode-set" ||
        event.type === "thread.provider-switched" ||
        event.type === "thread.turn-start-requested" ||
        event.type === "thread.turn-interrupt-requested" ||
        event.type === "thread.agent-stop-requested" ||
        event.type === "thread.approval-response-requested" ||
        event.type === "thread.user-input-response-requested" ||
        event.type === "thread.session-stop-requested" ||
        event.type === "thread.settled"
      ) {
        return yield* worker.enqueue(event);
      }
    });

    yield* forkParked(Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent));

    // The domain event stream is hot, so work pending before this reactor
    // starts cannot be resumed. Correlated completions only clear the request
    // captured here, leaving any newer request untouched.
    const clearInterrupted = clearInterruptedThreadTitleRegenerations(
      interruptedTitleRegenerations,
    ).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logWarning(
          "provider command reactor failed to clear interrupted title regenerations",
          {
            cause: Cause.pretty(cause),
          },
        );
      }),
    );
    const activation = yield* ServerActivation;
    if (activation === undefined) {
      yield* clearInterrupted;
    } else {
      yield* forkParked(clearInterrupted);
    }
  });

  return {
    start,
    drain: Effect.gen(function* () {
      yield* worker.drain;
      yield* threadTitleRegenerationWorker.drain;
    }),
  } satisfies ProviderCommandReactorShape;
});

export const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make);

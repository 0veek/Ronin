/**
 * ProviderService - Service interface for provider sessions, turns, and checkpoints.
 *
 * Acts as the cross-provider facade used by transports (WebSocket/RPC). It
 * resolves provider adapters through `ProviderAdapterRegistry`, routes
 * session-scoped calls via `ProviderSessionDirectory`, and exposes one unified
 * provider event stream to callers.
 *
 * Uses Effect `Context.Service` for dependency injection and returns typed
 * domain errors for validation, session, codex, and checkpoint workflows.
 *
 * @module ProviderService
 */
import type {
  MessageId,
  ProviderInterruptTurnInput,
  ProviderInstanceId,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderStopAgentInput,
  ProviderStopSessionInput,
  ThreadId,
  ProviderTurnStartResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Stream from "effect/Stream";

import type { ProviderServiceError } from "../Errors.ts";
import type { ProviderAdapterCapabilities } from "./ProviderAdapter.ts";
import type { ProviderInstanceRoutingInfo } from "./ProviderAdapterRegistry.ts";

/**
 * What an instance can still pick up on a thread it is not currently bound to.
 *
 * `resumeCursor` is the provider's own opaque handle (a Codex thread id, a
 * Claude session id + transcript path); `null` means the group has a ledger row
 * but no usable cursor, which is treated the same as never having run.
 */
export interface ProviderContinuationState {
  readonly continuationKey: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly resumeCursor: unknown | null;
  readonly runtimePayload: unknown | null;
  /**
   * Last message this group is known to have processed. The handoff brief uses
   * it to avoid replaying a turn the provider received but never answered.
   */
  readonly lastDeliveredMessageId: MessageId | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

/**
 * ProviderServiceShape - Service API for provider session and turn orchestration.
 */
export interface ProviderServiceShape {
  /**
   * Start a provider session.
   */
  readonly startSession: (
    threadId: ThreadId,
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, ProviderServiceError>;

  /**
   * Send a provider turn.
   */
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, ProviderServiceError>;

  readonly compactThread: (
    threadId: ThreadId,
    modelSelection?: ProviderSendTurnInput["modelSelection"],
    requestId?: MessageId,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Interrupt a running provider turn.
   */
  readonly interruptTurn: (
    input: ProviderInterruptTurnInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Stop one running subagent without interrupting its parent turn.
   *
   * Fails with an unsupported-operation error when the routed provider has no
   * `stopAgent`, so callers can report it instead of guessing at a fallback.
   */
  readonly stopAgent: (input: ProviderStopAgentInput) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Respond to a provider approval request.
   */
  readonly respondToRequest: (
    input: ProviderRespondToRequestInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Respond to a provider structured user-input request.
   */
  readonly respondToUserInput: (
    input: ProviderRespondToUserInputInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Stop a provider session.
   */
  readonly stopSession: (
    input: ProviderStopSessionInput,
  ) => Effect.Effect<void, ProviderServiceError>;

  /**
   * List active provider sessions.
   *
   * Aggregates runtime session lists from all registered adapters.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  /**
   * Read capabilities for the adapter bound to a configured provider instance.
   */
  readonly getCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterCapabilities, ProviderServiceError>;

  readonly getInstanceInfo: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstanceRoutingInfo, ProviderServiceError>;

  /**
   * The resume state an instance left behind on a thread the last time it (or
   * anything in its continuation group) ran there.
   *
   * `Option.none` means the instance has never held a session on this thread,
   * so continuing the conversation there requires handing it a brief rather
   * than resuming native state. Distinct from `getBinding`, which only ever
   * describes the provider currently bound to the thread.
   */
  /**
   * Record that a continuation group has processed everything up to a message.
   *
   * Called once a turn reaches a terminal state that implies the provider
   * ingested its input — completion or interruption, never an error, because an
   * errored start may mean the provider never saw the turn at all. Marking a
   * message the provider did not see would silently drop it from the next
   * handoff brief, which is the one direction that cannot be recovered from.
   */
  readonly recordDeliveredMessage: (input: {
    readonly threadId: ThreadId;
    readonly instanceId: ProviderInstanceId;
    readonly messageId: MessageId;
  }) => Effect.Effect<void, ProviderServiceError>;

  readonly getContinuationState: (input: {
    readonly threadId: ThreadId;
    readonly instanceId: ProviderInstanceId;
  }) => Effect.Effect<Option.Option<ProviderContinuationState>, ProviderServiceError>;

  /**
   * Forget every provider's resume state for a thread. Called when the thread
   * is deleted — the cursors reference provider-side sessions for a
   * conversation that no longer exists.
   */
  readonly clearContinuationLedger: (input: {
    readonly threadId: ThreadId;
  }) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Roll back provider conversation state by a number of turns.
   */
  readonly rollbackConversation: (input: {
    readonly threadId: ThreadId;
    readonly numTurns: number;
  }) => Effect.Effect<void, ProviderServiceError>;

  /**
   * Canonical provider runtime event stream.
   *
   * Fan-out is owned by ProviderService (not by a standalone event-bus service).
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}

/**
 * ProviderService - Service tag for provider orchestration.
 */
export class ProviderService extends Context.Service<ProviderService, ProviderServiceShape>()(
  "t3/provider/Services/ProviderService",
) {}

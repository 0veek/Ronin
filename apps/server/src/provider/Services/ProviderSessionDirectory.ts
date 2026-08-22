import type {
  MessageId,
  ProviderInstanceId,
  ProviderDriverKind,
  ProviderSessionRuntimeStatus,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  ProviderSessionDirectoryPersistenceError,
  ProviderValidationError,
} from "../Errors.ts";

export interface ProviderRuntimeBinding {
  readonly threadId: ThreadId;
  readonly provider: ProviderDriverKind;
  /**
   * Routing key for the configured provider instance that owns this
   * session. The persistence layer promotes legacy null rows before
   * exposing bindings; runtime callers must not infer this from `provider`.
   */
  readonly providerInstanceId?: ProviderInstanceId;
  /**
   * Identity of the group of instances that can resume each other's sessions
   * (`ProviderContinuationIdentity.continuationKey`). Supplying it mirrors the
   * binding into the per-thread ledger, which is what lets a provider that is
   * switched away from and back again resume its own native session instead of
   * starting cold. Optional because callers that only touch the active binding
   * (the reaper marking a session stopped, say) have no reason to resolve it.
   */
  readonly continuationKey?: string;
  readonly adapterKey?: string;
  readonly status?: ProviderSessionRuntimeStatus;
  readonly resumeCursor?: unknown | null;
  readonly runtimePayload?: unknown | null;
  readonly runtimeMode?: RuntimeMode;
}

/**
 * One continuation group's history on a thread: the provider that ran, the
 * cursor it left behind, and when it was last active. `resumeCursor` being
 * present is what distinguishes "this provider can pick up where it left off"
 * from "this provider has to be briefed".
 */
export interface ProviderSessionLedgerEntry {
  readonly threadId: ThreadId;
  readonly continuationKey: string;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly adapterKey: string;
  readonly runtimeMode: RuntimeMode;
  readonly resumeCursor: unknown | null;
  readonly runtimePayload: unknown | null;
  readonly lastDeliveredMessageId: MessageId | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
}

export interface ProviderRuntimeBindingWithMetadata extends ProviderRuntimeBinding {
  readonly lastSeenAt: string;
}

export type ProviderSessionDirectoryReadError = ProviderSessionDirectoryPersistenceError;

export type ProviderSessionDirectoryWriteError =
  | ProviderValidationError
  | ProviderSessionDirectoryPersistenceError;

export interface ProviderSessionDirectoryShape {
  readonly upsert: (
    binding: ProviderRuntimeBinding,
  ) => Effect.Effect<void, ProviderSessionDirectoryWriteError>;

  readonly getProvider: (
    threadId: ThreadId,
  ) => Effect.Effect<ProviderDriverKind, ProviderSessionDirectoryReadError>;

  readonly getBinding: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProviderRuntimeBinding>, ProviderSessionDirectoryReadError>;

  readonly listThreadIds: () => Effect.Effect<
    ReadonlyArray<ThreadId>,
    ProviderSessionDirectoryPersistenceError
  >;

  readonly listBindings: () => Effect.Effect<
    ReadonlyArray<ProviderRuntimeBindingWithMetadata>,
    ProviderSessionDirectoryPersistenceError
  >;

  /**
   * The ledger row for one continuation group on a thread, if that group has
   * ever held a session there. Read on a provider switch to decide between
   * resuming the incoming provider's own session and briefing it from scratch.
   */
  readonly getLedgerEntry: (input: {
    readonly threadId: ThreadId;
    readonly continuationKey: string;
  }) => Effect.Effect<Option.Option<ProviderSessionLedgerEntry>, ProviderSessionDirectoryReadError>;

  /**
   * Move one group's delivery mark — the last message it is known to have
   * processed. Written on its own rather than as part of a binding upsert: the
   * runtime row describes who owns the thread now, and recording what a group
   * finished must not disturb that.
   */
  readonly recordLedgerDelivery: (input: {
    readonly threadId: ThreadId;
    readonly continuationKey: string;
    readonly messageId: MessageId;
  }) => Effect.Effect<void, ProviderSessionDirectoryWriteError>;

  /** Every continuation group that has held a session on the thread. */
  readonly listLedgerEntries: (
    threadId: ThreadId,
  ) => Effect.Effect<ReadonlyArray<ProviderSessionLedgerEntry>, ProviderSessionDirectoryReadError>;

  /**
   * Drop the thread's whole ledger. Called when the thread itself is deleted —
   * the cursors point at provider-side state that is about to become
   * unreachable.
   */
  readonly clearLedger: (
    threadId: ThreadId,
  ) => Effect.Effect<void, ProviderSessionDirectoryWriteError>;
}

export class ProviderSessionDirectory extends Context.Service<
  ProviderSessionDirectory,
  ProviderSessionDirectoryShape
>()("t3/provider/Services/ProviderSessionDirectory") {}

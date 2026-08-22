import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  IsoDateTime,
  MessageId,
  ProviderInstanceId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";

import {
  PersistenceDecodeError,
  type PersistenceErrorCorrelation,
  PersistenceSqlError,
  type ProviderSessionLedgerRepositoryError,
} from "./Errors.ts";

/**
 * ProviderSessionLedgerRepository - every provider continuation group that has
 * ever held a session on a thread, with the resume cursor it last had.
 *
 * `ProviderSessionRuntimeRepository` answers "who owns this thread now"; this
 * answers "who has worked on this thread, and can they pick it back up". The
 * two are written together, so the active group's ledger row always mirrors the
 * runtime row and the inactive ones hold the cursor they had when they were
 * handed away.
 *
 * @module ProviderSessionLedgerRepository
 */
export const ProviderSessionLedgerEntry = Schema.Struct({
  threadId: ThreadId,
  /**
   * Identity of the group of provider instances that can resume each other's
   * sessions on this thread — `ProviderContinuationIdentity.continuationKey`.
   * Not an instance id: two Codex instances sharing a home share one row,
   * because resuming either one recovers the same native session.
   */
  continuationKey: Schema.String,
  providerName: Schema.String,
  /** The instance that most recently wrote this row, for display and auditing. */
  providerInstanceId: ProviderInstanceId,
  adapterKey: Schema.String,
  runtimeMode: RuntimeMode,
  resumeCursor: Schema.NullOr(Schema.Unknown),
  runtimePayload: Schema.NullOr(Schema.Unknown),
  /**
   * Last message this group is known to have processed, so a resumed session is
   * not replayed a turn it received but never answered. Written only once a
   * turn reached a terminal state that implies the provider ingested its input.
   */
  lastDeliveredMessageId: Schema.NullOr(MessageId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
});
export type ProviderSessionLedgerEntry = typeof ProviderSessionLedgerEntry.Type;

export const GetProviderSessionLedgerEntryInput = Schema.Struct({
  threadId: ThreadId,
  continuationKey: Schema.String,
});
export type GetProviderSessionLedgerEntryInput = typeof GetProviderSessionLedgerEntryInput.Type;

export const ListProviderSessionLedgerInput = Schema.Struct({ threadId: ThreadId });
export type ListProviderSessionLedgerInput = typeof ListProviderSessionLedgerInput.Type;

export const MarkProviderSessionLedgerDeliveredInput = Schema.Struct({
  threadId: ThreadId,
  continuationKey: Schema.String,
  messageId: MessageId,
});
export type MarkProviderSessionLedgerDeliveredInput =
  typeof MarkProviderSessionLedgerDeliveredInput.Type;

export const DeleteProviderSessionLedgerInput = Schema.Struct({ threadId: ThreadId });
export type DeleteProviderSessionLedgerInput = typeof DeleteProviderSessionLedgerInput.Type;

export class ProviderSessionLedgerRepository extends Context.Service<
  ProviderSessionLedgerRepository,
  {
    /**
     * Insert or update the row for one `(threadId, continuationKey)` pair.
     *
     * `firstSeenAt` is preserved across updates: it records when this group
     * first touched the thread, which is what the handoff brief uses to explain
     * how far back a returning provider's own memory reaches.
     */
    readonly upsert: (
      entry: ProviderSessionLedgerEntry,
    ) => Effect.Effect<void, ProviderSessionLedgerRepositoryError>;

    readonly get: (
      input: GetProviderSessionLedgerEntryInput,
    ) => Effect.Effect<
      Option.Option<ProviderSessionLedgerEntry>,
      ProviderSessionLedgerRepositoryError
    >;

    /** All groups that have held a session on the thread, newest activity first. */
    readonly listByThreadId: (
      input: ListProviderSessionLedgerInput,
    ) => Effect.Effect<
      ReadonlyArray<ProviderSessionLedgerEntry>,
      ProviderSessionLedgerRepositoryError
    >;

    /**
     * Move one group's delivery mark, touching nothing else on the row.
     *
     * A no-op when the group has no row: a group with no ledger row has no
     * cursor to resume from either, so it will be briefed from scratch and the
     * mark would have nothing to qualify.
     */
    readonly markDelivered: (
      input: MarkProviderSessionLedgerDeliveredInput,
    ) => Effect.Effect<void, ProviderSessionLedgerRepositoryError>;

    readonly deleteByThreadId: (
      input: DeleteProviderSessionLedgerInput,
    ) => Effect.Effect<void, ProviderSessionLedgerRepositoryError>;
  }
>()("t3/persistence/ProviderSessionLedger/ProviderSessionLedgerRepository") {}

const ProviderSessionLedgerDbRowSchema = ProviderSessionLedgerEntry.mapFields(
  Struct.assign({
    resumeCursor: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
    runtimePayload: Schema.NullOr(Schema.fromJsonString(Schema.Unknown)),
  }),
);

const ProviderSessionLedgerRawDbRowSchema = Schema.Struct({
  threadId: Schema.String,
  continuationKey: Schema.Unknown,
  providerName: Schema.Unknown,
  providerInstanceId: Schema.Unknown,
  adapterKey: Schema.Unknown,
  runtimeMode: Schema.Unknown,
  resumeCursor: Schema.Unknown,
  runtimePayload: Schema.Unknown,
  lastDeliveredMessageId: Schema.Unknown,
  firstSeenAt: Schema.Unknown,
  lastSeenAt: Schema.Unknown,
});

const decodeLedgerRow = Schema.decodeUnknownEffect(ProviderSessionLedgerDbRowSchema);

function toPersistenceSqlOrDecodeError(
  sqlOperation: string,
  decodeOperation: string,
  correlation?: PersistenceErrorCorrelation,
) {
  return (cause: unknown): ProviderSessionLedgerRepositoryError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause, correlation)
      : new PersistenceSqlError({
          operation: sqlOperation,
          ...(correlation === undefined ? {} : { correlation }),
          cause,
        });
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertLedgerRow = SqlSchema.void({
    Request: ProviderSessionLedgerDbRowSchema,
    execute: (entry) =>
      sql`
        INSERT INTO provider_session_ledger (
          thread_id,
          continuation_key,
          provider_name,
          provider_instance_id,
          adapter_key,
          runtime_mode,
          resume_cursor_json,
          runtime_payload_json,
          last_delivered_message_id,
          first_seen_at,
          last_seen_at
        )
        VALUES (
          ${entry.threadId},
          ${entry.continuationKey},
          ${entry.providerName},
          ${entry.providerInstanceId},
          ${entry.adapterKey},
          ${entry.runtimeMode},
          ${entry.resumeCursor},
          ${entry.runtimePayload},
          ${entry.lastDeliveredMessageId},
          ${entry.firstSeenAt},
          ${entry.lastSeenAt}
        )
        ON CONFLICT (thread_id, continuation_key)
        DO UPDATE SET
          provider_name = excluded.provider_name,
          provider_instance_id = excluded.provider_instance_id,
          adapter_key = excluded.adapter_key,
          runtime_mode = excluded.runtime_mode,
          resume_cursor_json = excluded.resume_cursor_json,
          runtime_payload_json = excluded.runtime_payload_json,
          last_delivered_message_id = COALESCE(
            excluded.last_delivered_message_id,
            provider_session_ledger.last_delivered_message_id
          ),
          last_seen_at = excluded.last_seen_at
      `,
  });

  const getLedgerRow = SqlSchema.findOneOption({
    Request: GetProviderSessionLedgerEntryInput,
    Result: ProviderSessionLedgerRawDbRowSchema,
    execute: ({ threadId, continuationKey }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          continuation_key AS "continuationKey",
          provider_name AS "providerName",
          provider_instance_id AS "providerInstanceId",
          adapter_key AS "adapterKey",
          runtime_mode AS "runtimeMode",
          resume_cursor_json AS "resumeCursor",
          runtime_payload_json AS "runtimePayload",
          last_delivered_message_id AS "lastDeliveredMessageId",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt"
        FROM provider_session_ledger
        WHERE thread_id = ${threadId} AND continuation_key = ${continuationKey}
      `,
  });

  const listLedgerRowsByThreadId = SqlSchema.findAll({
    Request: ListProviderSessionLedgerInput,
    Result: ProviderSessionLedgerRawDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          continuation_key AS "continuationKey",
          provider_name AS "providerName",
          provider_instance_id AS "providerInstanceId",
          adapter_key AS "adapterKey",
          runtime_mode AS "runtimeMode",
          resume_cursor_json AS "resumeCursor",
          runtime_payload_json AS "runtimePayload",
          last_delivered_message_id AS "lastDeliveredMessageId",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt"
        FROM provider_session_ledger
        WHERE thread_id = ${threadId}
        ORDER BY last_seen_at DESC, continuation_key ASC
      `,
  });

  const markLedgerRowDelivered = SqlSchema.void({
    Request: MarkProviderSessionLedgerDeliveredInput,
    execute: ({ threadId, continuationKey, messageId }) =>
      sql`
        UPDATE provider_session_ledger
        SET last_delivered_message_id = ${messageId}
        WHERE thread_id = ${threadId} AND continuation_key = ${continuationKey}
      `,
  });

  const deleteLedgerRowsByThreadId = SqlSchema.void({
    Request: DeleteProviderSessionLedgerInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM provider_session_ledger
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ProviderSessionLedgerRepository["Service"]["upsert"] = (entry) =>
    upsertLedgerRow(entry).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProviderSessionLedgerRepository.upsert:query",
          "ProviderSessionLedgerRepository.upsert:encodeRequest",
          { threadId: entry.threadId },
        ),
      ),
    );

  const get: ProviderSessionLedgerRepository["Service"]["get"] = (input) =>
    getLedgerRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProviderSessionLedgerRepository.get:query",
          "ProviderSessionLedgerRepository.get:decodeRow",
          { threadId: input.threadId },
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none<ProviderSessionLedgerEntry>()),
          onSome: (row) =>
            decodeLedgerRow(row).pipe(
              Effect.mapError((cause) =>
                PersistenceDecodeError.fromSchemaError(
                  "ProviderSessionLedgerRepository.get:decodeRow",
                  cause,
                  { threadId: input.threadId },
                ),
              ),
              Effect.map(Option.some),
            ),
        }),
      ),
    );

  const listByThreadId: ProviderSessionLedgerRepository["Service"]["listByThreadId"] = (input) =>
    listLedgerRowsByThreadId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProviderSessionLedgerRepository.listByThreadId:query",
          "ProviderSessionLedgerRepository.listByThreadId:decodeRows",
          { threadId: input.threadId },
        ),
      ),
      Effect.flatMap((rows) =>
        // A row written by a newer build (or corrupted cursor JSON) must not
        // make the whole thread unswitchable — the worst case of skipping one
        // is that its provider gets a brief instead of a resume.
        Effect.forEach(rows, (row) =>
          decodeLedgerRow(row).pipe(
            Effect.map(Option.some),
            Effect.catch((cause) =>
              Effect.logWarning("provider.session.ledger.row-skipped", {
                threadId: row.threadId,
                error: PersistenceDecodeError.fromSchemaError(
                  "ProviderSessionLedgerRepository.listByThreadId:decodeRows",
                  cause,
                  { threadId: input.threadId },
                ).message,
              }).pipe(Effect.as(Option.none<ProviderSessionLedgerEntry>())),
            ),
          ),
        ),
      ),
      Effect.map((decoded) =>
        Arr.filterMap(decoded, (row) =>
          Option.isSome(row) ? Result.succeed(row.value) : Result.failVoid,
        ),
      ),
    );

  const markDelivered: ProviderSessionLedgerRepository["Service"]["markDelivered"] = (input) =>
    markLedgerRowDelivered(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProviderSessionLedgerRepository.markDelivered:query",
          "ProviderSessionLedgerRepository.markDelivered:encodeRequest",
          { threadId: input.threadId },
        ),
      ),
    );

  const deleteByThreadId: ProviderSessionLedgerRepository["Service"]["deleteByThreadId"] = (
    input,
  ) =>
    deleteLedgerRowsByThreadId(input).pipe(
      Effect.mapError(
        (cause) =>
          new PersistenceSqlError({
            operation: "ProviderSessionLedgerRepository.deleteByThreadId:query",
            correlation: { threadId: input.threadId },
            cause,
          }),
      ),
    );

  return {
    upsert,
    get,
    listByThreadId,
    markDelivered,
    deleteByThreadId,
  } satisfies ProviderSessionLedgerRepository["Service"];
});

export const layer = Layer.effect(ProviderSessionLedgerRepository, make);

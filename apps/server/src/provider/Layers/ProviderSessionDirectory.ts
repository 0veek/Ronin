import { defaultInstanceIdForDriver, ProviderDriverKind, type ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProviderSessionLedger from "../../persistence/ProviderSessionLedger.ts";
import * as ProviderSessionRuntime from "../../persistence/ProviderSessionRuntime.ts";
import { ProviderSessionDirectoryPersistenceError, ProviderValidationError } from "../Errors.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
  type ProviderRuntimeBindingWithMetadata,
  type ProviderSessionDirectoryShape,
  type ProviderSessionLedgerEntry,
} from "../Services/ProviderSessionDirectory.ts";
const decodeProviderDriverKindValue = Schema.decodeUnknownEffect(ProviderDriverKind);

function toPersistenceError(operation: string) {
  return (cause: unknown) =>
    new ProviderSessionDirectoryPersistenceError({
      operation,
      detail: `Failed to execute ${operation}.`,
      cause,
    });
}

function decodeProviderDriverKind(
  providerName: string,
  operation: string,
): Effect.Effect<ProviderDriverKind, ProviderSessionDirectoryPersistenceError> {
  return decodeProviderDriverKindValue(providerName).pipe(
    Effect.mapError(
      (cause) =>
        new ProviderSessionDirectoryPersistenceError({
          operation,
          detail: `Unknown persisted provider '${providerName}'.`,
          cause,
        }),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeRuntimePayload(
  existing: unknown | null,
  next: unknown | null | undefined,
): unknown | null {
  if (next === undefined) {
    return existing ?? null;
  }
  if (isRecord(existing) && isRecord(next)) {
    return { ...existing, ...next };
  }
  return next;
}

function toRuntimeBinding(
  runtime: ProviderSessionRuntime.ProviderSessionRuntime,
  operation: string,
): Effect.Effect<ProviderRuntimeBindingWithMetadata, ProviderSessionDirectoryPersistenceError> {
  return decodeProviderDriverKind(runtime.providerName, operation).pipe(
    Effect.map(
      (provider) =>
        ({
          threadId: runtime.threadId,
          provider,
          // Migration boundary only: rows written before the instance split
          // have a null provider_instance_id. Promote them as they leave
          // persistence so hot routing code never has to infer an instance
          // from a driver kind.
          providerInstanceId: runtime.providerInstanceId ?? defaultInstanceIdForDriver(provider),
          adapterKey: runtime.adapterKey,
          runtimeMode: runtime.runtimeMode,
          status: runtime.status,
          resumeCursor: runtime.resumeCursor,
          runtimePayload: runtime.runtimePayload,
          lastSeenAt: runtime.lastSeenAt,
        }) satisfies ProviderRuntimeBindingWithMetadata,
    ),
  );
}

function toLedgerEntry(
  row: ProviderSessionLedger.ProviderSessionLedgerEntry,
  operation: string,
): Effect.Effect<ProviderSessionLedgerEntry, ProviderSessionDirectoryPersistenceError> {
  return decodeProviderDriverKind(row.providerName, operation).pipe(
    Effect.map(
      (provider) =>
        ({
          threadId: row.threadId,
          continuationKey: row.continuationKey,
          provider,
          providerInstanceId: row.providerInstanceId,
          adapterKey: row.adapterKey,
          runtimeMode: row.runtimeMode,
          resumeCursor: row.resumeCursor,
          runtimePayload: row.runtimePayload,
          firstSeenAt: row.firstSeenAt,
          lastSeenAt: row.lastSeenAt,
        }) satisfies ProviderSessionLedgerEntry,
    ),
  );
}

const makeProviderSessionDirectory = Effect.gen(function* () {
  const repository = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
  const ledgerRepository = yield* ProviderSessionLedger.ProviderSessionLedgerRepository;

  const getBinding = (threadId: ThreadId) =>
    repository.getByThreadId({ threadId }).pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.getBinding:getByThreadId")),
      Effect.flatMap((runtime) =>
        Option.match(runtime, {
          onNone: () => Effect.succeed(Option.none<ProviderRuntimeBinding>()),
          onSome: (value) =>
            toRuntimeBinding(value, "ProviderSessionDirectory.getBinding").pipe(
              Effect.map((binding) => Option.some(binding)),
            ),
        }),
      ),
    );

  const upsert: ProviderSessionDirectoryShape["upsert"] = Effect.fn(function* (binding) {
    const existing = yield* repository
      .getByThreadId({ threadId: binding.threadId })
      .pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:getByThreadId")));

    const existingRuntime = Option.getOrUndefined(existing);
    const resolvedThreadId = binding.threadId ?? existingRuntime?.threadId;
    if (!resolvedThreadId) {
      return yield* new ProviderValidationError({
        operation: "ProviderSessionDirectory.upsert",
        issue: "threadId must be a non-empty string.",
      });
    }

    const now = DateTime.formatIso(yield* DateTime.now);
    const providerChanged =
      existingRuntime !== undefined && existingRuntime.providerName !== binding.provider;
    const providerInstanceId =
      binding.providerInstanceId ?? (!providerChanged ? existingRuntime?.providerInstanceId : null);
    if (providerInstanceId === null || providerInstanceId === undefined) {
      return yield* new ProviderValidationError({
        operation: "ProviderSessionDirectory.upsert",
        issue: "providerInstanceId is required for provider session runtime bindings.",
      });
    }
    const adapterKey =
      binding.adapterKey ??
      (providerChanged ? binding.provider : (existingRuntime?.adapterKey ?? binding.provider));
    const runtimeMode = binding.runtimeMode ?? existingRuntime?.runtimeMode ?? "full-access";
    const resumeCursor =
      binding.resumeCursor !== undefined
        ? binding.resumeCursor
        : (existingRuntime?.resumeCursor ?? null);
    const runtimePayload = mergeRuntimePayload(
      existingRuntime?.runtimePayload ?? null,
      binding.runtimePayload,
    );
    yield* repository
      .upsert({
        threadId: resolvedThreadId,
        providerName: binding.provider,
        providerInstanceId,
        adapterKey,
        runtimeMode,
        status: binding.status ?? existingRuntime?.status ?? "running",
        lastSeenAt: now,
        resumeCursor,
        runtimePayload,
      })
      .pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:upsert")));

    // Mirror into the ledger so this continuation group keeps its cursor even
    // after the thread is handed to another provider, which overwrites the
    // single runtime row. Callers that cannot resolve a continuation key skip
    // the mirror rather than guessing one — a wrong key would let an instance
    // resume a session that isn't its own.
    if (binding.continuationKey !== undefined) {
      yield* ledgerRepository
        .upsert({
          threadId: resolvedThreadId,
          continuationKey: binding.continuationKey,
          providerName: binding.provider,
          providerInstanceId,
          adapterKey,
          runtimeMode,
          resumeCursor,
          runtimePayload,
          // Ignored on conflict — the stored value is when this group first
          // touched the thread, which no later write should move.
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.upsert:ledgerUpsert")));
    }
  });

  const getLedgerEntry: ProviderSessionDirectoryShape["getLedgerEntry"] = (input) =>
    ledgerRepository.get(input).pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.getLedgerEntry:get")),
      Effect.flatMap((row) =>
        Option.match(row, {
          onNone: () => Effect.succeed(Option.none<ProviderSessionLedgerEntry>()),
          onSome: (value) =>
            toLedgerEntry(value, "ProviderSessionDirectory.getLedgerEntry").pipe(
              Effect.map(Option.some),
            ),
        }),
      ),
    );

  const listLedgerEntries: ProviderSessionDirectoryShape["listLedgerEntries"] = (threadId) =>
    ledgerRepository.listByThreadId({ threadId }).pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.listLedgerEntries:list")),
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (row) =>
          toLedgerEntry(row, "ProviderSessionDirectory.listLedgerEntries"),
        ),
      ),
    );

  const clearLedger: ProviderSessionDirectoryShape["clearLedger"] = (threadId) =>
    ledgerRepository
      .deleteByThreadId({ threadId })
      .pipe(Effect.mapError(toPersistenceError("ProviderSessionDirectory.clearLedger:delete")));

  const getProvider: ProviderSessionDirectoryShape["getProvider"] = (threadId) =>
    getBinding(threadId).pipe(
      Effect.flatMap((binding) =>
        Option.match(binding, {
          onSome: (value) => Effect.succeed(value.provider),
          onNone: () =>
            Effect.fail(
              new ProviderSessionDirectoryPersistenceError({
                operation: "ProviderSessionDirectory.getProvider",
                detail: `No persisted provider binding found for thread '${threadId}'.`,
              }),
            ),
        }),
      ),
    );

  const listThreadIds: ProviderSessionDirectoryShape["listThreadIds"] = () =>
    repository.list().pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.listThreadIds:list")),
      Effect.map((rows) => rows.map((row) => row.threadId)),
    );

  const listBindings: ProviderSessionDirectoryShape["listBindings"] = () =>
    repository.list().pipe(
      Effect.mapError(toPersistenceError("ProviderSessionDirectory.listBindings:list")),
      Effect.flatMap((rows) =>
        Effect.forEach(
          rows,
          (row) => toRuntimeBinding(row, "ProviderSessionDirectory.listBindings"),
          { concurrency: "unbounded" },
        ),
      ),
    );

  return {
    upsert,
    getProvider,
    getBinding,
    listThreadIds,
    listBindings,
    getLedgerEntry,
    listLedgerEntries,
    clearLedger,
  } satisfies ProviderSessionDirectoryShape;
});

export const ProviderSessionDirectoryLive = Layer.effect(
  ProviderSessionDirectory,
  makeProviderSessionDirectory,
);

export function makeProviderSessionDirectoryLive() {
  return Layer.effect(ProviderSessionDirectory, makeProviderSessionDirectory);
}

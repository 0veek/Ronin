import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";
import {
  ProviderSessionLedgerRepository,
  layer as ProviderSessionLedgerRepositoryLive,
  type ProviderSessionLedgerEntry,
} from "./ProviderSessionLedger.ts";

const THREAD = ThreadId.make("thread-ledger");
const CODEX_KEY = "codex:home:/home/dev/.codex";
const CLAUDE_KEY = "claudeAgent:instance:claude-work";

function entry(overrides: Partial<ProviderSessionLedgerEntry> = {}): ProviderSessionLedgerEntry {
  return {
    threadId: THREAD,
    continuationKey: CODEX_KEY,
    providerName: "codex",
    providerInstanceId: ProviderInstanceId.make("codex-personal"),
    adapterKey: "codex",
    runtimeMode: "full-access",
    resumeCursor: { sessionId: "codex-session-1" },
    runtimePayload: null,
    firstSeenAt: "2026-03-01T00:00:00.000Z",
    lastSeenAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

const ledgerLayer = it.layer(
  Layer.mergeAll(
    ProviderSessionLedgerRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

ledgerLayer("ProviderSessionLedgerRepository", (it) => {
  it.effect("round-trips a cursor and pins firstSeenAt across updates", () =>
    Effect.gen(function* () {
      const ledger = yield* ProviderSessionLedgerRepository;

      yield* ledger.upsert(entry());
      yield* ledger.upsert(
        entry({
          resumeCursor: { sessionId: "codex-session-2" },
          runtimePayload: { home: "/home/dev/.codex" },
          // A later write claims an earlier first-seen; the stored value wins,
          // because the brief explains how far back the group's own memory
          // reaches and that boundary must not drift.
          firstSeenAt: "2026-03-05T00:00:00.000Z",
          lastSeenAt: "2026-03-05T00:00:00.000Z",
        }),
      );

      const stored = yield* ledger.get({ threadId: THREAD, continuationKey: CODEX_KEY });
      const row = Option.getOrNull(stored);
      assert.deepStrictEqual(row?.resumeCursor, { sessionId: "codex-session-2" });
      assert.deepStrictEqual(row?.runtimePayload, { home: "/home/dev/.codex" });
      assert.strictEqual(row?.firstSeenAt, "2026-03-01T00:00:00.000Z");
      assert.strictEqual(row?.lastSeenAt, "2026-03-05T00:00:00.000Z");
    }),
  );

  it.effect("keeps the handed-away group's cursor when another group takes over", () =>
    Effect.gen(function* () {
      const ledger = yield* ProviderSessionLedgerRepository;

      // This is the regression the ledger exists for: the single runtime row is
      // overwritten on a switch, so without a per-group record Codex's cursor
      // would be gone and switching back would cost its native memory.
      yield* ledger.upsert(entry({ lastSeenAt: "2026-03-01T00:00:00.000Z" }));
      yield* ledger.upsert(
        entry({
          continuationKey: CLAUDE_KEY,
          providerName: "claudeAgent",
          providerInstanceId: ProviderInstanceId.make("claude-work"),
          adapterKey: "claudeAgent",
          resumeCursor: { sessionId: "claude-session-1" },
          firstSeenAt: "2026-03-02T00:00:00.000Z",
          lastSeenAt: "2026-03-02T00:00:00.000Z",
        }),
      );

      const codex = yield* ledger.get({ threadId: THREAD, continuationKey: CODEX_KEY });
      assert.deepStrictEqual(Option.getOrNull(codex)?.resumeCursor, {
        sessionId: "codex-session-1",
      });

      // Newest activity first: the list is read to decide who can resume.
      const rows = yield* ledger.listByThreadId({ threadId: THREAD });
      assert.deepStrictEqual(
        rows.map((row) => row.continuationKey),
        [CLAUDE_KEY, CODEX_KEY],
      );
    }),
  );

  it.effect("scopes reads and deletes to one thread", () =>
    Effect.gen(function* () {
      const ledger = yield* ProviderSessionLedgerRepository;
      const otherThread = ThreadId.make("thread-other");

      yield* ledger.upsert(entry());
      yield* ledger.upsert(entry({ threadId: otherThread }));

      const missing = yield* ledger.get({
        threadId: THREAD,
        continuationKey: "codex:instance:never-ran",
      });
      assert.ok(Option.isNone(missing));

      yield* ledger.deleteByThreadId({ threadId: THREAD });
      assert.deepStrictEqual(yield* ledger.listByThreadId({ threadId: THREAD }), []);
      assert.strictEqual((yield* ledger.listByThreadId({ threadId: otherThread })).length, 1);
    }),
  );

  it.effect("skips an undecodable row instead of failing the whole read", () =>
    Effect.gen(function* () {
      const ledger = yield* ProviderSessionLedgerRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* ledger.upsert(entry());
      // A cursor written by a newer build, or truncated on disk. Failing here
      // would make the thread unswitchable; skipping costs one brief.
      yield* sql`
        INSERT INTO provider_session_ledger (
          thread_id, continuation_key, provider_name, provider_instance_id,
          adapter_key, runtime_mode, resume_cursor_json, runtime_payload_json,
          first_seen_at, last_seen_at
        ) VALUES (
          ${THREAD}, ${CLAUDE_KEY}, 'claudeAgent', 'claude-work',
          'claudeAgent', 'full-access', '{not json', NULL,
          '2026-03-02T00:00:00.000Z', '2026-03-02T00:00:00.000Z'
        )
      `;

      const rows = yield* ledger.listByThreadId({ threadId: THREAD });
      assert.deepStrictEqual(
        rows.map((row) => row.continuationKey),
        [CODEX_KEY],
      );
    }),
  );
});

/**
 * Adds `provider_session_ledger`: the per-thread record of every provider
 * continuation group that has ever held a session on that thread.
 *
 * `provider_session_runtime` is keyed by `thread_id` alone, so it can only
 * describe the provider that owns the thread *right now*. Handing a thread from
 * one provider to another and back again used to destroy the first provider's
 * resume cursor on the way out, which is why a switch could not be undone
 * without losing the provider's native memory of the conversation.
 *
 * The ledger is keyed by `(thread_id, continuation_key)` — the continuation key
 * being the group of instances that can resume each other's sessions (see
 * `ProviderContinuationIdentity`). Instances that share a Codex home share a
 * row; instances that cannot resume each other never collide. Rows are written
 * alongside every `provider_session_runtime` upsert, so the active provider's
 * ledger row is always current and the inactive ones keep the cursor they had
 * when they were last active.
 *
 * The runtime table is deliberately left alone: it is on the hot routing path
 * and re-keying it would make every session lookup a two-column query for the
 * benefit of a feature that only reads on a switch.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS provider_session_ledger (
      thread_id TEXT NOT NULL,
      continuation_key TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      adapter_key TEXT NOT NULL,
      runtime_mode TEXT NOT NULL DEFAULT 'full-access',
      resume_cursor_json TEXT,
      runtime_payload_json TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, continuation_key)
    )
  `;

  // Reading the ledger is always "what has run on this thread", so the primary
  // key's leading column already serves it. The extra index covers the reverse
  // question — "which threads has this instance touched" — used when an
  // instance is removed from settings and its ledger rows go stale.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_ledger_instance
    ON provider_session_ledger(provider_instance_id)
  `;

  // Backfill the currently bound provider so threads that predate the ledger
  // can still resume their own session after being handed away and back. The
  // continuation key is reconstructed from the driver/instance pair, which is
  // the default identity every driver except Codex uses. Codex instances that
  // share a home resolve to a shared key at runtime and will simply write a
  // fresh row on their next session — a missed backfill costs one brief, not
  // correctness.
  yield* sql`
    INSERT OR IGNORE INTO provider_session_ledger (
      thread_id,
      continuation_key,
      provider_name,
      provider_instance_id,
      adapter_key,
      runtime_mode,
      resume_cursor_json,
      runtime_payload_json,
      first_seen_at,
      last_seen_at
    )
    SELECT
      thread_id,
      provider_name || ':instance:' || COALESCE(provider_instance_id, provider_name),
      provider_name,
      COALESCE(provider_instance_id, provider_name),
      adapter_key,
      runtime_mode,
      resume_cursor_json,
      runtime_payload_json,
      last_seen_at,
      last_seen_at
    FROM provider_session_runtime
  `;
});

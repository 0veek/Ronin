# Provider architecture

> For maintainers. Using Ronin? See [docs/user](../user/).

A provider is the agent runtime that does the actual work. Ronin supports several, and the
orchestration layer does not know which one is behind a thread.

## Built-in drivers

[`builtInDrivers.ts`][drivers] exports `BUILT_IN_DRIVERS` with nine entries:

| Driver kind   | Driver source                                 |
| ------------- | --------------------------------------------- |
| `codex`       | [`Drivers/CodexDriver.ts`][codex]             |
| `claudeAgent` | [`Drivers/ClaudeDriver.ts`][claude]           |
| `cursor`      | [`Drivers/CursorDriver.ts`][cursor]           |
| `grok`        | [`Drivers/GrokDriver.ts`][grok]               |
| `opencode`    | [`Drivers/OpenCodeDriver.ts`][opencode]       |
| `antigravity` | [`Drivers/AntigravityDriver.ts`][antigravity] |
| `droid`       | [`Drivers/DroidDriver.ts`][droid]             |
| `kilo`        | [`Drivers/KiloDriver.ts`][kilo]               |
| `pi`          | [`Drivers/PiDriver.ts`][pi]                   |

Each driver declares its `driverKind`, a `configSchema`, and a `create` function that builds an
adapter in a child scope. Adapter implementations live beside them in
`apps/server/src/provider/Layers/` (`CodexAdapter.ts`, `ClaudeAdapter.ts`, and so on) and conform to
[`ProviderAdapter.ts`][adapter]. Read the driver plus its adapter to see how a specific agent's
transport, config, and event shapes are mapped.

## Codex async questions

Codex 0.153 exposes `request_user_input_async` through `item/started` and `item/completed`
notifications. The item has `type: "agentMessage"`, `delivery: "async"`, and a `questions` array.
Each question has a `title` and an optional `options` array of strings. The tool returns `{"accepted":true}`
without waiting. This is separate from the `item/tool/requestUserInput` server request.
See the [Codex tool handler](https://github.com/openai/codex/blob/d979df154cf60e13eafb5453e75b6d84f21c67bf/codex-rs/core/src/tools/handlers/request_user_input_async.rs).

The Codex adapter maps completed question items to `user-input.requested` with
`responseMode: "message"` and stable request and event IDs. Questions use the existing web,
desktop, and mobile panels. They stay pending while the turn runs and after it finishes.

The engine reads the request's latest stored activity before deciding a reply. This works after
startup, when the command snapshot has no activities, and after a resolution leaves the recent
activity window. The query returns one activity, not the full thread history.

For these requests, the decider saves the resolution and a user message in one transaction.
The standard turn path delivers the message, including session resume and active-turn input.
It does not send a JSON-RPC response to Codex. Other providers and blocking Codex questions
keep their existing response paths.

## Registry and routing

Two registries separate configuration from live processes:

- [`ProviderInstanceRegistry`][instances] keys configured instances by `ProviderInstanceId`. Creating
  one looks up the driver by `driverKind`, decodes `entry.config` with that driver's schema, opens a
  child scope, and calls `driver.create`.
- [`ProviderAdapterRegistry`][registry] resolves an instance ID to its live adapter via
  `getByInstance`.

[`ProviderService`][service] sits on top. It combines the adapter registry with the provider session
directory to route session and turn operations for a thread, so callers name a thread, not an agent.

`ProviderService.sendTurn` expands [assistant citations](./assistant-citations.md) into quoted
reference data before dispatching to any adapter. Bound user comments remain distinct from the quoted
assistant text. Persisted messages keep their serialized links.

Adding a driver means writing the driver plus adapter and adding it to `BUILT_IN_DRIVERS`. No
orchestration, contract, or client change is required for the common case.

## OpenCode server ownership and catalog

Each OpenCode provider instance owns one lazy local server for catalog discovery and
text-generation helpers through [`OpenCodeServerOwner.ts`][opencode-server-owner]. Concurrent
borrowers share startup. The server closes 30 seconds after the last borrower releases it, or
when the provider instance closes. A failed or exited process can be started again on the next
use. An externally configured OpenCode server remains externally owned.

The local server and its SDK clients use one resolved password. An explicit provider password
overrides `OPENCODE_SERVER_PASSWORD` in the spawned environment. Without an explicit password,
the client uses the password from the environment that the process inherits. External servers use
only their explicit provider password and never inherit the host's local password.

Every server connection must pass the authenticated `/global/health` check before inventory or
session operations start. The response must contain a valid version at or above 1.14.19. Local
owners cache this result for the lifetime of the spawned process. External actions check once when
they create their server connection, not for each model or SDK request.

Chat adapters keep their own server per thread. They register a thread-specific `t3-code` MCP
connection, while OpenCode stores MCP connections by directory. Sharing these chat servers
without changing MCP routing would let two threads in one directory replace each other's
connection.

Chat adapters send the runtime mode as a session ruleset, but upstream OpenCode evaluates
doom-loop and subagent asks against the agent ruleset only. In full access the adapter answers
those asks itself so the user never sees an approval they already granted. It replies `once`
rather than `always` because OpenCode stores `always` grants per directory, and on a shared
external server that would widen what a supervised thread in the same directory may do.

OpenCode loads its catalog through the HTTP API when an enabled provider instance starts. The
provider registry keeps the snapshot in memory and persists it in the existing per-instance cache.
Each `subscribeServerConfig` connection refreshes all providers, so a client reconnect reloads the
OpenCode catalog from the current helper. The `serverRefreshProviders` request also refreshes it.
Periodic OpenCode probes remain disabled. OpenCode reads credentials for each inventory request,
but its native configuration files can remain cached for the lifetime of the helper process. The
helper closes 30 seconds after its last inventory or text-generation borrower releases it. A
refresh after that idle period starts a new helper and reads file changes. Repeated refreshes and
active text-generation work can extend process reuse. Changes to the provider configuration or
environment replace the instance and start a new discovery. Changes to unrelated settings only
update snapshot enrichment. Other providers retain their existing refresh policy.

T3 Code does not own an external OpenCode process. Native configuration changes there can require
an external reload or restart before T3 Code's next refresh sees them.

The shared server's idle shutdown does not clear the catalog. Failed discovery keeps the last
known models, slash commands, and skills through the registry's existing merge rules. A successful
empty inventory is authoritative. Existing threads keep their explicit model identifier and
options when catalog metadata is missing; the catalog is not permission to choose a different
model for a thread.

## Model manifest

The model picker's legacy section is driven by `apps/server/src/provider/model-manifest.json`, which
lists the current (non-legacy) model slugs per driver kind. The `ModelManifest` service
(`apps/server/src/provider/ModelManifest.ts`) refreshes that data from the same file on this
repository's `main` via raw.githubusercontent.com, so moving a model in or out of the legacy section
is a commit, not a release. Preference order is remote fetch, then the on-disk copy of the last
successful fetch (in the state directory), then the bundled copy. Fetches are TTL-gated, run
concurrently with provider probes, respect the `enableProviderUpdateChecks` setting, and never fail
a provider check. The Codex and Claude drivers apply the classification to every snapshot with
`applyModelManifest`; driver kinds absent from the manifest have no legacy concept.

## Attachment access

The server stores uploaded attachments in its attachment directory, outside the project workspace.
`ProviderService` adds the absolute path of each attachment to the turn text, then passes every
attachment to the provider adapter. Each adapter decides what its provider ingests natively:

- Codex, Claude, Cursor, and Grok send images as native image inputs and skip generic files. For
  these providers, generic files reach the agent only as file paths in the turn text.
- OpenCode sends PNG/JPEG/GIF/WebP images, text files, and PDFs up to 20 MB as native file parts
  with their real mime type. Everything else (ZIP and other binaries, image formats model APIs
  reject, oversized files) falls back to the file path in the turn text, like the other providers.

Claude receives the attachment directory as an allowed additional directory. Codex keeps its
configured sandbox policy, so access depends on that policy and the selected runtime mode. OpenCode
allows all paths in full-access mode and requests approval for directories outside the workspace in
restricted modes. Cursor and Grok use their own provider permission rules.

The server does not copy attachments into a project or bypass provider approval rules. If an agent
cannot read an attachment, the user must approve the access or select a runtime mode that permits it.

Updated attachment schemas tolerate unknown attachment members, but old image-only clients still
cannot decode messages that contain file attachments. Client file-picking rollouts must account for
this limit.

Do not run an old image-only server against state that contains file attachments. Replay decodes
each persisted event before projection. A file-bearing event can make `ProjectionPipeline` bootstrap
and `OrchestrationEngine` startup fail for the entire environment, not only the affected thread.

## How provider work is requested

Clients never call a provider directly. They dispatch orchestration commands over the RPC method
`orchestration.dispatchCommand`, defined with the rest of the orchestration surface in
[`orchestration.ts`][contracts]. The client-dispatchable provider-facing commands are
`thread.turn.start`, `thread.turn.interrupt`, `thread.approval.respond`,
`thread.user-input.respond`, `thread.checkpoint.revert`, and `thread.session.stop`, plus the mode
setters `thread.runtime-mode.set` and `thread.interaction-mode.set`.

The engine persists an event for the command, and a server-side reactor performs the provider call.
Provider output comes back as internal commands such as `thread.message.assistant.delta` and
`thread.session.set`, which clients observe through `orchestration.subscribeThread`. See
[overview.md](./overview.md) for the command/event loop.

## Switching provider mid-thread

A thread can be handed from one provider to another while keeping its conversation. The client
dispatches `thread.provider.switch` (target instance **and** model — every instance has its own model
namespace), and the incoming provider picks the thread up on the next turn.

### Continuation groups

Two instances belong to the same _continuation group_ when either can resume the other's native
session. [`ProviderContinuationIdentity`][driver] carries the key: the default is
`${driverKind}:instance:${instanceId}`, and Codex overrides it to `codex:home:${sharedHomePath}` so
instances sharing a home share one key. `ServerProvider.continuation.groupKey` is the client-visible
form — the picker uses it to tell a restart (same group, no confirmation) from a handoff (different
group, confirm first).

### The ledger

[`provider_session_ledger`][ledger] holds one row per `(thread_id, continuation_key)` with that
group's resume cursor. `provider_session_runtime` is keyed by thread alone and so can only describe
the provider that owns the thread _right now_; switching away used to overwrite it and destroy the
outgoing provider's cursor, which is why a switch could not be undone. Both tables are written
together in [`ProviderSessionDirectory.upsert`][directory], so the active group's ledger row mirrors
the runtime row and inactive ones keep the cursor they had when they were handed away. Migration
[`041`][migration] backfills the currently bound provider, and `firstSeenAt` is pinned across
updates — it is what the brief uses to say how far back a returning provider's own memory reaches.

`last_delivered_message_id` (migration [`049`][migration049]) is the one column a binding write must
not touch: it records what the group actually processed, which only turn completion knows.
`ProviderSessionDirectory.upsert` always writes null there and the row keeps whatever mark it had;
`recordLedgerDelivery` is the single path that moves it.

### Invariants

The decider ([`decider.ts`][decider], `thread.provider.switch`) rejects a switch when the thread has
a `starting`/`running` session, an open approval or user-input request, or a queued turn start —
each would strand work in flight against a session the thread is about to give up. It also rejects a
same-instance retarget, which is `thread.meta.update`'s job. A `stopped` session is read as history,
not as the current binding, so switching back to where the thread started is allowed.

### Handover

[`ProviderCommandReactor`][cmd] stops the outgoing session, marks it `stopped`, and records a
`provider.switched` activity — the transcript boundary. Nothing else happens until the next turn,
where `ensureSessionForThread` resolves one of three continuities:

| Continuity | Meaning                                      | Brief                  |
| ---------- | -------------------------------------------- | ---------------------- |
| `live`     | Session already running, followed everything | none                   |
| `resumed`  | Started from this group's own ledger cursor  | only what it missed    |
| `fresh`    | No provider-side memory of the thread        | the whole conversation |

[`providerHandoffContext.ts`][briefcontext] folds the read model into the shape the brief renders —
per-turn work logs from `tool.completed` / `tool.denied` / `runtime.error` activities, thread-level
notices (a compaction, a denied approval, a failed revert), attachment names, per-file churn from
the thread's ready checkpoints, and the standing proposed plan. [`providerHandoffBrief.ts`][brief]
renders it: pure, deterministic, no queries and no model call, so an interrupted or retried turn
rebuilds the same brief.

`selectHandoffMessages` cuts a resumed provider's brief at the later of two marks — the last message
authored by its own continuation group, and the group's ledger delivery mark — and replays
everything when the thread has no message it can claim. Seeing a turn twice is recoverable, never
seeing it is not, so the delivery mark is written only once a turn reaches a non-failed terminal
state, which is what proves the provider ingested its input. That is what stops an interrupted turn
(received, never answered, so invisible to authorship) from being handed back a second time.

The full-fidelity window sizes itself to the budget rather than sitting at a fixed count: between
six and twenty-four recent turns go over verbatim, everything older collapses to one-line bullets so
a long thread keeps a sketch of how it got here instead of a hole, and when reconstructing cold the
original request and the plan of record are pinned out of that sequence entirely — compression works
oldest-first, and without pinning the first thing a long thread loses is the thing it was asked to
do. Bodies that have to be cut keep their opening _and_ their conclusion, land on line boundaries,
and close any code fence the cut left open. The budget is the smallest of the wire cap, the
adapter's `maxHandoffBriefChars` capability, and what the envelope leaves over. No adapter
currently sets `maxHandoffBriefChars` — the hook is there for a provider whose context window is
too small for the wire cap, and until one declares a number the wire cap is the only ceiling.

The brief is wrapped in `<handoff_context>` and the user's actual request in `<latest_user_message>`
so the incoming model can tell background from the thing it has to answer. A `provider.handoff`
activity records `resumed` vs `briefed`, the brief size, and how the conversation was carried —
messages sent in full, summarized, and left out — which the transcript boundary shows so "trimmed"
does not leave the user guessing whether the new provider lost formatting or half the thread. Both
activities carry `turnId: null` so they render as transcript boundaries rather than folding into a
turn's work log.

## Server-side workers

Provider work flows through three queue-backed workers. All three are built with
`makeDrainableWorker` from [`DrainableWorker.ts`][worker] and expose `drain` for deterministic test
synchronization.

1. [`ProviderRuntimeIngestion`][ingest] consumes provider runtime streams and emits orchestration
   commands.
2. [`ProviderCommandReactor`][cmd] reacts to orchestration intent events and dispatches provider
   calls.
3. [`CheckpointReactor`][checkpoint] captures workspace checkpoints on turn start and completion, and
   performs reverts.

### Buffered assistant delivery

A thread in `buffered` assistant delivery mode accumulates assistant text instead of streaming each
delta. The buffer is not held until turn completion. In [`ProviderRuntimeIngestion`][ingest],
`MAX_BUFFERED_ASSISTANT_CHARS` is 24,000: the append that would exceed it invalidates the buffer and
spills the whole accumulated text as one delta. The buffer also flushes at interaction boundaries,
when a request opens (approval) or user input is requested, via
`flushBufferedAssistantMessagesForTurn`.

[drivers]: ../../apps/server/src/provider/builtInDrivers.ts
[codex]: ../../apps/server/src/provider/Drivers/CodexDriver.ts
[claude]: ../../apps/server/src/provider/Drivers/ClaudeDriver.ts
[cursor]: ../../apps/server/src/provider/Drivers/CursorDriver.ts
[grok]: ../../apps/server/src/provider/Drivers/GrokDriver.ts
[opencode]: ../../apps/server/src/provider/Drivers/OpenCodeDriver.ts
[antigravity]: ../../apps/server/src/provider/Drivers/AntigravityDriver.ts
[droid]: ../../apps/server/src/provider/Drivers/DroidDriver.ts
[kilo]: ../../apps/server/src/provider/Drivers/KiloDriver.ts
[pi]: ../../apps/server/src/provider/Drivers/PiDriver.ts
[opencode-server-owner]: ../../apps/server/src/provider/OpenCodeServerOwner.ts
[adapter]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[driver]: ../../apps/server/src/provider/ProviderDriver.ts
[ledger]: ../../apps/server/src/persistence/ProviderSessionLedger.ts
[directory]: ../../apps/server/src/provider/Layers/ProviderSessionDirectory.ts
[migration]: ../../apps/server/src/persistence/Migrations/041_ProviderSessionLedger.ts
[migration049]: ../../apps/server/src/persistence/Migrations/049_ProviderSessionLedgerDelivery.ts
[decider]: ../../apps/server/src/orchestration/decider.ts
[brief]: ../../apps/server/src/orchestration/providerHandoffBrief.ts
[briefcontext]: ../../apps/server/src/orchestration/providerHandoffContext.ts
[instances]: ../../apps/server/src/provider/Services/ProviderInstanceRegistry.ts
[registry]: ../../apps/server/src/provider/Services/ProviderAdapterRegistry.ts
[service]: ../../apps/server/src/provider/Layers/ProviderService.ts
[contracts]: ../../packages/contracts/src/orchestration.ts
[worker]: ../../packages/shared/src/DrainableWorker.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[cmd]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[checkpoint]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts

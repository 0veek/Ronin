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

## Registry and routing

Two registries separate configuration from live processes:

- [`ProviderInstanceRegistry`][instances] keys configured instances by `ProviderInstanceId`. Creating
  one looks up the driver by `driverKind`, decodes `entry.config` with that driver's schema, opens a
  child scope, and calls `driver.create`.
- [`ProviderAdapterRegistry`][registry] resolves an instance ID to its live adapter via
  `getByInstance`.

[`ProviderService`][service] sits on top. It combines the adapter registry with the provider session
directory to route session and turn operations for a thread, so callers name a thread, not an agent.

Adding a driver means writing the driver plus adapter and adding it to `BUILT_IN_DRIVERS`. No
orchestration, contract, or client change is required for the common case.

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

[`providerHandoffBrief.ts`][brief] renders it: pure, deterministic, no queries and no model call, so
an interrupted or retried turn rebuilds the same brief. `selectHandoffMessages` cuts a resumed
provider's brief at the last message authored by its own group, and replays everything when the
thread has no message it can claim — seeing a turn twice is recoverable, never seeing it is not. The
last six turns stay in full; everything older collapses to one-line bullets so a long thread keeps a
sketch of how it got here instead of a hole. The brief is wrapped in `<handoff_context>` and the
user's actual request in `<latest_user_message>` so the incoming model can tell background from the
thing it has to answer. A `provider.handoff` activity records `resumed` vs `briefed` along with the
brief size and whether it had to be trimmed. Both activities carry `turnId: null` so they render as
transcript boundaries rather than folding into a turn's work log.

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
[adapter]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[driver]: ../../apps/server/src/provider/ProviderDriver.ts
[ledger]: ../../apps/server/src/persistence/ProviderSessionLedger.ts
[directory]: ../../apps/server/src/provider/Layers/ProviderSessionDirectory.ts
[migration]: ../../apps/server/src/persistence/Migrations/041_ProviderSessionLedger.ts
[decider]: ../../apps/server/src/orchestration/decider.ts
[brief]: ../../apps/server/src/orchestration/providerHandoffBrief.ts
[instances]: ../../apps/server/src/provider/Services/ProviderInstanceRegistry.ts
[registry]: ../../apps/server/src/provider/Services/ProviderAdapterRegistry.ts
[service]: ../../apps/server/src/provider/Layers/ProviderService.ts
[contracts]: ../../packages/contracts/src/orchestration.ts
[worker]: ../../packages/shared/src/DrainableWorker.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[cmd]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[checkpoint]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts

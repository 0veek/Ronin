# Orchestration V2 in Ronin

Ronin uses the upstream V2 execution engine while keeping its existing desktop renderer,
WebSocket commands, and thread read models. The source baseline is T3 Code
`ee7b49d638e412590b09b415cc48399d51644b60`, including the original V2 change
`de343914273eceb852a1d1d739cd1d38df7796ee`. The upstream V2 chat UI and native V2 adapters
are outside this migration.

## Command and event flow

The existing `OrchestrationEngineService` still accepts client commands and produces the
read models consumed by `orchestration.subscribeShell` and `orchestration.subscribeThread`.
`ProviderCommandReactor` prepares the worktree, provider session, skill instructions, debug
instructions, composer context, and provider handoff as before. It submits the prepared
request to `orchestration-v2/compat/RoninOrchestration` for durable V2 dispatch.

The V2 engine persists runs, attempts, execution nodes, runtime requests, and an effect
outbox. Its worker starts provider work, handles interruption, and captures checkpoints.
`LegacyProviderAdapter` translates Ronin's normalized provider events into V2 events and
uses the existing `ProviderService` for native operations. It reuses the session prepared
by Ronin, retaining provider instance routing and the continuation ledger. Codex, Claude,
and OpenCode retain native steering; the remaining drivers receive queued follow-ups.

`PreparedTurnRequests` carries the exact native request to the worker, including steering.
The V2 transcript stores the original user text separately from injected instructions.
After a restart, V2 recovery cancels in-flight work and expires process-bound callbacks.
Unsent held V2 runs are cancelled and reported to the current client, whose interface has
no V2 queue-resume action. Ronin's saved composer prompt and update-continuation mechanism
remain owned by their existing services.

`ProviderRuntimeIngestion` continues consuming the same native events for the current UI,
including approvals, attachment answers, tasks, plans, citations, tool attribution, and
usage. A native background wake after a root run ends remains on this ingestion and
checkpoint path. The V2 subscriber retains background task lifecycle ownership without
claiming the wake as another turn in the completed run.

## Persistence and import

Migration 062 appends the V2 schema after Ronin's migration 061. It retains the legacy
thread, message, checkpoint, provider ledger, automation, build system, and auth tables.
Both engines use `orchestration_events`, distinguished by `application_event_version`:

- Version 1 contains the current client protocol and Ronin history.
- Version 2 contains V2 execution facts and application project baselines.

Both writers allocate stream versions from the complete shared log. The version 1 reader
filters version 2 events, so it never attempts to decode V2 execution facts as client
events. V2 command IDs use a `v2:ronin:` prefix to keep receipts independent from the
original client command's receipt.

The legacy importer creates lightweight V2 thread shells at startup and hydrates complete
transcripts on the first V2 turn. Each shell records the last message rowid at import.
Hydration reads through that boundary so newly accepted Ronin messages cannot collide with
reserved legacy transcript positions. Importing a transcript does not authorize deleting
its version 1 events or command receipts; V2 compaction retains both.

V2 schemas have a separate `@t3tools/contracts/orchestration-v2` export. The existing
client contract does not import the V2 schema graph, avoiding additional renderer startup
work for an interface that does not use those schemas.

## Checkpoints and reverse operations

`LegacyCheckpointPolicy` records a turn offset on the root V2 checkpoint scope. V2
checkpoints use Ronin's existing `refs/t3/checkpoints/<base64url-thread>/turn/<count>` format and
continue its numbering, including after a restore. The compatibility service reflects
captured diffs and checkpoint activities into the current thread projection and publishes
the existing completion receipts. `CheckpointReactor` skips duplicate capture for owned
V2 turns and retains its VCS and pull request refreshes.

Restoring a conversation retains the existing provider rollback and filesystem restore
path. Its `thread.reverted` event detaches V2 runtime bindings, marks removed runs and
nodes as rolled back, cancels process-bound effects and requests, and clears the active
provider binding. Thread and project deletion also detach and delete V2 state. Metadata changes,
including archive/reopen, pin/unpin, snooze/unsnooze, settlement, permission mode, and
provider changes, synchronize through the shared thread command lock.

V2 checkpoint rewind resolves the legacy turn count to an absolute retained native history length and
persists it on the checkpoint before changing provider history. The same boundary is reused after
file-restore, stale-ref deletion, or event-write failures, including after a server restart.
Retries read current native history and remove only turns after that boundary, including when a
provider fork changes message IDs. History shorter than the retained length fails without rewinding
further.

Manual compaction keeps Ronin's existing compaction, restoration, and queued-message
handling. Automations, build systems, quota resume, side chats, comparison groups, previews,
devices, and desktop IPC retain their current contracts and services. Their ordinary turn
requests reach V2 through the same command reactor. The transport remains single-origin
and environment-local for desktop, direct remote, Tailscale, and SSH clients.

## Restart and background notifications

Recovery continues an unfinished root turn only when its saved native thread, session, and
running provider turn agree, or when a previously admitted continuation crashed before start.
Settled or waiting roots with cancelled background work remain asleep, including stale pending
continuation effects. Background cleanup is reported on a later user turn.

Automatic delegated-task completion messages use active steering only when the adapter says
steering will preserve active tools. The legacy Claude capability marks steering as interrupting
tools, so these messages wait in the queue while explicit user steering remains available.
Stop can target the provider thread's latest accepted turn when a later attempt failed before
creating a provider turn but background work remains.

The shared `@t3tools/shared/KeyedLock` releases idle keys and serializes session, thread,
checkpoint, provider-maintenance, terminal, VCS-status, import, and SSH-tunnel operations.
`KeyedSerialExecutor` retains its compatibility export for V2 services.

## Verification

Focused bridge tests run the real V1 projections and ingestion together with the V2 engine,
outbox worker, session manager, and checkpoint reflection, using isolated SQLite databases
and simulated native providers. They cover all nine drivers, injected prompts, steering,
approvals, structured input, interruption, background completion and exit, native wake
ownership, startup failure, and historical checkpoint numbering. Migration tests preserve
Ronin-specific rows, and shared-log tests cover interleaved writes and compaction.

Native CLI execution and an integrated visual desktop pass require separate verification.

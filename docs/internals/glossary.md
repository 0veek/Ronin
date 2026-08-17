# Glossary

> For maintainers. Using Ronin? See [docs/user](../user/).

This is a living glossary for Ronin. It explains what common terms mean in this codebase.

## Table of contents

- [Project and workspace](#project-and-workspace)
- [Thread timeline](#thread-timeline)
- [Orchestration](#orchestration)
- [Provider runtime](#provider-runtime)
- [Scheduled work](#scheduled-work)
- [Checkpointing](#checkpointing)

## Concepts

### Project and workspace

#### Project

The top-level workspace record in the app. In [the orchestration contracts][1], a project has a `workspaceRoot` and a title. It does not contain threads: `OrchestrationProject` and `OrchestrationThread` are separate arrays on the read model, and a project can have zero threads. See [workspace-layout.md][2].

#### Workspace root

The root filesystem path for a project. In [the orchestration model][1], it is the base directory for branches and optional worktrees. See [workspace-layout.md][2].

#### Worktree

A Git worktree used as an isolated workspace for a thread. If a thread has a `worktreePath` in [the contracts][1], it runs there instead of in the main working tree. Git operations live behind the VCS driver contract in `apps/server/src/vcs/VcsDriver.ts`, implemented by [GitVcsDriverCore.ts][3].

### Thread timeline

#### Thread

The main durable unit of conversation and workspace history. In [the orchestration contracts][1], a thread holds messages, activities, checkpoints, and session-related state. See [projector.ts][4].

#### Turn

A single user-to-assistant work cycle inside a thread. It starts with user input and ends when the session leaves `running` status, which [projector.ts][4] treats as the authoritative completion signal (`settledTurnStateForSessionStatus`). Checkpoint and diff work may settle afterward without changing when the turn ended. See [the contracts][1] and [ProviderRuntimeIngestion.ts][5].

#### Activity

A user-visible log item attached to a thread. In [the contracts][1], activities cover important non-message events like approvals, tool actions, and failures. They are projected into thread state in [projector.ts][4].

#### Side chat

A thread opened from one message of another thread, to ask about it without adding the question to the original conversation's context. It is an ordinary thread in every respect — same project, same checkout, its own history — plus a `sideChat` origin in [the contracts][1] naming its parent and the anchored message. Provenance only: deleting the parent does not delete the side chat. The sidebar files it under its parent (`groupSideChatsUnderParents` in [Sidebar.logic.ts][30]). See [side-chats.md][31].

### Orchestration

Orchestration is the server-side domain layer that turns runtime activity into stable app state. The main entry point is [OrchestrationEngine.ts][7], with core logic in [decider.ts][8] and [projector.ts][4].

#### Aggregate

The domain object a command or event belongs to. In [the contracts][1], that is usually `project` or `thread`. See [decider.ts][8].

#### Command

A typed request to change domain state. In [the contracts][1], commands are validated in [commandInvariants.ts][9] and turned into events by [decider.ts][8].
Examples include `thread.create`, `thread.turn.start`, and `thread.checkpoint.revert`.

#### Domain Event

A persisted fact that something already happened. In [the contracts][1], events are the source of truth, and [projector.ts][4] shows how they are applied.
Examples include `thread.created`, `thread.message-sent`, and `thread.turn-diff-completed`.

#### Decider

The pure orchestration logic that turns commands plus current state into events. The core implementation is in [decider.ts][8], with preconditions in [commandInvariants.ts][9].

#### Projection

A read-optimized view derived from events. See [projector.ts][4], [ProjectionPipeline.ts][11], and [ProjectionSnapshotQuery.ts][10].

#### Projector

The logic that applies domain events to the read model or projection tables. See [projector.ts][4] and [ProjectionPipeline.ts][11].

#### Read model

The current materialized view of orchestration state. In [the contracts][1], it holds projects, threads, messages, activities, checkpoints, and session state. See [ProjectionSnapshotQuery.ts][10] and [OrchestrationEngine.ts][7].

#### Reactor

A side-effecting service that handles follow-up work after events or runtime signals. Examples include [CheckpointReactor.ts][6], [ProviderCommandReactor.ts][12], and [ProviderRuntimeIngestion.ts][5].

#### Receipt

A typed signal emitted when an async milestone completes, such as `checkpoint.baseline.captured`, `checkpoint.diff.finalized`, or `turn.processing.quiesced`. Receipts are a test-only mechanism: the production `RuntimeReceiptBusLive` publish is a no-op and only the test layer is PubSub-backed. Do not build production behavior on them. See [RuntimeReceiptBus.ts][13] and [CheckpointReactor.ts][6].

#### Quiesced

"Quiesced" means a turn has gone quiet and stable: follow-up work such as [CheckpointReactor.ts][6] has settled. It appears in [the receipt schema][13], so in practice it is something tests wait on rather than a production signal.

### Provider runtime

The live backend agent implementation and its event stream. The main service is [ProviderService.ts][14], the adapter contract is [ProviderAdapter.ts][15], and the overview is in [providers.md][16].

#### Provider

The backend agent runtime that actually performs work. Five drivers ship built in: Codex, Claude, Cursor, Grok, and OpenCode. See [ProviderService.ts][14], [ProviderAdapter.ts][15], and [CodexAdapter.ts][17] as a representative adapter.

#### Session

The live provider-backed runtime attached to a thread. Session shape is in [the orchestration contracts][1], and lifecycle is managed in [ProviderService.ts][14].

#### Agent skill

A folder holding a `SKILL.md` that a provider loads on demand. [skillsCatalog.ts][27] discovers three kinds: the user's portable copies under `~/.ronin/skills`, provider-native copies in each provider's own folder, and the built-in packs. A native copy wins a name collision, then the portable copy, then the built-in one. See [agent-skills.md][28].

#### Built-in skill

A skill Ronin ships with, vendored under `apps/server/skills` and packaged to `dist/skills`. It crosses the wire as `scope: "bundled"` — the constant is `BUNDLED_SKILLS_SCOPE` in [the server contracts][29], shared by discovery and the settings UI. Say "built-in" everywhere a user can read it; "bundled" is the scope value and the build vocabulary, not a second name for the concept.

#### Continuation group

The set of provider instances that can resume each other's sessions on a thread, identified by a `continuationKey` — `${driverKind}:instance:${instanceId}` by default, and a shared-home key for Codex instances pointing at the same directory. Moving a thread within a group is a restart; moving across groups is a handoff. Each group's resume cursor is kept per thread in [ProviderSessionLedger.ts][25], so a provider stays resumable after the thread is handed away. See [providers.md][16].

#### Handoff brief

The conversation summary given to a provider picking up a thread it did not start: the transcript (or only the part it missed, if it resumed its own session), the workspace, and the files changed so far. Recent turns stay in full; older ones collapse to one-line bullets. The brief is wrapped in `<handoff_context>` so it does not mix with the user's latest message. Built purely from the thread's own record in [providerHandoffBrief.ts][26], so it costs no queries and no model call and rebuilds identically on a retry. See [providers.md][16].

#### Runtime mode

The safety/access mode for a thread or session. [The contracts][1] define four values: `approval-required`, `auto-accept-edits`, `auto`, and `full-access`. See [permission modes][18].

#### Interaction mode

The agent interaction style for a thread. In [the contracts][1], the values are `default` and `plan`.

#### Assistant delivery mode

Controls how assistant text reaches the thread timeline. In [the contracts][1], `streaming` updates incrementally and `buffered` accumulates text. Buffered delivery is not held until the turn completes: it spills once accumulated text would exceed 24,000 characters, and flushes at approval and user-input boundaries. See [ProviderRuntimeIngestion.ts][5].

#### Snapshot

A point-in-time view of state. The word is used in multiple layers, including orchestration, provider, and checkpointing. See [ProjectionSnapshotQuery.ts][10], [ProviderAdapter.ts][15], and [CheckpointStore.ts][19].

### Scheduled work

#### Automation

A saved prompt plus a rule for when to send it, scoped to one project. Configuration rather than history, so it lives in its own `automations` table instead of the event log — replaying events must never re-fire a schedule. Shape is in [the automation contracts][32]; the rules are in [AutomationService.ts][33]. See [automations.md][34].

#### Automation run

One firing of an automation. Records only whether the turn _started_ (`started`, `skipped`, `failed`) — what the agent then did is the thread's business, and duplicating a turn outcome here would be a second source of truth. Firing expands to `thread.create`, optional worktree preparation, then `thread.turn.start`, because the `bootstrap` field on a turn-start command is a WebSocket-layer convenience the decider does not understand.

#### Parked turn

A turn that died because a provider's subscription window was spent, held in memory and replayed once the window resets. Deliberately not part of the read model: it is scheduler state with a live clock, and it does not survive a restart. Classification lives in [quotaFailureClassification.ts][35], scheduling in [QuotaResumeService.ts][36]. See [quota-resume.md][37].

### Checkpointing

Checkpointing captures workspace state over time so the app can diff turns and restore earlier points. The main pieces are [CheckpointStore.ts][19], [CheckpointDiffQuery.ts][20], and [CheckpointReactor.ts][6].

#### Checkpoint

A saved snapshot of a thread workspace at a particular turn. In practice it is a hidden Git ref in [CheckpointStore.ts][19] plus a projected summary from [ProjectionCheckpoints.ts][21]. Capture and lifecycle work happen in [CheckpointReactor.ts][6].

#### Checkpoint ref

The durable identifier for a filesystem checkpoint, stored as a Git ref. It is typed in [the contracts][1], constructed in [Utils.ts][22], and used by [CheckpointStore.ts][19].

#### Checkpoint baseline

The starting checkpoint for diffing a thread timeline. This flow is surfaced through [RuntimeReceiptBus.ts][13], coordinated in [CheckpointReactor.ts][6], and supported by [Utils.ts][22].

#### Checkpoint diff

The patch difference between two checkpoints. Query logic lives in [CheckpointDiffQuery.ts][20], diff parsing lives in [Diffs.ts][23], and finalization is coordinated by [CheckpointReactor.ts][6].

#### Turn diff

The file patch and changed-file summary for one turn. It is usually computed in [CheckpointDiffQuery.ts][20], represented in [the contracts][1], and recorded into thread state by [projector.ts][4].

## Practical Shortcuts

- If you see `requested`, think "intent recorded".
- If you see `completed`, think "result applied".
- If you see `receipt`, think "async milestone signal, for tests".
- If you see `checkpoint`, think "workspace snapshot for diff/restore".
- If you see `quiesced`, think "all relevant follow-up work has gone idle".

## Related Docs

- [Architecture overview][24]
- [Provider architecture][16]
- [Permission modes][18]
- [Workspace layout][2]

[1]: ../../packages/contracts/src/orchestration.ts
[2]: ./workspace-layout.md
[3]: ../../apps/server/src/vcs/GitVcsDriverCore.ts
[4]: ../../apps/server/src/orchestration/projector.ts
[5]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[6]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
[7]: ../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[8]: ../../apps/server/src/orchestration/decider.ts
[9]: ../../apps/server/src/orchestration/commandInvariants.ts
[10]: ../../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
[11]: ../../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[12]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[13]: ../../apps/server/src/orchestration/Services/RuntimeReceiptBus.ts
[14]: ../../apps/server/src/provider/Layers/ProviderService.ts
[15]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[16]: ./providers.md
[17]: ../../apps/server/src/provider/Layers/CodexAdapter.ts
[18]: ../user/permission-modes.md
[19]: ../../apps/server/src/checkpointing/CheckpointStore.ts
[20]: ../../apps/server/src/checkpointing/CheckpointDiffQuery.ts
[21]: ../../apps/server/src/persistence/Services/ProjectionCheckpoints.ts
[22]: ../../apps/server/src/checkpointing/Utils.ts
[23]: ../../apps/server/src/checkpointing/Diffs.ts
[24]: ./overview.md
[25]: ../../apps/server/src/persistence/ProviderSessionLedger.ts
[26]: ../../apps/server/src/orchestration/providerHandoffBrief.ts
[27]: ../../apps/server/src/provider/skillsCatalog.ts
[28]: ../user/agent-skills.md
[29]: ../../packages/contracts/src/server.ts
[30]: ../../apps/web/src/components/Sidebar.logic.ts
[31]: ../user/side-chats.md
[32]: ../../packages/contracts/src/automation.ts
[33]: ../../apps/server/src/automation/AutomationService.ts
[34]: ../user/automations.md
[35]: ../../apps/server/src/quotaResume/quotaFailureClassification.ts
[36]: ../../apps/server/src/quotaResume/QuotaResumeService.ts
[37]: ../user/quota-resume.md

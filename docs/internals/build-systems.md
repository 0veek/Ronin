# Build systems

A build system is per-project configuration for an orchestrator-led team of models. It is
not event-sourced. Like automations, the roster lives in its own tables so replaying the
orchestration log can never restart a team.

## Pieces

- Contracts: [`packages/contracts/src/buildSystem.ts`](../../packages/contracts/src/buildSystem.ts)
- Store: [`apps/server/src/buildSystem/BuildSystemStore.ts`](../../apps/server/src/buildSystem/BuildSystemStore.ts)
- Coordinator: [`apps/server/src/buildSystem/BuildSystemService.ts`](../../apps/server/src/buildSystem/BuildSystemService.ts)
- Directive parser: [`apps/server/src/buildSystem/directive.ts`](../../apps/server/src/buildSystem/directive.ts)
- Prompts: [`apps/server/src/buildSystem/messages.ts`](../../apps/server/src/buildSystem/messages.ts)
- Reactor: [`apps/server/src/orchestration/Layers/BuildSystemRunReactor.ts`](../../apps/server/src/orchestration/Layers/BuildSystemRunReactor.ts)

## Why the protocol is text

Ronin does not inject tools into a provider session. Every adapter already turns a user
message into a turn and a turn into assistant text, so the lead ends each reply with a
fenced `t3-directive` JSON block. The server parses the last block and acts. All nine
providers are supported as lead or teammate; there are no adapter changes.

Valid actions: `delegate`, `ask_user`, `done`.

## Run loop

`starting` → `orchestrating` ⇄ (`waiting-gate` → `delegating` | `waiting-user`) →
`orchestrating` → `completed` | `failed` | `cancelled`.

The reactor watches `thread.turn-diff-completed` (success, checkpoint exists) and
`thread.session-set` with `error` / `interrupted`. It ignores idle/running session updates
so a finished turn is not processed twice.

Each run has one orchestrator thread (own worktree when the project is a git repo) and one
persistent teammate thread per role, created on first delegation with the orchestrator's
`worktreePath` / `branch` copied through. Turns are serial: one active turn per run.

## Recovery

On startup the reactor scans unsettled runs. A turn that finished while the process was
down is advanced. A turn that is still `starting` / `running` is failed with "Interrupted
by restart" — the new process does not own that provider session. Runs waiting on a person
are left alone.

## Thread linkage

v1 does not add `buildSystemRun` fields to the event-sourced thread model. The run record
already stores `orchestratorThreadId` and `roleThreads`. The client groups sidebar rows and
locks the composer from that record.

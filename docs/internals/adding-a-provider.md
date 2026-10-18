# Adding a provider

A provider integration is ready when Ronin's features behave honestly on it,
including failure and recovery. Start with [provider architecture](./providers.md).

## Choose the integration shape

Implement the retained
[`ProviderAdapterShape`](../../apps/server/src/provider/Services/ProviderAdapter.ts)
and register a driver through
[`builtInDrivers.ts`](../../apps/server/src/provider/builtInDrivers.ts). Adapters
live in `apps/server/src/provider/Layers/`; drivers live in `provider/Drivers/`.
Use the existing ACP runtime for an ACP provider, keeping its peculiarities in
the provider's adapter. Ronin does not expose upstream's generic ACP Registry.

The native orchestration engine consumes these adapters through
[`LegacyProviderAdapter`](../../apps/server/src/orchestration-v2/compat/LegacyProviderAdapter.ts).
The renderer uses the retained V1 contracts. Do not replace either boundary as
an incidental dependency of adding a provider.

## Report only what the provider does

- Declare model switching, model-option switching, promptless continuation,
  conversation rollback, and compaction capabilities honestly. Unsupported
  operations must have a clear response or the existing service fallback.
- Offer permission modes only when the provider enforces them natively.
  Answering approvals automatically in Ronin is not equivalent to native
  enforcement. Keep the provider presentation and actual session launch aligned.
- Pass approval and question option IDs through unchanged. Include a decline
  path honored by the provider, and preserve question requirement IDs.
- Expose plan mode only when its output reaches Ronin's proposed-plan surface.
- Expose MCP app requests only when the provider implements that protocol.
  App operations must stay bound to the live session that created the app.

## Process, account, and setup boundaries

- Sessions, catalogs, and credentials belong to an instance. Remove inherited
  credentials the instance did not configure so accounts cannot silently mix.
- Background status checks must not open a session that starts MCP servers,
  runs workspace hooks, or launches login. Put heavier probes behind an explicit
  action, and report unknown sign-in as unknown.
- Inject Ronin's existing provider MCP bridge where supported. A failed bridge
  must not prevent an ordinary turn. Do not import upstream's excluded general
  orchestration MCP tools.
- Run updates only through an installer that provably owns the binary. Otherwise
  leave updating manual. See
  [`providerMaintenance.ts`](../../apps/server/src/provider/providerMaintenance.ts).
- Close subprocesses and scopes on every terminal path without touching unrelated
  provider processes or the maintainer's live data directory.

## Scenarios to prove

Use focused tests at the adapter boundary, with real protocol recordings when
available. Exercise the actual service and projection paths for lifecycle
behavior. Live tests are useful evidence but cannot replace deterministic tests
that run without credentials. Wait on typed events and receipts, not sleeps.

- Start, resume, multiple turns, queued turns, immediate Stop, and process exit.
- Model and effort changes after startup. Some providers advertise options
  asynchronously; wait for an offered option before writing it.
- Switching back to **Default** after a named model, including after resume.
  Default is a sentinel and must not be sent as a literal model ID.
- Approval accept and decline, questions, attachments, and stale responses.
- Children that report after their parent turn completes or during a later turn.
  Route by child identity rather than the currently active turn.
- Background work and provider-initiated turns through the retained runtime
  event and orchestration paths. Do not discard late work or release its session
  as idle while it still owns work.
- Completion, interruption, failure, and process exit each settle pending tools,
  subagents, approvals, and questions.
- Classify quota failures as usage limits, preserving reset times when available.
- Symlinked workspaces, Windows launcher/path behavior, and instance isolation.

## Registration and product surfaces

- **Contracts:** settings schema and patch, driver kind, default model, display
  name, and provider vocabulary. New providers are off by default.
- **Server:** driver registration, model discovery, compatibility policy, status
  and maintenance, plus text generation for titles and commit messages. Bump the
  manifest's `updatedAt` when changing its policy.
- **Client:** Settings metadata and search terms, model picker, icons and badges,
  permission/interaction controls, and provider-specific command handling. The
  Electron shell embeds the same renderer; remote environments own their CLI
  installations and credentials.
- **Docs:** a `docs/user/providers-<name>.md` guide, an install table entry, and
  any differences on the permission modes page. Index new docs in `docs/README.md`.

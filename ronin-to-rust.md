# Ronin → Rust: a port roadmap

**Target:** rebuild Ronin as a Tauri 2 + Rust application, 1:1 on features, UI/UX, and design.
**Audience:** an AI coding agent (and the human reviewing it).
**Status:** in build. See [Build status](#build-status) for what is actually done.
The implementation lives in [`Ronin-in-Rust/`](./Ronin-in-Rust/).

---

## 0. Decisions already made

Two questions were settled before this document was written. They are load-bearing; everything
below assumes them.

| Decision      | Choice                                                                         | Consequence                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Frontend**  | Keep `apps/web` (React 19) unchanged; rewrite only the backend + shell in Rust | UI/UX/design parity is _free_ — it is literally the same code. The port becomes a backend and shell problem, not a design problem.   |
| **Platforms** | Linux first (WebKitGTK), macOS second (WKWebView), Windows last (WebView2)     | Matches Ronin's current posture. Windows-specific work (ConPTY, WebView2 quirks, NSIS) is deferred to a late phase, not interleaved. |

### Why keeping React is the right call

A "1:1 on UI/UX and design" requirement is a trap for a rewrite. Ronin's renderer is ~130k lines of
non-test TypeScript across ~700 files, and the design is not a skin — it is encoded in 2,493 lines of
hand-tuned CSS (`apps/web/src/styles/`), a 1,886-line theme engine (`themePalette.ts`), a Lexical-based
prompt editor, a virtualized timeline, a Canvas terminal driven by a Ghostty WASM build, and a diff
viewer from `@pierre/diffs`. Reproducing that in Leptos or Dioxus means reproducing every hover state,
every `ease-spring` `linear()` curve, every `color-mix()` fallback, and every scroll-anchoring
behaviour — and _proving_ it matches. That is where rewrites die.

Tauri does not require a Rust frontend. It ships a webview and serves your assets. So: point Tauri's
webview at the existing Vite bundle, and spend the entire budget on the part that actually needs to be
Rust.

**This also means the port has a perfect oracle.** The existing renderer is a conformance test for the
new backend: if the real Ronin UI boots, connects, streams a turn, and renders a diff against the Rust
server, the Rust server is correct at the protocol level. No other rewrite gets that.

---

## Build status

Updated as phases land. A phase is **done** only when its exit criterion has
actually been checked, not when its code compiles.

| Phase                      | Status                    | Evidence                                                                                                                                                                                                               |
| -------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Recon & freeze           | ✅ done                   | Workspace, gates green                                                                                                                                                                                                 |
| 1 Contracts & oracle       | ✅ done                   | Fixtures round-trip; renderer's own schema decodes `server.getConfig`                                                                                                                                                  |
| 2 Persistence              | ✅ done                   | 47 schema objects identical to a real database, both at version 40                                                                                                                                                     |
| 3 Orchestration engine     | ✅ done                   | 2,499 real events replayed; projects, threads, messages, sessions all matched                                                                                                                                          |
| 4 VCS & checkpointing      | ✅ done                   | Checkpoint capture/restore/diff against real repositories; format proven interoperable                                                                                                                                 |
| 5 Terminals                | ✅ done                   | Real PTYs; lifecycle, fanout, scrollback                                                                                                                                                                               |
| 6 Auth & HTTP              | ✅ done                   | Live pairing → token exchange → ticket → socket, with negative paths. Browser-session cookie added when the real renderer needed it — see [First boot](#first-boot)                                                    |
| **7 Providers**            | 🟡 **partial**            | **Claude drives a real turn end to end** — see [A turn that runs](#a-turn-that-runs). Detection for Claude/Codex/Grok. **Codex, Grok, Cursor, OpenCode drivers; approvals; tool detail; text generation outstanding.** |
| **8 Source control & PRs** | 🟡 **partial — revisit**  | Host routing, CLI failure classification, GitHub list/detail. **GitLab, Bitbucket, Azure, review flows, and all of `sourceControl/` outstanding.**                                                                     |
| 9 Supporting services      | 🟡 **partial**            | Provider probe — Claude 2.1.226, Codex 0.147.0, Grok 1.0.0 all detected live; native folder picker via the XDG portal. **Usage, telemetry, workspace, diagnostics, settings, MCP outstanding.**                        |
| 10 Feature-complete gate   | 🚩 **failing, by design** | Audit built and running. Streaming subscriptions, the engine, and `dispatchCommand` now wired — see [The backbone](#the-backbone)                                                                                      |
| **11 Tauri shell**         | 🟡 **partial — revisit**  | **The real renderer boots, authenticates, and runs in the window.** ACL capability + build manifest so a remote origin can invoke. **~20 of 74 IPC channels; preview webviews, menus, updates, WCO outstanding.**      |
| **12 SSH & remote**        | 🟡 **partial — revisit**  | Host discovery, tunnel/launch model, external-vs-managed rule, Tailscale endpoint selection. **No live SSH connection driven end to end.**                                                                             |
| 13 Packaging               | ⬜ not started            | —                                                                                                                                                                                                                      |
| 14 Windows                 | ⬜ not started            | —                                                                                                                                                                                                                      |

### The gate

`cargo test -p ronin-server --test rpc_coverage -- --nocapture` sorts every
method the renderer can call into implemented, declared-but-unimplemented, or
**unknown**, and fails if anything lands in the third bucket. A method with no
declared scope is not merely missing a handler — it is a method whose
authorization nobody decided.

Current reading:

```
contract methods : 93
implemented      : 2 (2%)
declared only    : 91
unknown          : 0

awaiting implementation, by capability:
  orchestration:read    — 40
  orchestration:operate — 39
  terminal:operate      —  9
  review:write          —  2
  access:read           —  1
```

The gate is _supposed_ to fail this early. Its value is that "2%" is now a
number rather than a feeling, and that the security property — every reachable
method has an authorization decision — is asserted rather than assumed.

### First boot

The real renderer now boots inside the Tauri shell, authenticates, opens the
socket, and dispatches RPC. It renders its empty state ("No projects yet")
because the environment has no projects, not because anything failed.

Getting there cost six bugs, and they were all the same bug: **a wire shape
invented on the Rust side instead of read off the contract.** Worth recording,
because the failure mode is what made them expensive.

| What was wrong                                                                                                                                      | How it presented                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/api/auth/session` returned `{sessionId, subject, scopes}` and 401 when anonymous                                                                  | "Primary environment request failed during fetch-session-state (**HTTP 500**)" |
| `/.well-known/ronin/environment` returned an invented `{environmentId, serverVersion, protocolVersion}` instead of `ExecutionEnvironmentDescriptor` | Silent 4-second retry loop, every response a clean 200                         |
| Tauri commands unreachable from a remote origin (no capability, no ACL manifest)                                                                    | `bridge_local_bearer_token not allowed. Plugin not found`                      |
| `getConnectionCatalog` returned parsed JSON; the contract is an opaque **string**, and `set` must return **`true`**                                 | App rendered, socket never opened, nothing logged                              |
| `/ws` required a ticket; a browser cannot set headers on a `WebSocket` and has only the cookie                                                      | 401 on every handshake, retried forever                                        |
| `/api/auth/websocket-ticket` returned `{wsTicket, expiresIn}`; the contract is `{ticket, expiresAt}`                                                | Would have broken every non-browser client                                     |

Every one of these produced **no error on the server**. A shape mismatch is
decoded by the client, and a decode failure carries no HTTP status — so the
client reports `?? 500` while the server log shows an unbroken series of 200s.
Reading the log tells you nothing; the server thinks it is working.

Three things came out of it, and they are the actual deliverable here:

- **`web/tools/conformance/bootEndpoints.ts`** decodes every pre-credential
  endpoint with the renderer's own Effect schemas. This is the oracle that
  should have existed before the first boot attempt.
- **`RONIN_DIAGNOSTIC_PROBE=1`** injects a boot reporter into the served
  document — window errors, unhandled rejections, `console.error` (where Effect
  puts failed fibers), the injected bootstraps, and the visible text after
  8 seconds — beaconed as request paths, since a `sendBeacon` URI reaches the
  access log even when the page is tearing down. Off by default; it opens an
  unauthenticated route and inlines a script.
- **Unserved `/api/*` paths now 404** instead of falling through to the app
  shell under a 200. That fallback was actively hiding this class of bug.

**Rule for the remaining phases: never write a wire shape without opening the
contract file. If a response is not decoded by the client's own schema in a
test, it is not implemented.**

### A turn that runs

`cargo test -p ronin-server --test orchestration_over_the_socket -- --ignored`
sends "Reply with exactly: RONIN OK" over a real WebSocket, spawns the real
`claude` binary, and asserts the reply comes back through a subscription and the
session settles. It passes in ~5s. That is the first point at which this is an
app rather than a shell.

Three decisions in that path are worth keeping:

- **The turn id is derived from the command id**, not generated. A retried
  `thread.turn.start` must name the same turn; an ambient id source would invent
  a second one and leave the first running with nothing able to interrupt it.
  Every command the runner issues is likewise `{turn}-{step}`, so a replayed
  turn collapses on the engine's receipts instead of appending the reply twice.
- **The agent launches only after the command is durable**, and only when the
  dispatch was not a replay. Starting it first would let it edit the user's
  files for a turn no record of exists.
- **The turn always settles**, including when the provider dies without a
  verdict. A thread left `Running` spins forever and nothing else will ever come
  along to stop it.

The transport skips every message type it does not recognise. The protocol
carries thirty-odd and gains more each release; a parser that insisted on
knowing them all would break on the next Claude update.

**Sessions resume.** A second test sends two turns: the first plants a word that
exists nowhere else, the second asks for it back. It passes, so the agent is
genuinely continuing its own session rather than meeting the user fresh each
message. The cursor lives in `provider_session_runtime` — a table the ported
schema already had — because it is runtime bookkeeping, not history: nobody
wants to undo or replay it, and a cursor in the event log would be a permanent
record of a shape that changes whenever a provider changes its mind. It is saved
on **every** ending, including failures, since a turn that errored partway has
still moved the conversation along on the provider's side. It is only offered
back to the driver that wrote it — a Claude session uuid handed to Codex would
either error or, worse, be accepted as something else.

**The agent can actually work.** This was the most serious bug in the port, and
it produced no error anywhere: with no `--permission-mode`, the CLI refuses every
edit **and still exits `success`**, listing the refusals in a field nobody reads.
A user asked for a file, was told it was done, and found nothing on disk. The
thread's runtime mode now maps onto the CLI's permission mode —
`full-access → bypassPermissions` (plus the companion
`--allow-dangerously-skip-permissions`, without which the mode is accepted and
silently ignored), `auto-accept-edits → acceptEdits`, `auto → auto`, and
`approval-required → nothing`. That last one maps to nothing deliberately: in a
one-shot turn there is nobody to answer a prompt, and quietly upgrading it would
hand the agent access the user explicitly withheld. When a turn _is_ refused, the
reply says so, because the alternative is a user who believes work was done.

**Turns can be stopped.** Cancellation is cooperative — a token, not an abort.
Aborting drops the runner mid-await so it never reaches its own settle, and a
thread left `Running` spins forever with nothing coming to clear it; an interrupt
that wedges the thread is worse than no interrupt. Whatever had already streamed
is kept and finalised rather than blanked, and the session settles as
`interrupted` — not as an error and not as a success.

**Tool calls appear in the activity feed**, one row per call, with the `tool`
tone. What the agent _did_ is not what it _said_; folding tool calls into the
reply text would make both unreadable.

**A turn can create its own thread.** The composer sends one command for "new
thread, here is my first message" — a `turn.start` carrying `bootstrap.createThread`,
with no preceding `thread.create`. Every message typed into a fresh conversation
was being rejected with _"Thread does not exist"_ until the decider learned to
plan the creation and the turn together. They are one transaction on purpose: two
commands would let the create land while the start failed, leaving an empty
thread nobody asked for.

**Worktree threads are isolated for real.** The client asks for this with
`bootstrap.prepareWorktree`; ignoring it did not fail, it did something worse —
the agent ran in the project root and edited the checkout the user was looking
at while the UI said the thread was isolated. The worktree is now created
**before** the command is dispatched, so the thread is recorded already pointing
at it: creating it afterwards would leave a window where the thread claimed an
isolation it did not have. Everything optional around it degrades rather than
fails — a repository with no `origin` is an ordinary local project, and failing
a thread over `git fetch` would be absurd — but a worktree that cannot be
created **refuses the turn** rather than quietly running in the project root.
Proven by a live-agent test that asserts on both directories, because only the
filesystem can tell those two apart.

**Attachments work end to end.** Images arrive _inside_ `thread.turn.start` as
data URLs, so failing to store one abandons the send exactly as the missing
`thread.meta.update` did. The bytes go to disk and only an id enters the event
log — a ten-megabyte screenshot in a log that is replayed on every start would
be re-read forever. `assets.createUrl` hands back a relative URL rather than
bytes, because an image belongs in an `<img src>` the browser fetches and caches
itself; the route is authenticated by the ordinary session cookie, which is why
the URL carries no token to leak or expire.

An attachment id is `<thread>-<command>-<index>`. Reading the reference is what
made that right: the thread segment is how attachments are **found again when a
thread is deleted**, and a flat id with no owner leaves them on disk forever. A
format chosen without that would have needed a migration the first time cleanup
was implemented.

What a turn still does _not_ do: route interactive approvals — that needs the
bidirectional protocol, and until then `approval-required` reads but does not
write.

### The 1:1 audit

Run against the reference, mechanically:

```
cargo test -p ronin-server --test rpc_coverage -- --nocapture
python3 tools/command-conformance/check.py
```

**The coverage gate was itself broken.** `IMPLEMENTED` was a hand-maintained
constant that nobody updated when handlers moved to the task layer, so it went
on reporting _2 of 93_ while the real figure was three times that. It now reads
the match arms out of `rpc.rs` and `tasks.rs` with `include_str!`, because a
gate that has to be remembered is not a gate — it is a comment that
occasionally lies. Honest reading: **6 of 93 methods, 19 of 23 commands.**

The second script is the one worth having. A missing _command_ fails loudly the
first time someone uses the feature; a **dropped field** does not — it is
accepted, ignored, and the user is told the thing they asked for happened. It
found two real defects:

- **`project.delete` ignored `force`.** The reference refuses to delete a
  project that still has threads, and cascades to them when forced. Ours deleted
  unconditionally and cascaded to nothing, orphaning every thread — rows the
  sidebar cannot group and the user cannot reach. A data-integrity bug that
  reported success.
- **`thread.meta.update` ignored `expectedBranch`.** It is a compare-and-swap:
  background work follows the worktree's real checkout, and if the branch moved
  between that read and the dispatch the stale write must be **dropped**.
  Ignoring it meant the loser of the race overwrote the winner.

Both are fixed and tested. The audit now reports no required field dropped; what
remains is optional and listed in [Known divergences](#known-divergences).

### Known divergences

Deliberate, and each one costs something specific:

| Divergence                                                                                | Cost                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `subscribeShell` / `subscribeThread` re-send a whole snapshot per event instead of deltas | Bandwidth on large threads. The contract allows snapshot items, and a delta that disagreed with the projector would desynchronise silently. |
| `subscribeShell` ignores `afterSequence`                                                  | A resuming client gets a full snapshot rather than a replay. Correct, merely larger.                                                        |
| `bootstrap.runSetupScript` ignored                                                        | A project's setup script never runs for a new worktree.                                                                                     |
| `project.create` ignores `createWorkspaceRootIfMissing`                                   | Picking a non-existent folder creates a project whose agent later fails on a missing directory.                                             |
| `thread.meta.update` ignores `regenerateTitle`                                            | "Regenerate title" is a silent no-op.                                                                                                       |
| `thread.turn.start` ignores `titleSeed` and `sourceProposedPlan`                          | Auto-titles are the client's; plan-linked turns are unlinked.                                                                               |
| A bootstrap that fails mid-way does not delete the thread it created                      | The reference cleans up; ours can leave an empty thread.                                                                                    |

Still unhandled entirely: `thread.approval.respond`, `thread.user-input.respond`
(both need the bidirectional provider protocol), `thread.checkpoint.revert`, and
`thread.session.stop`.

### The silent drop

Two bugs found by running the app rather than the tests, both invisible from the
server side.

**`ServerProviders` is a `ForwardCompatibleArray`, which drops entries it cannot
decode.** My provider snapshots were missing `models` — required, no decoding
default — so all three were discarded on arrival. `getConfig` succeeded, the log
showed three providers probed, and the UI said _"No provider available"_ with the
composer disabled. Nothing anywhere reported a problem.

The fix is one field. The lesson is the harness: `web/tools/conformance/serverConfig.ts`
connects over a real socket, decodes `getConfig` with the client's own schema,
and then decodes **each provider individually** — because that is what turns a
silent omission into a named failure. It now prints:

```
OK   server.getConfig decodes
     providers:   3
OK   provider claudeAgent
OK   provider codex
OK   provider grok
```

**Unimplemented methods returned a typed failure, and should have returned a
defect.** The original reasoning was that a defect looks like a crash while the
server is merely incomplete. In practice it is worse: each method declares its
own error union, none of which has a "not implemented" member, so the typed
failure failed the client's decoder and arrived as
`Die(SchemaError(Expected { GitManagerError } | { ... }))` — a defect anyway,
with the method name buried under a schema dump. A defect carrying the payload
directly reads as `Die(Error: vcs.refreshStatus is not implemented on this
server yet)`, which is the one thing a reader needs. Evidence beat the theory.

### The backbone

The empty workspace was never a Phase 6 or Phase 7 problem. `ronin-server`
depended on four crates — contracts, rpc, db, auth — and **nothing else**.
`ronin-orchestration`, `ronin-vcs`, `ronin-terminal`, and `ronin-provider` were
built, tested, and wired to nothing. `RpcContext` held one field. The dispatcher
had two arms.

What landed:

- **Streaming.** `rpc::handle` returned a `Vec`, which cannot express a
  subscription. The socket is now a reader task and a writer task joined by a
  channel, and a `Connection` owns its in-flight work keyed by request id — so
  `Interrupt` cancels the one request it names, and closing a tab aborts every
  stream it opened instead of leaking them against the engine.
- **The engine**, started during startup, before the listener exists. A client
  that connects must never see a half-built read model and conclude its projects
  are gone.
- **`orchestration.subscribeShell`**, streaming a narrowed projection. The shell
  drops message history: sending the read model directly would put every message
  of every thread on the wire on every connect.
- **`orchestration.dispatchCommand`**, which is the discovery that reframes
  Phase 10. `projects.add` has no `Rpc.make` — it is a legacy name, not one of
  the 93. **Every mutation goes through this one method**, tagged by `type`. It
  decodes all 14 commands the decider supports, so implementing one method
  unlocked project and thread creation, archive, settle, snooze, and pin
  together.
- **Provider detection.** `getConfig` reported `providers: []`. It now probes
  concurrently and reports live — Claude `2.1.226`, Codex `0.147.0`, Grok
  `1.0.0` on this machine. Drivers are a table (`probe::BUILT_IN`), not code, so
  adding one is an entry rather than a new code path with its own subtly
  different notion of "installed". A provider that is _not_ installed is still
  listed, with a reason: an empty settings page gives the user nothing to act
  on. Grok also carries `requiresNewThreadForModelChange` and its "Early Access"
  badge, which the model picker needs _before_ the user chooses — otherwise it
  offers a change that silently fails.
- **A real folder picker.** `bridge_pick_folder` was a stub returning `null`,
  which is exactly what the renderer sees when a user cancels — so "Add project
  → Local folder" silently did nothing. Replacing it with `rfd` was not enough:
  the crate's default features select `async-std` as the XDG-portal executor,
  and driving that from a tokio task meant the dialog never appeared. Pinning
  `default-features = false, features = ["xdg-portal", "tokio"]` fixed it,
  confirmed by a live portal request on the bus.

Verified over a real socket in `tests/orchestration_over_the_socket.rs`:
subscribe, create a project, and watch the subscription report it unasked.
Writing that test surfaced a real property worth stating — **the socket is
multiplexed and inter-request ordering is not fixed.** A subscription's chunk
and a command's exit come from different tasks, so either can land first. The
first version of the helper discarded non-matching messages and failed in a way
that looked exactly like a server that never sent the update.

The remaining work clusters by capability rather than scattering, which is the
useful shape: `orchestration:read` is largely subscriptions and queries over the
engine that already exists, and `terminal:operate` is nine methods over a
terminal manager that is already built and tested.

### What "revisit" means for 7 and 8

Both are the widest phases in the plan, and both currently have the **spine
without the coverage**. That is a deliberate stopping point, not an accident:
the shared parts — the adapter trait, the JSON-RPC transport, the CLI failure
model, the normalized change-request shape — are the parts every driver depends
on, and they are the parts worth getting right before multiplying them by five
providers or four hosts.

Neither should be called done until:

- **7** — at least one driver spawns a real agent and completes a turn end to
  end, and the Claude protocol spike has resolved (§6.1 is now closed).
- **8** — a real repository lists and opens a pull request through the UI, and
  `sourceControl/` exists at all.
- **11** — preview webviews work on WebKitGTK (§6.2 is still unspiked), native
  menus and dialogs exist, and the Window Controls Overlay feeds the geometry
  the stylesheet expects.
- **12** — a real remote box is connected to from the shell, and a browser
  reaches an environment over Tailscale. Everything present today is the
  decision-making around those two acts, not the acts themselves.

### What phase 12 settled

**The teardown rule is now code.** A server Ronin started is `managed` and is
stopped on disconnect; one that was already listening is `external` and is left
alone. The remote launch script probes for a listener _before_ starting
anything, which is what makes a second client attaching to a shared box
harmless. Getting this backwards kills a process the user was relying on
because they closed a window.

**Only authentication failures refuse to save an environment.** A machine the
user cannot reach must not sit in their list retrying forever; a host that was
merely asleep, or a local port that was busy, is transient and reconnect is the
right affordance. `RemoteError::should_save_environment` encodes exactly that
split.

**Loopback is never selected as a pairing endpoint by default.** Handing another
device `127.0.0.1` gives it a URL pointing at its own machine. There is no
unconditional fallback — no endpoint is a better answer than a wrong one — and
only an explicit saved override can choose loopback.

### What phase 11 settled

Two things are worth carrying forward regardless of what remains.

**The synchronous-bridge problem has an answer.** `getAppBranding` and
`getLocalEnvironmentBootstraps` use Electron's `sendSync`, and Tauri's `invoke`
is async-only. They are not calls in this shell: the values are known before the
window exists and are injected as data in the same script that defines the
bridge. The renderer gets the plain synchronous return it asked for. This was an
open question in §6 and is now closed.

**The bridge is verified by execution, not by substring.** `cargo run -p
ronin-shell --example dump-bridge` emits the generated script and
`tools/bridge-conformance/check.mjs` runs it in a stubbed webview. A syntax
error would satisfy every Rust assertion and still leave `window.desktopBridge`
undefined — at which point the renderer decides it is a browser and shows a
pairing screen. Substring tests cannot catch that; this does.

---

## 1. What Ronin actually is

Read this section before writing any code. Most porting mistakes come from misreading the shape.

Ronin is **not** a desktop app with a backend attached. It is a **network server** with a desktop
client that happens to bundle it. That distinction decides the whole architecture.

```
┌──────────────────────────────────────────────────────────────┐
│ Client                                                       │
│   apps/desktop  — Electron shell (window, menus, preview,     │
│                   SSH, updates, secret storage)               │
│   apps/web      — React renderer (the UI)                     │
│   packages/client-runtime — connection supervisor, RPC        │
│                   session, Atom-based domain state            │
└──────────────────────────┬───────────────────────────────────┘
                           │  Effect RPC over WebSocket, JSON framing
                           │  GET /ws  ·  contract: packages/contracts
┌──────────────────────────▼───────────────────────────────────┐
│ apps/server — "the environment"                              │
│   event-sourced orchestration engine                          │
│   5 provider drivers  ·  4 PR providers                       │
│   git/VCS  ·  checkpoints  ·  PTY terminals  ·  filesystem    │
│   auth (scoped sessions)  ·  SQLite  ·  MCP  ·  telemetry     │
└──────────────────────────┬───────────────────────────────────┘
                           │ per-driver transport
┌──────────────────────────▼───────────────────────────────────┐
│ Agent CLIs: Codex · Claude · Cursor · Grok · OpenCode         │
└──────────────────────────────────────────────────────────────┘
```

The client talks to the server the same way whether the server is in-process on localhost, on a LAN
box, behind a Tailscale HTTPS mapping, or on the far end of an SSH tunnel. Remoteness lives entirely
in the connection layer. **Do not collapse the server into Tauri IPC.** If you replace the WebSocket
with `invoke()`, you delete remote access, the browser client, and the SSH story in one move.

The Rust build keeps the same boundary: an `axum` HTTP+WS server that Tauri spawns in-process and the
webview connects to over `ws://127.0.0.1:<port>/ws`, exactly as the Electron shell does today.

### 1.1 The core loop (event sourcing)

`apps/server/src/orchestration/` is the heart. It is ~13.8k non-test lines and it is the part you must
port most faithfully.

1. A client sends `orchestration.dispatchCommand` over RPC.
2. `OrchestrationEngine.dispatch` offers a `CommandEnvelope` onto a queue and awaits the result. **One
   worker fiber drains that queue serially**, so command processing is totally ordered.
3. For each envelope, `processEnvelope`:
   - checks the durable command receipt table (makes retries idempotent);
   - calls `decideOrchestrationCommand` (`decider.ts`) — **pure**, command + state → events;
   - in **one SQL transaction**: appends events to the event store, applies them to the in-memory read
     model via `projector.ts`, projects them into the persisted projection tables, writes the accepted
     receipt;
   - after commit, swaps in the new read model and publishes committed events to subscribers.
4. On failure, it re-reads persisted events past the starting sequence and reconciles.

Because persistence and projection share a transaction, the read model can never durably disagree with
the log. That property is the whole design. Preserve it.

Some commands are client-dispatchable (`thread.create`, `thread.turn.start`,
`thread.approval.respond`, `thread.turn.interrupt`, `thread.user-input.respond`,
`thread.checkpoint.revert`, `thread.session.stop`, `thread.runtime-mode.set`,
`thread.interaction-mode.set`). Others are internal and only server-side reactors produce them
(`thread.message.assistant.delta`, `thread.session.set`, …). There are 27 event names in
`packages/contracts/src/orchestration.ts`.

**Turn completion is defined by session status, not by checkpoint work.** A turn is complete when its
session leaves `running`, per `settledTurnStateForSessionStatus` in `projector.ts`. Checkpoints settling
later do not move that line. Getting this wrong produces spinners that lie, which is the exact class of
bug Ronin's own contributing guide calls out.

### 1.2 Drainable workers

Three queue-backed reactors run follow-up work, all built on `packages/shared/src/DrainableWorker.ts`:

| Worker                     | Job                                                                   |
| -------------------------- | --------------------------------------------------------------------- |
| `ProviderRuntimeIngestion` | Normalizes provider runtime event streams into orchestration commands |
| `ProviderCommandReactor`   | Reacts to intent events by dispatching provider calls                 |
| `CheckpointReactor`        | Baseline capture, completed-turn capture, diff projection, revert     |

`DrainableWorker` pairs a transactional queue with a transactional count of outstanding items:
`enqueue` atomically offers **and** increments; processing always decrements; `drain` retries until the
count hits zero. This is what makes the test suite deterministic — tests await "queue empty and current
item finished" instead of sleeping. **Port this primitive first and port it exactly**; it is ~150 lines
and it unlocks deterministic testing for everything downstream.

Runtime _receipts_ (`RuntimeReceiptBus`) are test-only. The production layer's publish is a no-op. Do
not build production behaviour on them, and do not "improve" them into a real event bus.

### 1.3 Buffered assistant delivery

Ronin cut token-by-token streaming. Assistant text accumulates and spills:

- `MAX_BUFFERED_ASSISTANT_CHARS = 24_000` — the append that would exceed it invalidates the buffer and
  spills the whole accumulated text as one delta;
- the buffer also flushes at interaction boundaries (approval opened, user input requested) via
  `flushBufferedAssistantMessagesForTurn`.

Both rules live in `ProviderRuntimeIngestion.ts`. They are user-visible pacing; reproduce them exactly.

### 1.4 Checkpointing

Each turn is bracketed by workspace checkpoints stored as **hidden git refs**, so diff and restore are
exact:

- `CheckpointStore.ts` captures via the VCS driver's `VcsCheckpointOps` contract;
- `CheckpointDiffQuery.ts` answers turn-diff and full-thread-diff requests;
- `Diffs.ts` parses patches;
- `CheckpointReactor.ts` sequences baseline → capture → diff projection → revert (of both workspace and
  provider conversation, via the adapter's `rollbackThread`).

### 1.5 Providers

Five drivers in `apps/server/src/provider/`, registered in `builtInDrivers.ts`. Each declares a
`driverKind`, a config schema, and a `create` that builds an adapter in a child scope. Two registries
separate configuration from live processes (`ProviderInstanceRegistry`, `ProviderAdapterRegistry`), and
`ProviderService` routes by thread so callers never name an agent.

The adapter contract (`provider/Services/ProviderAdapter.ts`) is small and clean — 13 members:
`startSession`, `sendTurn`, `interruptTurn`, `respondToRequest`, `respondToUserInput`, `stopSession`,
`listSessions`, `hasSession`, `readThread`, `rollbackThread`, `stopAll`, `streamEvents`, plus
`capabilities`. **This is your trait.** Getting it right in Rust makes the five drivers independent
work streams.

Transports, which is what actually matters for the port:

| Provider     | Transport today                                                                                                   | Rust path                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Codex**    | `codex app-server` JSON-RPC over stdio, via `packages/effect-codex-app-server`                                    | Straightforward: newline-delimited JSON-RPC over tokio stdio                                                                  |
| **Cursor**   | ACP (Agent Client Protocol) JSON-RPC over stdio, via `packages/effect-acp` + `provider/acp/CursorAcpExtension.ts` | Straightforward, same shape                                                                                                   |
| **Grok**     | ACP over stdio + `XAiAcpExtension.ts`                                                                             | Straightforward, same shape                                                                                                   |
| **OpenCode** | `@opencode-ai/sdk` — HTTP + SSE against a locally spawned `opencode serve`                                        | Straightforward: `reqwest` + `eventsource-stream`                                                                             |
| **Claude**   | `@anthropic-ai/claude-agent-sdk` — a **Node** SDK                                                                 | ✅ **No Rust equivalent needed.** The SDK spawns the `claude` CLI and speaks NDJSON; Rust speaks the same protocol. See §6.1. |

### 1.6 Everything else the server owns

Non-test line counts, so you can size the work honestly:

| Module                                                                                                                      |    LOC | What it does                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | -----: | ----------------------------------------------------------------------------- |
| `provider/`                                                                                                                 | 28,653 | 5 drivers + adapters + ACP support + registries + session reaper              |
| `orchestration/`                                                                                                            | 13,799 | Engine, decider, projector, 5 reactors, snapshot query                        |
| `pullRequest/`                                                                                                              | 10,379 | GitHub, GitLab, Bitbucket, Azure DevOps — list, detail, diff, review, comment |
| `persistence/`                                                                                                              |  6,639 | SQLite client, 40 migrations, event store, 11 projection tables               |
| `sourceControl/`                                                                                                            |  5,808 | Provider discovery, auth status, clone/publish, PR templates                  |
| `vcs/`                                                                                                                      |  5,504 | Git driver, worktrees, status broadcaster, provisioning                       |
| `auth/`                                                                                                                     |  3,397 | Scoped sessions, pairing links, secret store, RPC authorization               |
| `resourceTelemetry/`                                                                                                        |  3,385 | Native monitor client, attribution, history                                   |
| `terminal/`                                                                                                                 |  3,093 | PTY manager, output fanout, scrollback                                        |
| `git/`                                                                                                                      |  2,738 | Stacked actions, PR workflow, remote refs                                     |
| `textGeneration/`                                                                                                           |  2,597 | Thread titles + summaries via each provider                                   |
| `cli/`                                                                                                                      |  2,167 | `t3` CLI: serve, pair, auth, project, service                                 |
| `mcp/`                                                                                                                      |  1,465 | MCP HTTP server + preview automation toolkit                                  |
| `usage/`                                                                                                                    |  1,449 | Scans provider transcripts, prices tokens                                     |
| `cloud/`                                                                                                                    |  1,409 | Self-update, service launcher, pinned runtime                                 |
| `workspace/`                                                                                                                |  1,401 | Entries, search index, filesystem, paths                                      |
| `preview/`                                                                                                                  |    827 | Local dev-server port scanning, session manager                               |
| `diagnostics/`, `project/`, `checkpointing/`, `process/`, `telemetry/`, `background/`, `assets/`, `environment/`, `review/` | ~4,000 | Support services                                                              |

### 1.7 Surface area, counted

These are the numbers the roadmap is scoped against:

- **93 RPC members** — counted by `Rpc.make` group membership, which is what the renderer can
  actually call. (`WS_METHODS` declares three more — `projects.add`, `projects.list`,
  `projects.remove` — that no longer belong to the group; project lifecycle goes through
  `orchestration.dispatchCommand`. Counting the map overstates the surface by three.)
- **16 HTTP endpoints** (`/ws`, `/.well-known/t3/environment`, `/oauth/token`, 8 auth routes, 4
  orchestration snapshot/dispatch routes, PR diff, plus asset/static/OTLP routes)
- **74 desktop IPC channels** (`apps/desktop/src/ipc/channels.ts`)
- **27 orchestration event types**, ~30 command types
- **40 SQLite migrations**, 17 tables
- **6 auth scopes**: `orchestration:read`, `orchestration:operate`, `terminal:operate`,
  `review:write`, `access:read`, `access:write`
- **5 provider drivers**, **4 pull-request providers**
- **602 test files** repo-wide; 221 in the server alone

---

## 2. Target architecture

### 2.1 Repository layout

```
ronin-rs/
├─ Cargo.toml                    # workspace
├─ crates/
│  ├─ ronin-contracts/           # serde types mirroring packages/contracts  ★ START HERE
│  ├─ ronin-rpc/                 # Effect-RPC wire protocol (server + framing)
│  ├─ ronin-db/                  # SQLite, migrations, event store, projections
│  ├─ ronin-orchestration/       # engine, decider, projector, reactors
│  ├─ ronin-provider/            # ProviderAdapter trait + 5 drivers
│  │  ├─ src/acp/                #   shared ACP client (Cursor, Grok)
│  │  ├─ src/codex/              #   codex app-server JSON-RPC
│  │  ├─ src/claude/             #   see §6.1
│  │  └─ src/opencode/           #   HTTP + SSE
│  ├─ ronin-vcs/                 # git driver, worktrees, checkpoints, diffs
│  ├─ ronin-scm/                 # GitHub/GitLab/Bitbucket/AzureDevOps + PR service
│  ├─ ronin-terminal/            # PTY manager (portable-pty)
│  ├─ ronin-auth/                # scoped sessions, pairing, secret store
│  ├─ ronin-telemetry/           # resource monitor (absorbs native/resource-monitor)
│  ├─ ronin-usage/               # transcript scan + pricing
│  ├─ ronin-mcp/                 # MCP HTTP server
│  ├─ ronin-server/              # axum wiring, startup lifecycle, config, CLI (`ronin` binary)
│  ├─ ronin-ssh/                 # SSH config parse, tunnel, remote launch
│  └─ ronin-shell/               # Tauri app: windows, menus, preview, updates, IPC
├─ web/                          # apps/web, vendored or git-subtree'd, UNCHANGED
├─ fixtures/                     # recorded RPC sessions + contract corpus (see §3)
└─ tools/
   ├─ contract-dump/             # TS: emits encoded samples from Effect Schema
   └─ ws-tap/                    # recording WebSocket proxy
```

`ronin-server` builds a standalone binary (the `t3`/`ronin` CLI equivalent). `ronin-shell` is the Tauri
app and depends on `ronin-server` as a library, starting it in-process. This preserves today's split:
the server is usable headless, the desktop app bundles it.

### 2.2 Effect → Rust primitive mapping

The server is Effect-heavy. Do not port Effect. Port _what each Effect construct is doing_.

| Effect                            | Rust                                                  | Note                                                                                |
| --------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Effect.Effect<A, E, R>`          | `async fn(...) -> Result<A, E>`                       | Drop the R channel; pass `&AppState`/`Arc<T>` explicitly                            |
| `Layer` / `Context` (DI)          | Plain struct composition, `Arc<AppState>`             | **Do not add a DI framework.** Constructor injection is enough and stays debuggable |
| `Fiber`                           | `tokio::task::JoinHandle`, `JoinSet`                  |                                                                                     |
| `Scope` + finalizers              | `Drop` + `tokio_util::sync::CancellationToken`        | Child scopes → child tokens                                                         |
| `Queue`                           | `tokio::sync::mpsc`                                   |                                                                                     |
| `PubSub`                          | `tokio::sync::broadcast`                              | Watch the lagged-receiver case; today's subscribers must not silently drop events   |
| `Deferred`                        | `tokio::sync::oneshot`                                |                                                                                     |
| `Ref` / `SynchronizedRef`         | `Arc<Mutex<T>>` / `Arc<RwLock<T>>` (tokio)            | Read model is read-mostly → `RwLock` or `arc-swap`                                  |
| `Stream`                          | `futures::Stream` via `async-stream` / `tokio-stream` |                                                                                     |
| `Schema` (encode/decode/validate) | `serde` + explicit validators                         | See §3                                                                              |
| `Cache`                           | `moka`                                                |                                                                                     |
| `Semaphore`                       | `tokio::sync::Semaphore`                              |                                                                                     |
| `DrainableWorker`                 | mpsc + `AtomicUsize` + `Notify`                       | `drain()` awaits count == 0                                                         |
| `Data.TaggedError`                | `thiserror` enums with `#[serde(tag = "_tag")]`       | Error tags cross the wire — see §3.2                                                |

### 2.3 Dependency choices

| Concern            | Crate                                                                                       | Why                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Async runtime      | `tokio` (full)                                                                              | Non-negotiable given process + socket + fs work                                                                                                 |
| HTTP + WS server   | `axum` + `tokio-tungstenite`                                                                | Mature, tower middleware for CORS/compression                                                                                                   |
| HTTP client        | `reqwest` (rustls)                                                                          | PR providers, OpenCode, update checks                                                                                                           |
| SQLite             | `rusqlite` (bundled) + `deadpool-sqlite`                                                    | Need `VACUUM INTO`, WAL pragmas, explicit transactions. **One writer connection, a small read pool** — matches the single-writer engine exactly |
| Serialization      | `serde`, `serde_json`                                                                       |                                                                                                                                                 |
| PTY                | `portable-pty` (wezterm)                                                                    | Best-maintained; ConPTY on Windows when that phase lands                                                                                        |
| Process            | `tokio::process`                                                                            |                                                                                                                                                 |
| Git                | **shell out to `git`** via `tokio::process`                                                 | See §6.3                                                                                                                                        |
| Resource telemetry | `sysinfo`                                                                                   | Already what `native/resource-monitor` uses — absorb it in-process                                                                              |
| Secrets            | `keyring`                                                                                   | Secret Service (Linux) / Keychain (macOS) / Credential Manager (Windows)                                                                        |
| Errors             | `thiserror` (libs), `anyhow` (binaries only)                                                |                                                                                                                                                 |
| Tracing            | `tracing` + `tracing-subscriber` + `tracing-opentelemetry`                                  | Ronin proxies OTLP traces today                                                                                                                 |
| Time               | `jiff` or `chrono`                                                                          | Prefer `jiff` for correctness; either works                                                                                                     |
| Testing            | built-in + `insta` (snapshots) + `rstest`                                                   |                                                                                                                                                 |
| Shell              | `tauri` 2.x + `tauri-plugin-updater`, `-deep-link`, `-dialog`, `-shell`, `-single-instance` |                                                                                                                                                 |

### 2.4 What is deliberately _not_ being ported

Nothing. The brief is 1:1. But note two things that are already Rust or already gone:

- `native/resource-monitor` is **already Rust** (1,171 lines, `sysinfo`-based). It currently runs as a
  spawned sidecar binary that speaks JSON over stdout. In the Rust build it becomes a module — delete
  the process boundary, keep the model. Free win.
- Ronin already cut T3 Connect, the mobile app, the marketing site, WSL orchestration, Playwright
  preview automation, the legacy sidebar, and token streaming. Do not resurrect any of it from upstream
  T3 Code. `packages/contracts` still carries some `previewAutomation` surface — port what the RPC group
  actually references, nothing more.

---

## 3. The contract is the pin

This is the most important section in the document. Read it twice.

Because `apps/web` is unchanged, the Rust server must be **byte-compatible on the wire** with what
`packages/contracts` encodes. Not "equivalent". Not "close enough". The React client decodes with
Effect Schema and will hard-fail on a missing field, a wrong tag, or a date in the wrong format.

That sounds like a risk. It is actually the project's greatest asset: it converts a fuzzy "did we port
it right?" question into a mechanical, testable one.

### 3.1 Build the oracle before building the server

Two tools, both small, both in `tools/`. Build them in Phase 1. They pay for themselves in week two.

**`tools/contract-dump`** — a TypeScript script that imports every schema from `@t3tools/contracts`,
generates sample values (round-trip through `Schema.encode`), and writes them to
`fixtures/contracts/<SchemaName>.json` as an array of encoded samples. Include edge cases: empty
arrays, absent optionals, unicode, large payloads, every union branch, every error tag.

The Rust side gets a generated test per fixture file:

```rust
#[test]
fn thread_created_event_roundtrips() {
    for sample in load_fixture("ThreadCreatedEvent") {
        let decoded: ThreadCreatedEvent = serde_json::from_value(sample.clone()).unwrap();
        assert_eq!(serde_json::to_value(&decoded).unwrap(), sample);
    }
}
```

If that passes for every schema the RPC group touches, the Rust types are correct. No guessing.

**`tools/ws-tap`** — a WebSocket proxy that sits between the real React client and the real TS server,
logging every frame in both directions to `fixtures/sessions/<name>.ndjson`. Record the flows that
matter: cold boot, project add, thread create, a full turn with an approval, an interrupt, a checkpoint
revert, a terminal session, a git commit, a PR list. Then replay each recording against the Rust server
and diff responses.

This gives the agent a self-check it can run without a human in the loop, which is exactly what a long
autonomous port needs.

### 3.2 Effect RPC wire protocol

Serialization is **JSON** (`RpcSerialization.layerJson` on both ends — verified in
`apps/server/src/ws.ts:2250` and `packages/client-runtime/src/rpc/session.ts:108`). Messages are tagged
objects. From `effect/unstable/rpc/RpcMessage`:

**Client → server:** `Request`, `Ack`, `Interrupt`, `Eof`, `Ping`
**Server → client:** `Chunk`, `Exit` (carrying `Success` / `Failure` with `Fail` | `Die` | `Interrupt`),
`Defect`, `ClientEnd`, `ClientProtocolError`, `Pong`

Streaming members push `Chunk` messages and use `Ack` for backpressure; unary members resolve with a
single `Exit`. **Implement this protocol as its own crate (`ronin-rpc`) with its own conformance tests
against recorded frames** before touching business logic. Pin the `effect` version in the TS repo while
you do it — a beta bump that changes framing would be a very bad surprise mid-port. (Current pin:
`effect@4.0.0-beta.103`, patched.)

Per-method authorization is separate from the socket: `RPC_REQUIRED_SCOPES` in
`apps/server/src/auth/RpcAuthorization.ts` maps each method to a required scope, enforced by
`authorizeEffect` / `authorizeStream`. Holding a valid socket is not authorization to call everything on
it. Port the map verbatim — it is a security boundary, and a table.

### 3.3 Rules for the agent writing contract types

1. **`packages/contracts/src/*.ts` is the specification.** Open the file. Do not infer a field from a
   usage site.
2. Tagged unions use `_tag`. Use `#[serde(tag = "_tag")]`.
3. Optional fields in Effect Schema are _absent_, not `null`, unless the schema says
   `NullOr`. Use `#[serde(skip_serializing_if = "Option::is_none")]` and check the fixture.
4. Branded ID types (`ThreadId`, `TurnId`, `ProviderInstanceId`, …) become newtypes over `String` with
   `#[serde(transparent)]`. Do not use bare `String` — the type safety is worth it across 27 event types.
5. Dates cross the wire in whatever `Schema.DateTimeUtc` encodes to. Confirm against a fixture before
   choosing a Rust representation.
6. When a schema has a default, the default lives on the _decode_ side. Mirror it with
   `#[serde(default = "...")]`, and add a fixture sample with the field absent.

---

## 4. Phase plan

Fourteen phases. Each has a **goal**, **the TS files that are the spec**, and an **exit criterion that
is mechanically checkable**. Phases 4–9 are largely parallelizable across agents once Phase 3 lands.

Effort figures assume a competent agent with human review at each gate. They are calibrated relative to
each other; treat absolute numbers as ±50%.

---

### Phase 0 — Reconnaissance and freeze _(1 week)_

**Goal:** remove moving targets and produce a written behavioural spec for the ambiguous parts.

- Pin the TS repo at a commit. Every "what does it do?" question resolves against that tree.
- Freeze `effect` at `4.0.0-beta.103` in the reference checkout.
- Write `docs/port/behaviours.md` capturing the things that are _behaviour_, not structure, and would
  otherwise be lost: buffered-delivery spill rules, turn-settle semantics, retry ladder
  (`RETRY_DELAYS_MS`, 16s cap, 30s stability reset), endpoint selection order in
  `selectPairingEndpoint`, checkpoint ref naming, thread sort/snooze/settle rules.
- Stand up the Rust workspace skeleton with CI: `cargo fmt --check`, `cargo clippy -D warnings`,
  `cargo test`, `cargo deny`.

**Exit:** CI green on an empty workspace; `behaviours.md` reviewed by a human.

---

### Phase 1 — Contracts and the oracle _(3–4 weeks)_

**Goal:** `ronin-contracts` + `ronin-rpc`, plus both verification tools.

**Spec:** all of `packages/contracts/src/` (16,851 lines, ~50 files, of which ~11k is non-test).
`orchestration.ts` (1,723), `providerRuntime.ts` (1,214), `rpc.ts` (1,021),
`previewAutomation.ts` (883), `pullRequest.ts` (800), `settings.ts` (793), `server.ts` (650) are the
big ones. `ipc.ts` (1,252) is desktop-shell surface — defer it to Phase 11.

Order of work:

1. `baseSchemas.ts`, `model.ts`, branded IDs → newtypes.
2. `orchestration.ts` — commands, events, read model. This is the spine.
3. The rest of the domain modules.
4. `tools/contract-dump`, then generated round-trip tests. **Do not skip to step 5 until every fixture
   passes.**
5. `ronin-rpc`: message framing, request/stream lifecycle, ack backpressure, interrupt.
6. `tools/ws-tap` and the first recorded sessions.

**Exit:** every contract fixture round-trips; `ronin-rpc` replays a recorded cold-boot handshake and
produces byte-identical frames.

---

### Phase 2 — Persistence _(2–3 weeks)_

**Goal:** `ronin-db` — schema, migrations, event store, projection tables.

**Spec:** `apps/server/src/persistence/` (6,639 lines), 40 migrations, `NodeSqliteClient.ts`,
`Layers/OrchestrationEventStore.ts`, the 11 `Projection*.ts` layers.

- Reproduce all 40 migrations. **Do not squash them.** Existing users have databases at various
  versions; a Rust build that cannot open a real `~/.t3/userdata/state.sqlite` is not a port.
- Match pragmas exactly (WAL, busy_timeout, foreign_keys, synchronous).
- Single writer connection + read pool. Transactions are explicit and wrap
  append-events + apply-projections + write-receipt as one unit.
- Port the two data-migration migrations that contain logic, not just DDL:
  `016_CanonicalizeModelSelections`, `026_CanonicalizeModelSelectionOptions`,
  `024_BackfillProjectionThreadShellSummary`, `025_CleanupInvalidProjectionPendingApprovals`,
  `035_ProjectionThreadTitleRegeneration`.

**Exit:** point the Rust migrator at a `VACUUM INTO` snapshot of a real database (per `AGENTS.md`,
never the live file) and have it open cleanly, report the same schema version, and return identical
projection query results to the TS server for the same inputs.

---

### Phase 3 — Orchestration engine _(4–6 weeks)_

**Goal:** `ronin-orchestration`. The single highest-value, highest-risk phase.

**Spec:** `apps/server/src/orchestration/` (13,799 lines). Priority order:
`decider.ts` → `commandInvariants.ts` → `projector.ts` → `Layers/OrchestrationEngine.ts` →
`Layers/ProjectionPipeline.ts` → `Layers/ProjectionSnapshotQuery.ts` → the reactors.

- Port `DrainableWorker` first (`packages/shared/src/DrainableWorker.ts`).
- The decider is **pure**. Port it as a pure function: `fn decide(state: &ReadModel, cmd: &Command) ->
Result<Vec<Event>, DeciderError>`. No async, no IO, no `Arc`. This makes it trivially testable and it
  is the piece where correctness matters most.
- Port the decider's test suite alongside it — `decider` and `projector` tests in the TS repo are the
  best spec you will get for edge cases.
- The engine's serial command worker: one `tokio::task` draining an mpsc, each envelope carrying a
  `oneshot` for its result.
- Read model in `arc-swap` or `RwLock`; swap after commit.
- Reconciliation on dispatch failure: re-read events past the starting sequence, rebuild, retry.

**Exit:** replay the full orchestration event corpus from a real database through the Rust projector and
produce a read model that is deep-equal to the TS projector's output for the same events. Build a
differential test harness for this — it is worth the day it costs.

---

### Phase 4 — VCS and checkpointing _(3–4 weeks)_

**Goal:** `ronin-vcs`.

**Spec:** `apps/server/src/vcs/` (5,504), `apps/server/src/checkpointing/` (610),
`apps/server/src/git/` (2,738), `packages/shared` git helpers.

- Shell out to `git`, mirroring `VcsProcess.ts` command construction argument-for-argument. See §6.3.
- `VcsDriver` trait mirroring `VcsDriver.ts`, including `VcsCheckpointOps`.
- Hidden-ref checkpoint naming from `checkpointing/Utils.ts` — must match exactly or existing
  checkpoints become invisible.
- Diff parsing (`Diffs.ts`) → port and snapshot-test with `insta` against real patches.
- Worktree create/remove, ref list/create/switch, status broadcaster with its coalescing behaviour.

**Exit:** against a scratch repo, every `vcs.*` and `git.*` RPC method returns output byte-identical to
the TS server; checkpoints written by the TS server are readable and revertible by the Rust server and
vice versa.

---

### Phase 5 — Terminals _(2 weeks)_

**Goal:** `ronin-terminal`.

**Spec:** `apps/server/src/terminal/` (3,093) — `Manager.ts`, `PtyAdapter.ts`, `NodePtyAdapter.ts`.

- `portable-pty` replaces `node-pty`. Same lifecycle: open, attach, write, resize, clear, restart,
  close.
- Terminal sessions are **server-owned PTYs streaming raw bytes**; renderer choices never cross the
  wire (per `docs/architecture/terminal-renderers.md`). The Ghostty WASM renderer in `apps/web` is
  untouched by this port — it just needs the same byte stream.
- Fanout: multiple attached clients, scrollback capture and replay. Note the subtlety documented for
  the web renderer: restoring captured scrollback temporarily detaches the PTY callback so historical
  device queries cannot emit replies into the live shell. The server side must keep the same
  scrollback semantics for that to hold.
- Keyed coalescing worker for resize (`packages/shared/src/KeyedCoalescingWorker.ts`).

**Exit:** the real UI opens a terminal, runs `vim`, resizes, splits, restarts, and closes — visually
indistinguishable from today.

---

### Phase 6 — Auth, HTTP, and server lifecycle _(3 weeks)_

**Goal:** `ronin-auth` + `ronin-server` HTTP surface + startup.

**Spec:** `apps/server/src/auth/` (3,397), `apps/server/src/http.ts`, `ws.ts` (2,293),
`server.ts` (569), `serverRuntimeStartup.ts`, `packages/contracts/src/environmentHttp.ts`.

- All 16 endpoints, exact paths and shapes. Notably: `POST /oauth/token` implements RFC 8693
  token-exchange framing with `urn:t3:params:oauth:token-type:environment-bootstrap` as the private
  subject-token type; `POST /api/auth/websocket-ticket` mints a 5-minute single-purpose ticket appended
  to the socket URL as `wsTicket`.
- Scope subset checking on exchange. An ordinary paired client cannot escalate to `access:read`/
  `access:write`.
- `SessionStore` TTLs: `DEFAULT_SESSION_TTL` 30 days, `DEFAULT_WEBSOCKET_TOKEN_TTL` 5 minutes.
- The startup lifecycle is **ordered and observable**, and clients depend on the order: start
  keybindings/settings/reactors → publish welcome → signal command readiness (logs `Accepting
commands`) → wait for the HTTP listener via `markHttpListening` → publish ready → fork heartbeat →
  headless output or open browser. **Command readiness precedes the listener** so a socket that opens
  can already dispatch.
- `environment-id` persisted at `<stateDir>/environment-id`, generated on first start.

**Exit:** the real React client completes pairing, opens `/ws`, receives `initialConfig`, and reaches
`connected`. Scope-violation tests: a standard-scope session is rejected on `access:*` methods.

---

### Phase 7 — Providers _(6–8 weeks; the long pole)_ 🟡 PARTIAL

**Goal:** `ronin-provider` — trait + registries + 5 drivers.

**Spec:** `apps/server/src/provider/` (28,653), `packages/effect-acp` (15,061),
`packages/effect-codex-app-server` (46,989 — mostly generated schema).

Sequence, deliberately ordered by risk:

1. **Trait + registries + `ProviderService` + session directory + reaper.** No driver yet. Land the
   plumbing with a fake in-memory driver, and get `ProviderRuntimeIngestion` and
   `ProviderCommandReactor` (Phase 3 leftovers) driving it end to end.
2. **ACP client crate** → unlocks **Cursor** and **Grok** together. Port `packages/effect-acp` protocol
   types + the two extensions (`CursorAcpExtension.ts`, `XAiAcpExtension.ts`).
3. **Codex** — `codex app-server` JSON-RPC. `packages/effect-codex-app-server/src/_generated/` is
   generated from a schema; regenerate for Rust rather than hand-porting 47k lines.
4. **OpenCode** — spawn `opencode serve`, `reqwest` + SSE.
5. **Claude** — spawn the CLI and speak its NDJSON protocol; see §6.1, which is closed. No longer the risky one, so it need not be last.

Each driver also needs its `textGeneration` counterpart (`apps/server/src/textGeneration/`, 2,597
lines) for thread titles and summaries, and its status/capability probe.

**Exit:** for each provider, a full turn runs from the real UI: start session → stream assistant output
→ hit an approval → respond → complete → checkpoint → diff renders. Record each as a `ws-tap` session
and add to the replay suite.

---

### Phase 8 — Source control and pull requests _(4–5 weeks)_ 🟡 PARTIAL

**Goal:** `ronin-scm`.

**Spec:** `apps/server/src/pullRequest/` (10,379) + `apps/server/src/sourceControl/` (5,808).

Four providers × (list, listStats, detail, activity, diff file contents, run action, comment, submit
review, reply to thread, set thread resolution, reviewer candidates, request reviewers). GitHub /
GitLab / Azure DevOps go through their CLIs (`gh`, `glab`, `az`); Bitbucket goes through its REST API.

This phase is wide but shallow — mostly process invocation, JSON parsing, and mapping. Good candidate
for parallel agents, one per provider, against a shared trait.

**Exit:** the PR route (`_chat.pull-requests.tsx`, 1,498 lines of UI) is fully functional against a real
GitHub repo; other providers verified against fixtures.

---

### Phase 9 — Supporting services _(3–4 weeks, parallelizable)_

Each of these is independent. Fan them out.

| Crate/module           | Spec                                                                                             | Notes                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ronin-usage`          | `usage/` (1,449)                                                                                 | Scans provider transcript files (not Ronin's own projections), memoises per file by `(size, mtime)`. Cold 30-day scan of ~1.4GB ≈ 2–3s in Node — Rust should beat it comfortably. Powers the Usage page. |
| `ronin-telemetry`      | `resourceTelemetry/` (3,385) + `native/resource-monitor`                                         | Absorb the existing Rust sidecar in-process. Keep the attribution model and history retention.                                                                                                           |
| Workspace/filesystem   | `workspace/` (1,401)                                                                             | Entries, search index, file read/write, browse                                                                                                                                                           |
| Diagnostics            | `diagnostics/` (747)                                                                             | Process diagnostics, trace diagnostics, resource history                                                                                                                                                 |
| Settings + keybindings | `serverSettings.ts`, `keybindings.ts`, `contracts/settings.ts` (793), `contracts/keybindings.ts` | Keybinding `when`-expression parser with depth limit 64, max 256 bindings                                                                                                                                |
| Preview port scanning  | `preview/` (827)                                                                                 | `PortScanner.ts` discovers local dev servers                                                                                                                                                             |
| `ronin-mcp`            | `mcp/` (1,465)                                                                                   | MCP HTTP server, session registry, preview automation broker                                                                                                                                             |
| Project services       | `project/` (736)                                                                                 | Favicon resolver, setup script runner, repository identity, `t3.json` loader                                                                                                                             |
| Background policy      | `background/` (450)                                                                              | Host power monitor, background policy                                                                                                                                                                    |
| Assets/attachments     | `assets/`, `attachmentStore.ts`                                                                  | Image attachments in the composer                                                                                                                                                                        |

**Exit:** Settings → every panel loads and mutates; Usage page renders real numbers; Diagnostics shows
live process/resource data.

---

### Phase 10 — Server feature-complete gate 🚩 _(2 weeks)_

**Goal:** run the **unmodified React client** against the Rust server for a full working day.

This is the project's most important milestone. Do not proceed past it on partial results.

Checklist, derived from `AGENTS.md`'s "hit every surface" rule:

- [ ] Every one of the 93 RPC members implemented and exercised
- [ ] All recorded `ws-tap` sessions replay without a diff
- [ ] Every entry point for each behaviour: chat view, Settings, command palette, keybinding
- [ ] All 5 providers, including "not supported here" decisions where they exist
- [ ] Every reverse state: snooze/unsnooze, close/reopen, archive/unarchive, pin/unpin, settle/unsettle
- [ ] Connection modes: local, LAN bearer, Tailscale
- [ ] A real user database opens, migrates, and renders

**Exit:** a human uses the Rust backend with the Electron client for a day and files no
blocking bugs. Yes — Electron. The shell has not been ported yet, and that is deliberate: it isolates
backend defects from shell defects.

---

### Phase 11 — Tauri shell _(4–6 weeks)_ 🟡 PARTIAL

**Goal:** `ronin-shell` replaces `apps/desktop` (29,349 lines).

**Spec:** `apps/desktop/src/` + `packages/contracts/src/ipc.ts` (1,252) + 74 IPC channels.

| Electron                       | Tauri                                          |
| ------------------------------ | ---------------------------------------------- |
| `BrowserWindow`                | `WebviewWindow`                                |
| `ipcMain`/`contextBridge`      | `#[tauri::command]` + `invoke`                 |
| `protocol.handle("t3code://")` | `register_uri_scheme_protocol`                 |
| `safeStorage`                  | `keyring` crate                                |
| `electron-store`               | serde JSON at the same paths                   |
| `electron-updater`             | `tauri-plugin-updater`                         |
| `Menu` / `dialog`              | `tauri::menu` / `tauri-plugin-dialog`          |
| `powerMonitor`                 | logind DBus (Linux) / IOKit (macOS) — see §6.4 |
| `WebContentsView` (preview)    | Tauri child webviews — see §6.2 ⚠️             |
| Deep links                     | `tauri-plugin-deep-link`                       |

**Critical compatibility requirement:** the renderer calls `window.desktopBridge.*`. Do **not** change
the renderer. Ship a small preload-equivalent (Tauri `initialization_script`) that defines
`window.desktopBridge` with the same 74-method shape, forwarding to `invoke`. That keeps `apps/web`
byte-identical and makes the shell swap invisible to the UI.

Also port: the backend pool/manager (desktop supervises a scoped server), local environment auth
bootstrap, network interface enumeration, server exposure modes (`local-only` /
`network-accessible`), the Tailscale endpoint provider, and the update state machine
(`updates/updateMachine.ts`).

Watch the **Window Controls Overlay**: `tokens.css` defines a `wco` custom variant active "when
Electron exposes native titlebar control geometry". Tauri needs an equivalent — custom decorations plus
a CSS variable feed for control geometry — or the titlebar layout breaks.

**Exit:** Tauri app boots, loads the real UI, spawns the Rust backend, and passes the Phase 10
checklist again — this time with no Electron anywhere.

---

### Phase 12 — SSH and remote _(2–3 weeks)_ 🟡 PARTIAL

**Goal:** `ronin-ssh` + desktop-managed remote environments.

**Spec:** `packages/ssh/` (3,371), `apps/desktop/src/ssh/DesktopSshEnvironment.ts`,
`packages/tailscale/` (740).

`discoverHosts` (SSH config + known_hosts) → `ensureEnvironment` (resolve target, launch or reuse remote
server, open local tunnel, HTTP readiness check, optionally issue a remote pairing token, return local
HTTP/WS endpoints) → `disconnectEnvironment` (close tunnel; stop remote server only if we started it —
a server marked `external` is left running).

Failure handling is explicit and must be preserved: SSH auth failure surfaces _before_ an environment is
saved; remote launch failure includes launcher output; forwarded-port failure leaves the environment
disconnected rather than silently falling back to an unrelated endpoint.

Tailscale: `ensureTailscaleServe` at startup for the actual listening port, `disableTailscaleServe` on
scope close. Endpoint keys are provider-specific and stable (`tailscale-ip:`, `tailscale-magicdns:`)
because LAN addresses change with networks.

**Exit:** connect to a remote box over SSH from the Tauri app; connect over Tailscale from a browser.

---

### Phase 13 — Packaging, updates, and release _(3 weeks)_

**Spec:** `scripts/build-desktop-artifact.ts`, `scripts/merge-update-manifests.ts`,
`scripts/resolve-nightly-release.ts`, `docs/operations/release.md`, `release/builder-debug.yml`.

- Linux AppImage first (Ronin's primary artifact), then `.deb`; macOS `.dmg` arm64 + x64.
- Artifact naming stays `Ronin-${version}-${arch}.${ext}` — the update manifest merge logic and the
  release smoke test both depend on it.
- `tauri-plugin-updater` signing keys; port the `latest`/`nightly` channel split.
- Port `scripts/mock-update-server.ts` so update flows stay testable offline.
- CLI parity: `ronin serve`, `ronin pair`, `ronin auth`, `ronin project`, `ronin service`
  (`apps/server/src/cli/`, 2,167 lines).
- Bundle size sanity check: expect roughly 10–30 MB vs Electron's ~150 MB+ on Linux.

**Exit:** `release-smoke` equivalent passes on a fresh Linux VM and a fresh macOS machine; an installed
build updates itself from N-1 to N.

---

### Phase 14 — Windows _(3–4 weeks, optional)_

ConPTY via `portable-pty`, WebView2 quirks, NSIS packaging, path handling, credential manager. Explicitly
last, per the platform decision. Note Ronin has **no WSL support** and this port must not add it.

---

## 5. Timeline

```
Phase                          Weeks    Cumulative
0  Recon & freeze                 1          1
1  Contracts + oracle           3–4        4–5
2  Persistence                  2–3        6–8
3  Orchestration engine         4–6      10–14   ← highest risk
4  VCS + checkpointing          3–4      13–18
5  Terminals                      2      15–20
6  Auth + HTTP + lifecycle        3      18–23
7  Providers                    6–8      24–31   ← longest pole
8  Source control + PRs         4–5      28–36
9  Supporting services          3–4      31–40
10 ▸ SERVER-COMPLETE GATE ◂       2      33–42
11 Tauri shell                  4–6      37–48
12 SSH + remote                 2–3      39–51
13 Packaging + release            3      42–54
14 Windows (optional)           3–4      45–58
```

**Serial:** ~10–13 months. **With 3–4 parallel agents after Phase 3:** ~7–9 months. Phases 4, 5, 8, 9
are genuinely independent once the engine lands; Phase 7's five drivers are independent of each other
once the trait lands.

---

## 6. Risk register

Ranked by expected pain. Read these before committing to the plan.

### 6.1 🔴 Claude provider has no Rust SDK

`ClaudeAdapter.ts` imports `@anthropic-ai/claude-agent-sdk` — a Node package. There is no Rust
equivalent, and it is one of the five headline providers.

Three options:

1. **Reimplement the protocol in Rust.** The SDK is a wrapper over the `claude` CLI in
   `--output-format stream-json --input-format stream-json` mode plus a control protocol for approvals,
   MCP wiring, and session control. `ClaudeAdapter.ts` already handles the raw event shapes and is the
   best available documentation. Highest effort, best outcome, no Node in the shipped product.
2. **Node sidecar.** Ship a small bundled Node process for Claude only, speaking JSON-RPC to the Rust
   server over stdio. Fast, low-risk, but reintroduces a Node runtime into a Rust app — which is most
   of what the port was meant to remove.
3. **Ship without Claude first**, add it in a follow-up. Violates the 1:1 brief.

**Recommendation:** time-box a 1-week spike on option 1 during Phase 7 with option 2 pre-built as the
fallback. Decide on evidence. Do not let this block the other four drivers — sequence Claude last.

Note also that the Claude adapter wires MCP (`mcp/McpProviderSession.ts`) and resolves executables and
skills (`ClaudeExecutable.ts`, `ClaudeSkills.ts`, `ClaudeHome.ts`), so the surface is wider than the SDK
call itself.

### 6.2 🔴 Preview: embedded webviews

Electron's preview embeds a `WebContentsView` in the window and drives it through ~30 IPC channels
(navigate, back/forward, zoom, colour scheme, devtools, clear cookies/cache, screenshot, recording,
annotation theme, element pick, PiP). Ronin already cut Playwright automation and element picking from
upstream, which helps — but tabs, navigate, screenshot, and recording remain.

Tauri 2 supports child webviews (`WebviewWindow::add_child`), but it is a less-travelled path and
**WebKitGTK is the weakest of the three engines for it** — which is exactly the primary platform.

Mitigations, in order of preference:

1. Child webviews via Tauri's multiwebview API. Spike this in **Phase 1**, not Phase 11 — if it does not
   work on WebKitGTK, you want 40 weeks of warning, not 4.
2. A separate always-on-top window positioned over the preview pane. Works everywhere, feels worse,
   breaks on tiling WMs.
3. An `<iframe>` for same-origin-permissive targets, with the native path only where needed. Loses
   cross-origin dev servers, screenshots, and cookie control.

### 6.3 🟡 Git: shell out, do not use libgit2

Tempting to reach for `git2`. Don't.

Ronin's VCS layer already shells out (`VcsProcess.ts`) and depends on real-`git` behaviour that libgit2
does not cover well: worktree management, hidden checkpoint refs, stacked-branch actions, and the exact
text of git's output in several places. Behavioural parity is the entire point of this port.

Mirror the command construction argument-for-argument, and snapshot-test the parsers with `insta`
against real output. This also keeps `git` config, credential helpers, hooks, and signing working
exactly as users have them configured.

### 6.4 🟡 Power monitor and background policy

`ElectronPowerMonitor.ts` feeds `serverReportHostPowerState`, which drives `background/BackgroundPolicy`
— how Ronin behaves when the machine sleeps or the app backgrounds. Tauri has no equivalent API.

Linux: `org.freedesktop.login1` over DBus (`zbus`). macOS: `IOKit` / `NSWorkspace` notifications via
`objc2`. Small but genuinely platform-specific work; budget it in Phase 11 rather than discovering it.

### 6.5 🟡 Effect RPC protocol drift

You are reimplementing an _unstable_ API (`effect/unstable/rpc`) from a **beta** dependency
(`4.0.0-beta.103`, patched in `patches/`). A framing change upstream breaks the Rust server silently.

Mitigations: pin hard; keep the recorded-frame conformance suite in CI; treat any `effect` bump in the
reference repo as a protocol review, not a dependency bump.

### 6.6 🟡 Performance regressions in the "wrong" direction

Rust will be faster than Node at almost everything here. The risk is not throughput — it is the
performance properties Ronin _deliberately_ tuned, which a naive port loses:

- WebSocket payload sizes (`AGENTS.md`: regressions are "often caused by sending too much data over
  websockets"). Match message shapes and coalescing, not just semantics.
- The coalescing/debouncing in the VCS status broadcaster and the keyed resize worker.
- The read-model swap must not block subscribers.
- `tokio::sync::broadcast` drops messages for lagged receivers. Effect's `PubSub` does not behave that
  way by default. **Audit every broadcast use** — a silently dropped orchestration event is a stale UI,
  the exact failure Ronin's users notice.

### 6.7 🟢 Effect Schema semantics in serde

Absent vs `null`, defaults on decode, refinement failures, forward-compatible arrays
(`ForwardCompatibleArray` in `baseSchemas.ts` — unknown elements are tolerated, which serde will not do
by default). The fixture corpus from §3.1 catches all of these mechanically. This is only green
_because_ Phase 1 builds the oracle; without it, this is a red risk.

### 6.8 🟢 Test suite loss

602 test files do not port. Effect-based tests are not translatable, and rewriting them 1:1 would double
the project.

Do not try. Instead:

- port the **pure** test suites, which are the valuable ones and the easiest: `decider`, `projector`,
  `commandInvariants`, diff parsing, contract schemas;
- rely on the fixture corpus and session replay for integration coverage;
- write Rust tests for behaviour you had to _decide_ rather than _read_.

Target: every behaviour in `docs/port/behaviours.md` has a Rust test.

---

## 7. Working agreement for the agent

Rules for whoever (or whatever) builds this. These exist because a port fails through a thousand small
inventions, not one big mistake.

1. **The TypeScript repo is the specification.** When behaviour is unclear, open the file. Never infer a
   behaviour from a call site, a test name, or this document. This document is a map, not the territory.
2. **Never invent a wire format.** If the shape is not in `packages/contracts`, it does not cross the
   wire. If you think a field should be added, that is a product change — stop and ask.
3. **Port behaviour, not structure.** Effect idioms are load-bearing in TypeScript and noise in Rust. A
   faithful port of `Layer` composition into a Rust DI framework is a _worse_ port than plain
   constructors.
4. **One phase, one gate.** Do not start Phase N+1 until Phase N's exit criterion is mechanically
   checkable and checked.
5. **Every phase ships a test that fails without it.** No exceptions.
6. **Never touch `apps/web`.** If the renderer needs a change to work with the Rust backend, the backend
   is wrong. The single sanctioned exception is the `window.desktopBridge` shim in Phase 11, and that is
   additive.
7. **Never run against `~/.t3/userdata`.** It is the developer's live database. Copy from it with
   `VACUUM INTO` per `AGENTS.md`; never open it read-write, never start a server against it.
8. **Never kill processes by pattern.** No `pkill -f`, no `pgrep | kill`. Track PIDs at spawn. This
   repo's own guide calls it one of the three ways to hurt yourself, and it is worse in a port where two
   servers run side by side.
9. **When the Rust and TS servers disagree, the TS server is right** — until a human says otherwise.
   Record the disagreement in `docs/port/deviations.md` with a justification.
10. **Prefer boring Rust.** No `unsafe` outside a reviewed FFI boundary. No macro cleverness in domain
    code. The next agent has to read this.

---

## 8. First week, concretely

If you are the agent picking this up, here is the actual first move. It is deliberately small.

1. `cargo new --lib crates/ronin-contracts` inside a new workspace; wire CI.
2. Write `tools/contract-dump/index.ts`. Start with **one** schema: `ThreadId` and
   `ThreadCreatedEvent`. Emit `fixtures/contracts/*.json`.
3. Hand-write the matching Rust types. Make the round-trip test pass.
4. Now do `orchestration.ts` in full — all 27 events, all commands, the read model. This is a
   grind and it is the right grind: everything downstream types against it.
5. In parallel, spike **Phase 6.2** (Tauri child webview on WebKitGTK) as a throwaway. One day.
   It is the answer that most changes the plan, and it is cheap to get now and expensive to get late.

Do not start the orchestration engine. Do not start a provider. Contracts first, oracle first.

---

## 9. Open questions for the human

Flagging these now rather than discovering them in month six:

1. **Does the fork intend to track upstream T3 Code?** If yes, a Rust rewrite forks permanently — every
   upstream change becomes a manual port. If no, this is fine. This is a strategy question, not an
   engineering one, and it should be answered before Phase 1.
2. **Is Claude-via-Node-sidecar acceptable as a permanent fallback** if the protocol spike fails?
   (§6.1)
3. **Is preview allowed to degrade on Linux** — a separate overlay window instead of an embedded
   webview — if Tauri child webviews prove unstable on WebKitGTK? (§6.2)
4. **Is the MCP server in scope for v1?** It is 1,465 lines and serves preview automation, which Ronin
   already trimmed. Deferring it would shorten Phase 9 meaningfully.
5. **Windows: in or out?** The platform answer put it last; "last" and "never" are different plans and
   they change the PTY and packaging design.

---

## Appendix A — Module port map

Reference table. Left is the spec; right is where it lands.

| TypeScript                                                                                              |    LOC¹ | Rust crate                    | Phase |
| ------------------------------------------------------------------------------------------------------- | ------: | ----------------------------- | :---: |
| `packages/contracts/src/`                                                                               |     11k | `ronin-contracts`             |   1   |
| `effect/unstable/rpc` (protocol only)                                                                   |       — | `ronin-rpc`                   |   1   |
| `apps/server/src/persistence/`                                                                          |   6,639 | `ronin-db`                    |   2   |
| `apps/server/src/orchestration/`                                                                        |  13,799 | `ronin-orchestration`         |   3   |
| `packages/shared/src/DrainableWorker.ts`                                                                |    ~150 | `ronin-orchestration::worker` |   3   |
| `apps/server/src/vcs/`                                                                                  |   5,504 | `ronin-vcs`                   |   4   |
| `apps/server/src/checkpointing/`                                                                        |     610 | `ronin-vcs::checkpoint`       |   4   |
| `apps/server/src/git/`                                                                                  |   2,738 | `ronin-vcs::workflow`         |   4   |
| `apps/server/src/terminal/`                                                                             |   3,093 | `ronin-terminal`              |   5   |
| `apps/server/src/auth/`                                                                                 |   3,397 | `ronin-auth`                  |   6   |
| `apps/server/src/ws.ts`, `http.ts`, `server.ts`                                                         |   3,180 | `ronin-server`                |   6   |
| `apps/server/src/provider/`                                                                             |  28,653 | `ronin-provider`              |   7   |
| `packages/effect-acp/`                                                                                  |  15,061 | `ronin-provider::acp`         |   7   |
| `packages/effect-codex-app-server/`                                                                     | 46,989² | `ronin-provider::codex`       |   7   |
| `apps/server/src/textGeneration/`                                                                       |   2,597 | `ronin-provider::textgen`     |   7   |
| `apps/server/src/pullRequest/`                                                                          |  10,379 | `ronin-scm::pr`               |   8   |
| `apps/server/src/sourceControl/`                                                                        |   5,808 | `ronin-scm`                   |   8   |
| `apps/server/src/usage/`                                                                                |   1,449 | `ronin-usage`                 |   9   |
| `apps/server/src/resourceTelemetry/` + `native/resource-monitor`                                        |  4,556³ | `ronin-telemetry`             |   9   |
| `apps/server/src/workspace/`                                                                            |   1,401 | `ronin-server::workspace`     |   9   |
| `apps/server/src/mcp/`                                                                                  |   1,465 | `ronin-mcp`                   |   9   |
| `apps/server/src/{diagnostics,project,preview,background,assets,environment,review,process,telemetry}/` |  ~4,000 | `ronin-server::*`             |   9   |
| `apps/server/src/cli/`                                                                                  |   2,167 | `ronin-server::cli`           |  13   |
| `apps/desktop/src/`                                                                                     |  29,349 | `ronin-shell`                 |  11   |
| `packages/ssh/`                                                                                         |   3,371 | `ronin-ssh`                   |  12   |
| `packages/tailscale/`                                                                                   |     740 | `ronin-server::tailscale`     |  12   |
| `apps/web/`                                                                                             | 174,288 | **unchanged**                 |   —   |
| `packages/client-runtime/`                                                                              |  27,695 | **unchanged**                 |   —   |

¹ Non-test where stated in §1.6; otherwise total.
² Mostly generated schema — regenerate for Rust, do not hand-port.
³ Includes 1,171 lines already in Rust.

## Appendix B — Files to read first

In this order. Roughly two days of reading, and it will save weeks.

1. `AGENTS.md` — the maintainers' rules; several are safety rules, not style
2. `docs/internals/overview.md` — the architecture in one page
3. `docs/internals/glossary.md` — vocabulary, with file links for every term
4. `packages/contracts/src/orchestration.ts` — the domain, all 1,723 lines
5. `apps/server/src/orchestration/decider.ts` — pure command→event logic
6. `apps/server/src/orchestration/projector.ts` — event→read-model
7. `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` — the serial loop
8. `apps/server/src/provider/Services/ProviderAdapter.ts` — the 13-member trait
9. `packages/shared/src/DrainableWorker.ts` — the determinism primitive
10. `apps/server/src/ws.ts` — the RPC surface, all 101 members
11. `docs/internals/connection-runtime.md` — client-side connection state machine
12. `docs/internals/environment-auth.md` — the scope model
13. `docs/internals/remote.md` — why the server is a server

# Ronin defect audit

Read-only pass over first-party **desktop**, **web**, and **server** on `main` (`ac58f702`). Confirmed from source. Nothing in this document was fixed.

Scope: `apps/desktop`, `apps/web`, `apps/server`, plus desktop-adjacent `packages/client-runtime` call sites. Out of scope: vendor `.repos/`, style nits, speculative a11y on hover actions that already restore on `focus-visible`.

**45** confirmed findings: **1 P0**, **18 P1**, **20 P2**, **6 P3**.

## Highest-impact clusters

1. **Desktop protocol proxy** can fetch attacker `http(s)` and serve it as privileged `t3code://app`.
2. **Checkpoint revert** restores disk first, then can fail provider rollback — and several providers cannot roll back at all. Settled threads cannot restore.
3. **Failed chat send** can leave a ghost user message and drop the prompt if the user types while the request is in flight.
4. **Pairing** spends the one-time token on both client and server before a session exists.

## Severity

| Level | Meaning                                       |
| ----- | --------------------------------------------- |
| P0    | Universal release blocker or critical failure |
| P1    | Urgent defect that should be fixed next       |
| P2    | Ordinary defect that should be fixed          |
| P3    | Low-impact issue that is still worth fixing   |

---

## P0

### [P0] Logical — Desktop — Custom-protocol proxy can fetch arbitrary http(s) as `t3code://app`

`apps/desktop/src/electron/ElectronProtocol.ts:139`

`proxyRequest` builds the upstream URL with `new URL(pathname + search, targetOrigin)`. A protocol-relative path `//evil.example/` leaves the backend origin. `Electron.net.fetch` then serves that body under `t3code://app`, which `isTrustedDesktopIpcSender` and `will-navigate` treat as the privileged renderer origin. `protocol.handle` is process-wide, so a preview guest can hit the same handler.

---

## Desktop

### [P1] Logical — No single-instance lock; second launch starts another backend on shared SQLite

`apps/desktop/src/app/DesktopLifecycle.ts`, `apps/desktop/src/main.ts`

There is no `requestSingleInstanceLock` / `second-instance`. A second packaged launch on Windows/Linux starts another Electron process, another backend port scan, and another writer on the same `T3CODE_HOME` / `~/.ronin` userdata database.

### [P1] Logical — `t3code://` is registered but never consumed

`apps/desktop/src/app/DesktopLinuxUrlHandler.ts:14`, `apps/desktop/src/app/DesktopLifecycle.ts:171`

Linux writes a URL-handler desktop file and electron-builder registers protocols, but there is no `open-url` listener, no argv parse, and no `second-instance` forward. OAuth/deep-link tokens never reach the running renderer. Combined with no single-instance lock, Linux often starts a second app that still loads `t3code://app/`.

### [P1] Logical — Windows packages never register as a URL handler

`scripts/build-desktop-artifact.ts:1180`

`mac.protocols` and `linux.protocols` include `t3code` / `t3code-dev`. The `win` block only sets icon/signing, so Windows has no custom-scheme association for the OAuth path the Linux comments describe.

### [P1] Logical — Permission check grants all media; request handler is audio-only

`apps/desktop/src/window/DesktopWindow.ts:410`

`setPermissionRequestHandler` only allows `mediaTypes` every `=== "audio"`. `setPermissionCheckHandler` returns true for any `permission === "media"` on the main window, with no `mediaTypes` filter. Electron can skip the prompt and allow camera `getUserMedia` on the privileged session.

### [P1] UI/UX — Preview pick-element and native PiP are no-ops; chrome still offers them

`apps/desktop/src/preview/Manager.ts:1110`, `apps/web/src/components/preview/PreviewView.tsx:324`

`pickElement` always returns `null`; `openPictureInPicture` / `closePictureInPicture` are empty. The renderer still shows pick mode and Pop out preview. Clicks IPC, get nothing, clear the spinner or never toggle the menu — a lying control, not a hidden flag.

### [P2] Coding — `T3CODE_DISABLE_AUTO_UPDATE` is parsed and never read

`apps/desktop/src/app/DesktopConfig.ts:52`, `apps/desktop/src/app/DesktopAutoUpdate.ts:64`

`DesktopConfig` records `disableAutoUpdate`. `desktopAutoUpdateLayer` only checks packaged + Linux AppImage. The renderer still `bridge.check()` on mount. The env var cannot turn updates off.

### [P2] Logical — Menu actions during load stack unbounded `did-finish-load` listeners

`apps/desktop/src/window/DesktopWindow.ts:870`

If the main frame is loading, each menu/key action registers another `once("did-finish-load")` and returns. Repeated Settings clicks during startup all fire after load. `did-fail-load` does not clear them, so the first action is lost until a later successful load replays the queue.

### [P2] UI/UX — Windows dock badge is a silent no-op

`apps/desktop/src/electron/ElectronApp.ts:191`, `apps/web/src/components/DockAttentionBadge.tsx:26`

Comments admit `app.setBadgeCount` does nothing useful on Windows. The renderer still sets the Needs you count. No overlay-icon fallback, so Windows users never see the attention signal macOS/Linux can show.

### [P2] Logical — Stable mac/linux packages also claim `t3code-dev`

`scripts/build-desktop-artifact.ts:1185`

Shipping artifacts register both `t3code` and `t3code-dev`. A packaged install can steal `t3code-dev://` from a concurrent `vp run dev` desktop, or the OS can send dev callbacks to the stable binary that only handles `t3code:`.

### [P2] Logical — Primary desktop bearer token is cached for process life

`apps/desktop/src/backend/DesktopLocalEnvironmentAuth.ts:48`

Main caches the first `access_token` in a `Ref` with no 401/expiry/backend-restart clear. The renderer memoizes the same Promise on `window`. After a local server restart the desktop primary stays on a dead bearer until the Electron process restarts.

### [P3] UI/UX — Packaged View menu always exposes Reload / Force Reload / DevTools

`apps/desktop/src/window/DesktopApplicationMenu.ts:162`

Those roles are not gated on `isDevelopment`. Packaged users can open DevTools on the privileged renderer that holds tokens and `desktopBridge`.

### [P3] Coding — `will-attach-webview` forces `contextIsolation` false for preview partitions

`apps/desktop/src/window/DesktopWindow.ts:502`

Intentional for the React picker, with sandbox as mitigation. Combined with app-wide `t3code` protocol handling, a guest sharing `globalThis` with preload is a thinner wall than the comments imply.

---

## Web

### [P1] UI/UX — Settings Escape always leaves Settings

`apps/web/src/routes/settings.tsx:51`

The layout listens for Escape globally, `preventDefault`s, blurs the focused control, and navigates back. There is no check for text fields, open menus/dialogs, or `data-keybinding-capture`. Escape in a settings input abandons the whole Settings surface.

### [P1] Logical — Failed send can leave a ghost user message and drop the prompt

`apps/web/src/components/ChatView.tsx:5969`

On send the composer is cleared and an optimistic user row is inserted. Rollback runs only if the composer is still empty. If the user types while the request is in flight and send fails, the original prompt is not restored, the optimistic row stays (server never echoes that `messageId`), and only a thread error is set. Plan follow-up always removes the optimistic row; main send does not.

### [P1] UI/UX — Pairing token is stripped before success; Reload is a one-way door

`apps/web/src/components/auth/PairingRouteSurface.tsx:88`

Auto-submit copies the URL token, immediately `stripPairingTokenFromUrl()`, then submits. If pairing fails, the hash/query no longer has the token. Reload remounts React and loses the in-memory input. The one-time link cannot be retried without minting a new pairing URL.

### [P1] UI/UX — Palette workspace commands no-op off the thread route

`apps/web/src/components/CommandPalette.tsx:1582`, `apps/web/src/components/ChatView.tsx:5352`

Items like Toggle terminal fire `runKeybindingCommand`, which ChatView handles only while mounted on thread/draft routes. Palette still offers those items whenever `activeThread` exists. On `/board`, `/pull-requests`, `/settings`, or `/` they do nothing — no toast, no navigation. Keyboard shortcuts for the same verbs are also ChatView-scoped.

### [P2] UI/UX — Message copy control is announced as Copy link

`apps/web/src/components/chat/MessageCopyButton.tsx:64`

The button copies message text. `aria-label` is “Copy link”; the tooltip says “Copy to clipboard”. Screen readers get the wrong action.

### [P2] UI/UX — Editor picker chevron labeled Copy options

`apps/web/src/components/chat/OpenInPicker.tsx:318`

In non-compact layout the editor-menu trigger uses `aria-label="Copy options"`. The menu lists editors / SSH routing, not copy actions. Compact mode correctly uses “Choose editor”.

### [P2] UI/UX — Preview refresh control lies about Stop

`apps/web/src/components/preview/PreviewChromeRow.tsx:151`

While loading, `aria-label` is “Stop” and the tooltip is “Loading…”, but `onClick` still calls `previewBridge.refresh`. There is no stop/cancel path. Assistive tech and sighted users disagree, and neither matches the handler.

### [P2] UI/UX — Open in system browser is hover-only with no keyboard reveal

`apps/web/src/components/preview/PreviewChromeRow.tsx:205`

The control sits in `pointer-events-none opacity-0` until `group-hover`. Unlike sidebar hover actions, there is no `focus-visible:opacity-100`. The button can be tabbed while invisible, or never found by keyboard users.

### [P2] Logical — Client settings save is optimistic and never rolls back

`apps/web/src/hooks/useSettings.ts:143`

`persistClientSettings` updates the in-memory snapshot first, then writes persistence. Failures are only `console.error`. The UI keeps the new values as if saved; the next reload silently reverts.

### [P2] UI/UX — Dictation button name does not follow recording/transcribe state

`apps/web/src/components/chat/ComposerDictateButton.tsx:139`

Visual hint switches among error / “Release to transcribe” / “Transcribing…”. `aria-label` stays “Hold to dictate” (`aria-pressed` only covers recording). While transcribing, AT still hears hold-to-talk.

### [P2] UI/UX — Expanded image overlay is not a real modal

`apps/web/src/components/chat/ExpandedImageDialog.tsx:23`

Custom `role="dialog"` `aria-modal="true"` with full-screen click-to-close. No focus trap, no initial focus, no `inert` on the rest of the app. Tab can leave the overlay; Escape is a window listener, not a trapped dialog.

### [P2] UI/UX — Status ping/pulse ignore `prefers-reduced-motion`

`apps/web/src/styles/tokens.css:280` vs `:678`

`--animate-status-ping` / `--animate-status-pulse` are hardcoded `2s infinite`. The global reduced-motion handler only zeroes `--duration-*`. Connection dots and working/terminal pulses keep looping on high-refresh displays.

### [P2] Logical — Add-project path browsing can use the client OS when environment OS is unknown

`apps/web/src/components/CommandPalette.tsx:214`

`getEnvironmentBrowsePlatform` maps server `platform.os`; otherwise it uses `navigator.platform`. That drives path separators and Windows-path rejection. A Mac client paired to a remote Windows environment (or an older server omitting OS) parses paths as the browser OS.

### [P2] Coding — `isConnecting` in ChatView is dead and never wired

`apps/web/src/components/ChatView.tsx:1404`

`const [isConnecting, _setIsConnecting] = useState(false)` — setter unused. Real disconnect uses `activeEnvironmentUnavailable`. Composer still takes `isConnecting` for “Sending…” / spinner. Reconnect never goes through it.

### [P3] UI/UX — Working-step suffix likely fails contrast

`apps/web/src/components/chat/MessagesTimeline.tsx:1377`

Current plan step is `text-muted-foreground/55` next to “Working for…”. Muted foreground already reduced, then 55% opacity — likely below WCAG for small text.

### [P3] UI/UX — Preview address bar wrapped in a Tooltip with no popup

`apps/web/src/components/preview/PreviewChromeRow.tsx:167`

URL field is wrapped in `Tooltip` with a trigger and no popup. Leftover chrome that can affect hover/focus of the address bar for no user benefit.

---

## Server

### [P1] Logical — Post-commit dispatch failure double-applies streaming events

`apps/server/src/orchestration/Layers/OrchestrationEngine.ts:232`

After the SQL transaction commits, the worker writes `commandReadModel` then publishes/metrics. Any failure there is treated as dispatch failure and `reconcileReadModelAfterDispatchFailure` re-projects events onto the already updated model. Streaming `thread.message-sent` deltas concatenate, so reconnect/reconcile can duplicate assistant text in the in-memory command model while SQL stays single-copy.

### [P1] UI/UX — Checkpoint revert restores the tree before provider rollback, then can abort

`apps/server/src/orchestration/Layers/CheckpointReactor.ts:762`

`handleRevertRequested` captures undo, `restoreCheckpoint` (`git clean -fd`), then `rollbackConversation`, then `thread.revert.complete`. If rollback throws, only `checkpoint.revert.failed` is appended. Disk is already reverted; orchestration still has the old turns; the provider conversation is not rolled back. Undo-capture failure is swallowed, so untracked files can be deleted with no undo ref.

### [P1] UI/UX — Revert refuses the thread worktree if no live provider session

`apps/server/src/orchestration/Layers/CheckpointReactor.ts:707`

Revert requires `resolveSessionRuntimeForThread` (session with cwd). Capture already falls back via `resolveCheckpointCwd`. After settle, `thread.session.stop` drops the session, so restore from a settled thread always fails with “No active provider session” even though `refs/t3/checkpoints` still exist.

### [P1] Logical — Revert is a product feature; Antigravity, Pi, Grok, Droid cannot roll back

`AntigravityAdapter.ts:621`, `PiAdapter.ts:406`, `GrokAdapter.ts:1417`, `DroidAdapter.ts:1407`

`rollbackThread` fails with “print sessions do not support provider-side rollback yet”. Checkpoint UI still offers revert. Combined with restore-then-rollback order, these providers always hit the workspace/orchestration split.

### [P1] Logical — Cursor revert only splices in-memory turns

`apps/server/src/provider/Layers/CursorAdapter.ts:1123`

Cursor rollback splices `ctx.turns` and never calls ACP session rollback. Files revert; the CLI session still has the old transcript. Next turn continues with stale context on a restored tree.

### [P1] Logical — Claude revert does not move `lastAssistantUuid`

`apps/server/src/provider/Layers/ClaudeAdapter.ts:4650`

Claude splices turns and `updateResumeCursor`, but `lastAssistantUuid` is only cleared on `conversation_reset`. Resume still uses `resumeSessionAt: context.lastAssistantUuid`. After revert, Claude can resurrect deleted turns.

### [P1] Logical — Placeholder checkpoint status: in-memory vs SQL disagree

`apps/server/src/orchestration/projector.ts:43`, `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1457`

In-memory `missing` → latest turn **interrupted**. SQL `nextState = status === "error" ? "error" : "completed"` so `missing` → **completed**. If `thread.turn.diff.complete` lands when `session.status !== "running"`, the command read model treats the turn as interrupted while persisted shell/detail shows completed.

### [P1] UI/UX — Interrupt and session-stop failures are logged and dropped

`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:1598`

`interruptTurn` / `stopSession` failures are uncaught in the handler; `processDomainEventSafely` only `logWarning`. The intent event is already persisted and the client got a successful command ack. The agent keeps running; stop looks done. Approval/user-input paths append `*.respond.failed`; interrupt/stop do not.

### [P2] Logical — `thread.reverted` never clears session / `activeTurnId`

`apps/server/src/orchestration/projector.ts:767`, `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:1177`

Revert trims checkpoints/messages/turns but leaves `thread.session` pointing at a turn that was just deleted. Shell `latestTurnId` is updated; the session row is not. UI can keep a spinner / active-turn chip for a turn that no longer exists.

### [P2] UI/UX — Pairing token is consumed before the session is issued

`apps/server/src/auth/EnvironmentAuth.ts:498`

`bootstrapCredentials.consume` runs first; `sessions.issue` second. If issue fails, the one-time pairing URL is already spent. Matches the web client stripping the token from the URL before success.

### [P2] UI/UX — Antigravity runtime event pipeline swallows processing errors

`apps/server/src/provider/Layers/AntigravityAdapter.ts:452`

`pending = pending.then(() => runDetached(effect)).catch(() => undefined)` drops `ProviderAdapterRequestError` from NDJSON handling. A failed `item.*` / `result` effect never surfaces; close may still emit `turn.completed`. Timeline can skip tools/text while the turn looks finished.

### [P2] Logical — Rejected receipts written outside the command transaction

`apps/server/src/orchestration/Layers/OrchestrationEngine.ts:299`

Invariant failures persist a rejected receipt with `Effect.catch` to void. If that upsert succeeds for a transient skip (e.g. `thread.session.stop` + `onlyIfSettled`), the same client `commandId` is permanently `PreviouslyRejected` even if the user later settles and retries that envelope.

### [P2] UI/UX — Shell stream drops an aggregate update when projection refetch fails

`apps/server/src/ws.ts:602`

Two failed `getThreadShellById` / `getProjectShellById` reads become `Option.none` and the coalesced item is omitted. Client `snapshotSequence` does not advance for that aggregate until a later event. Sidebar can stay stale after a transient SQLite busy/WAL error.

### [P2] Logical — Remote `filesystemBrowse` is not workspace-scoped

`apps/server/src/workspace/WorkspaceEntries.ts:129`, `apps/server/src/auth/RpcAuthorization.ts:99`

Non-relative `partialPath` is `path.resolve(expandHomePath(...))` with no root check. A Tailscale/paired client with `orchestration:read` (standard pairing) can list `/`, `~/.ssh`, etc. `projectsReadFile` / `WorkspaceFileSystem` are confined; browse is the hole.

### [P2] Coding — `git restore` then `git reset -- .` after checkpoint restore

`apps/server/src/vcs/GitVcsDriver.ts:807`

Restore sets worktree+index from the checkpoint commit, then `git reset --quiet -- .` puts the index back to HEAD. After revert, `git status` is a full unstaged diff vs HEAD, and a later `git add -A` / commit can surprise. Combined with `git clean -fd`, easy to misread as a failed revert.

### [P3] Logical — Flaky tests encode real races in provider probe and PR matching

`apps/server/src/provider/Layers/ProviderRegistry.test.ts:1546`, `apps/server/src/git/GitManager.test.ts`

Codex `binaryPath` re-probe polls `getProviders` + `TestClock`; aggregator snapshot can lag the live instance so Settings shows the old Codex binary until the next probe tick. GitManager cross-repo PR cases time out at 12s and are the tests for metadata bugs that orphan PR state in the sidebar.

### [P3] Coding — Reconcile failure itself is swallowed

`apps/server/src/orchestration/Layers/OrchestrationEngine.ts:286`

If read-model reconcile fails, the worker logs and continues. Subsequent commands decide against a stale in-memory model while SQL has newer events. Until restart, settle and unique-project-root invariants can be wrong.

---

## Looked solid in this pass

- Desktop IPC sender checks (`isTrustedDesktopIpcSender`) and `openExternal` allowlists
- Preview `registerWebview` requiring `getType() === "webview"` and host `webContents === main`
- `projectsReadFile` / asset URLs: realpath + relative containment
- Event + projection + receipt in one outer transaction (intended atomicity)
- Pairing standard vs admin scopes as documented

## Residual risk

Tests were not run. No live client pass. Highest user-visible cluster is **checkpoint revert**. Highest silent-corruption cluster is **OrchestrationEngine post-commit reconcile** vs streaming message concat. Highest security cluster is the **desktop protocol URL join**.

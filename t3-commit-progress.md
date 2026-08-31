# Upstream (T3 Code) sync log

Ronin is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) with a deliberate cut:
desktop only, no mobile app, no T3 Connect / Clerk / hosted relay, no WSL, no legacy sidebar, no
Playwright preview automation. Upstream commits are therefore **triaged, not merged**.

This file is the watermark. On the next sync, only look at commits _after_ the SHA below — every
commit at or before it has already been judged, and the verdict is recorded here.

## Watermark

|                               |                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| **Upstream reviewed through** | `e3dcc1615` — `Add mobile composer attachment menu with video support (#8843)` (2026-08-30) |
| **Fork merge base**           | `083fa4ab2` — `feat(web): use OKLCH for theme palettes (#6036)`                             |
| **Ported on**                 | 2026-08-31                                                                                  |

> We cherry-pick rather than merge, so `git rev-list --count upstream/main...HEAD` will keep
> reporting the fork as "behind" even for commits already taken. Trust the watermark, not the count.

## How to triage the next batch

```bash
git fetch upstream
git log --oneline 5015d7cf9..upstream/main          # the new commits

# For each commit: which files does it touch that this fork still has,
# and have we already diverged on them?
MB=$(git merge-base HEAD upstream/main)
git log --reverse --format='%h|%s' 5015d7cf9..upstream/main | while IFS='|' read -r h s; do
  shared=0; forked=0
  while read -r st f; do
    [ "$st" = A ] && continue
    git cat-file -e "HEAD:$f" 2>/dev/null || continue
    shared=$((shared+1))
    git diff --quiet "$MB" HEAD -- "$f" || forked=$((forked+1))
  done < <(git diff-tree --no-commit-id --name-status -r "$h")
  echo "$h shared=$shared weTouched=$forked :: $s"
done
```

**A patch that fails to reverse-apply does not mean it is missing.** Four commits in the batch below
were already in the tree and only looked pending because our own edits had moved the surrounding
context. Always confirm by grepping for the change itself before porting it.

Checks to run after a batch: `pnpm typecheck`, `pnpm test`, `pnpm lint`.

## Batch 1 — reviewed through `5015d7cf9` (31 commits)

### Ported (14)

Ten applied clean; four needed adaptation.

| Upstream    | Title                                                                       | Notes                                                                                                                            |
| ----------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `df19f6cfe` | fix(server): align Codex collaboration prompts (#6432)                      | clean                                                                                                                            |
| `1e59b4c40` | fix(web): keep the typed prompt when a draft changes repo (#6393)           | clean                                                                                                                            |
| `9666b8751` | fix(web): preserve appearance mode when changing themes (#6343)             | clean                                                                                                                            |
| `770946d02` | fix(web): render tooltips above dropdowns (#6241)                           | clean — real bug here too; our tooltip was `z-70` under `z-[130]` menus                                                          |
| `6bc6cb6be` | fix(web): keep diff file lists scrollable past expanded files (#6423)       | clean                                                                                                                            |
| `e321667b1` | fix(web): prevent changed files header overlap (#6314)                      | clean                                                                                                                            |
| `8d24b5131` | fix(web): open modified PR clicks in browser (#6278)                        | clean — apply before `2eb099fdc`, same file                                                                                      |
| `da6253b3d` | web/settings: fix source control scan on relay environments (#6230)         | clean — reads "relay" but the code is generic non-primary environment, so it matters for LAN/Tailscale/SSH                       |
| `33f970592` | fix(web): make reset zoom hover visible (#6385)                             | clean                                                                                                                            |
| `5015d7cf9` | fix(web): keep turn minimap stable as composer grows (#6414)                | clean (context drift only)                                                                                                       |
| `2eb099fdc` | fix(web): cmd+click sidebar PR numbers open in the browser (#6378)          | **adapted** — dropped the `LegacySidebar.tsx` hunk; doc line rebranded to Ronin                                                  |
| `ac1264e2c` | feat(web): project favicon and workspace icons in command subtitles (#6330) | **adapted** — applied with `--3way`                                                                                              |
| `b28f9bf0a` | feat(web): pull request surfaces (#6039)                                    | **adapted** — 86 files, only 2 conflicts, both branding: the unsupported-server copy and a filter test fixture keep Ronin naming |
| `f0b57ca23` | feat(web): add Open VSX theme search (#5654)                                | **adapted** — see below                                                                                                          |

`f0b57ca23` needed three fork-specific decisions:

- Upstream's dependency block re-added `jose` (Connect/Clerk auth). Only `jsonc-parser` and `jszip`
  were taken; `jose` stays out of `apps/web`.
- Upstream's picker uses `ThemePreviewCircle` (a gradient ball). This fork replaced it with a flat
  shell mockup, `ThemePreviewSwatch`, which was module-private — it is now exported and the new
  Open VSX UI points at it.
- Two new collection tests compared `replaceCustomThemeCollection`'s return against raw
  `parseThemeFile` output. Our Ronin default palettes (`SAKURA_*_COLORS`) are hex literals while the
  stored-theme path canonicalizes every role to OKLCH, so the assertions now compare against the
  canonical form via a `withCanonicalColors` helper.

  **Known inconsistency, not fixed here:** `getDefaultThemeColors` returning hex while storage
  returns OKLCH is a real wrinkle in this fork. Canonicalizing the default palettes at module load
  would remove it, but that changes every default color's runtime spelling and was out of scope for
  a port.

### Already in the tree (5) — do not re-port

Taken earlier (mostly via `264bd1e2c` "Take the upstream fixes that apply to what this fork still
has") or solved independently. Listed because their patches no longer reverse-apply and they will
look pending to a naive check.

| Upstream    | Title                                              | Where it lives                                                                        |
| ----------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `2db08457f` | use upload icon for disabled push action (#6207)   | `GitActionsControl.tsx:370`                                                           |
| `b54bfc931` | a better right panel empty state (#6258)           | applied                                                                               |
| `560d4a456` | keep sidebar wordmark visible at min width (#6246) | solved our own way in `apps/web/src/styles/chrome.css`                                |
| `c196f422e` | clean up composer resize animation (#6209)         | full FLIP animation present in `BranchToolbar.tsx`; the remaining diff is our restyle |
| `5a8461480` | align the composer model picker (#6252)            | `ChatComposer.tsx` already has `-ms-3.5`/`ps-3.5` and `triggerClassName="-ms-2.5"`    |

### Skipped (12) — cut surface

| Upstream    | Title                                                   | Why                                                                                                                         |
| ----------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `d37a9b09b` | feat(mobile): thread title regeneration (#6253)         | no mobile app in this repo                                                                                                  |
| `e1378a1f4` | fix(mobile): ordered lists in user bubbles (#6154)      | same                                                                                                                        |
| `18918d1c4` | mobile command popover glass rendering (#6370)          | same                                                                                                                        |
| `e3a9c2518` | test(mobile): seed snoozed showcase threads (#5155)     | same                                                                                                                        |
| `849bac894` | fix(connect): preserve CLI OAuth parameters (#6285)     | T3 Connect cut                                                                                                              |
| `d0b8d6306` | feat(connect): deregister account environments (#4844)  | T3 Connect cut. One salvage if ever needed: it adds a generic `portalContainer` prop to `ui/alert-dialog.tsx`               |
| `f131228a5` | fix(web): theme Clerk surfaces (#6300)                  | Clerk cut                                                                                                                   |
| `6fd088af9` | fix(web): align mobile onboarding header (#6293)        | only renders under `authGateState.status === "hosted-static"`, which desktop never reaches                                  |
| `52e5a75a8` | feat(web): compact sidebar footer actions (#6210)       | superseded by our `7ca3d0623` icon-only dock                                                                                |
| `b73232bdd` | feat(web): reset sidebar width on double click (#6320)  | `AppSidebarLayout.tsx` is gone. The idea still applies to `shell/WorkspaceShell.tsx` — cheap reimplement, not a cherry-pick |
| `860179723` | fix(web): align update toast release notes link (#6322) | `desktopUpdate.toast.tsx` does not exist here                                                                               |
| `63e6faef6` | chore: add dara to vouched (#6259)                      | upstream governance file                                                                                                    |

### Verification

- `pnpm typecheck` — 0 errors
- `apps/web` — 234 files / 2312 tests pass
- `pnpm lint` — 3 pre-existing errors, all in files this batch never touched
  (`DroidAcpSupport.ts`, `AntigravityAdapter.ts`, `storageDocument.test.ts`)

**Fixed alongside this batch (pre-existing, not caused by it):**
`scripts/build-desktop-artifact.test.ts` → "switches desktop packaging product names to nightly"
still expected `"Ronin (Alpha)"`. The alpha suffix is gone from the artifact name, so
`resolveDesktopProductName` reads `"Ronin"` from `desktopPackageJson.productName` and the assertion
now matches.

The `T3 Code (Alpha)` strings left in `apps/desktop/src/app/DesktopEnvironment.ts` are deliberate —
they name the _legacy_ user-data directory the app migrates away from, not the current artifact.

## Batch 2 — reviewed through `59be6f784` (17 commits)

### Ported (8)

| Upstream    | Title                                                                       | Notes                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `97db94c9b` | fix(web): keep pull request panel within viewport (#6451)                   | clean; added the upstream containment regression test                                                                                                             |
| `2ab188f1c` | fix: ignore pull request actions in latency tracker (#6476)                 | clean; every `pullRequests.*` RPC is excluded                                                                                                                     |
| `2fab18e28` | fix(web): show unlinked icon when viewport aspect ratio is unlocked (#6509) | clean                                                                                                                                                             |
| `92d4a2e99` | fix(web): scope pull request errors to their environment (#6490)            | clean behavior; moved the shared environment/project key helper into the logic module so the React component module exports components only                       |
| `23d45d914` | fix(web): restore default stage artwork colors (#6535)                      | **adapted** — Ronin split upstream's monolithic CSS; base palettes live in `tokens.css`, built-in theme bridges in `themes.css`, and the SVG uses dedicated roles |
| `96bfa67b3` | fix(web): align the snoozed thread wake icon (#6215)                        | clean                                                                                                                                                             |
| `db1507e98` | feat: allow disabling auto-settle on merge (#5880)                          | **adapted** — ported contracts, client runtime, desktop/web settings and every settlement consumer; omitted mobile hunks                                          |
| `59be6f784` | fix(web): simplify the desktop-managed server update banner copy (#6549)    | clean behavior; retained Ronin's product naming                                                                                                                   |

### Already in the tree (0)

None.

### Skipped (9)

| Upstream    | Title                                                                       | Why                                                                                  |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `9513e62e2` | Add bil0000 to VOUCHED contributors list (#6462)                            | upstream governance file                                                             |
| `9e201941a` | Remove rebase requirement before opening PR (#6479)                         | upstream governance conflicts with Ronin's explicit rebase-before-PR rule            |
| `fd51561b4` | fix(mobile): extend blockquotes across wrapped lines (#6482)                | no mobile app in this repo                                                           |
| `83ad26c3a` | fix(mobile): prevent invalid HTML entities from crashing markdown (#6495)   | no mobile app in this repo                                                           |
| `1b16ed663` | fix(web): avoid Clerk close button overlap (#6442)                          | Clerk surface is cut                                                                 |
| `bad1143b0` | fix(mobile): show a real settings cog in the Android sidebar header (#6520) | no mobile app in this repo                                                           |
| `5ff3a03ad` | fix(web): align sidebar wordmark label (#6086)                              | superseded by Ronin's custom `RoninAppIcon` and `label-meta` sidebar brand treatment |
| `85389b988` | Nest mobile task settings in bottom sheets (#6224)                          | mobile-only feature and support files; no mobile app in this repo                    |
| `5304f3e9d` | chore(mobile): bump app version to 1.0.4                                    | no mobile app in this repo                                                           |

### Verification

- Focused tests: 10 files / 374 tests pass. After relocating the project-key helper, its 2 focused
  files / 101 tests also pass.
- Typechecks pass for `apps/web`, `apps/desktop`, `packages/client-runtime`, and
  `packages/contracts`.
- `apps/web` production build passes. Its existing sourcemap and large-chunk advisories remain.
- Changed-file `vp lint` passes with one pre-existing `unicorn(prefer-set-has)` warning in
  `pullRequestList.logic.ts:321`, outside this batch's changed lines.
- React Doctor scored 56 both times. Moving the project-key helper removed the only new finding
  (170 findings to 169); the remaining large-component/compiler backlog predates this batch.
- `git diff --check` passes.

## Batch 3 — reviewed through `184d8ef33` (12 commits)

### Ported (5)

| Upstream    | Title                                                                      | Notes                                                                                                                       |
| ----------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `e15f655ba` | fix(web): show background policy tooltips sooner (#6506)                   | clean — `delay={200}` on the settings `PolicyTooltip` trigger                                                               |
| `710fd0eeb` | feat(desktop): add favicons to the Browser panel (#5644)                   | **adapted** — see below                                                                                                     |
| `9fd788b5a` | fix(preview): only show browser-ready local servers (#6021)                | clean — `PortScanner`, `ws.ts`, preview contracts, client-runtime and the whole web preview surface applied verbatim        |
| `4a2f8b04b` | fix(web): keep thread rename open during IME composition (#6281)           | **adapted** — same guard, hand-applied to Ronin's `SidebarThreadRow` and `ChatHeader` rename handlers (context had drifted) |
| `038560e58` | fix(web): align every titlebar control cluster on one shared inset (#6592) | **adapted** — see below                                                                                                     |

`710fd0eeb` (28 files, ~4200 lines) is a desktop-first Browser-panel feature, so it belongs here.
Everything except four files applied with `git apply --3way` and now matches upstream byte for byte
(`FaviconCapture.ts`, `browserFaviconStore.ts`, `browserFaviconLogic.ts`, `PreviewFaviconIcon.tsx`,
`browserTargetResolver.ts`, `usePreviewBridge.ts`, `lib/favicon.ts`, `previewStateStore.ts`). The
four needing hand-work:

- `ChatView.tsx` and `_chat.pull-requests.tsx` carried uncommitted Batch 2 edits, so `--3way`
  refused them. Both hunks (the memoized `activeProjectRef`, the favicon registration effect, and
  the new `desktopByTabId` prop) were applied by hand.
- `RightPanelTabs.tsx` has diverged (Ronin restyled the tab bar), so `PreviewFavicon`, `sameOrigin`
  and the `desktopByTabId` threading were applied by hand.
- `Manager.test.ts` conflicted on context drift only. The three added blocks — the favicon
  WebContents fixture, the destroyed-webview registration test, and the 13 favicon lifecycle
  tests — were inserted at Ronin's matching anchors. Ronin has no `makeTestPictureInPictureWindow`
  (picture-in-picture is a no-op stub here), so the fixture block sits after
  `makeTestPreviewWebContents` instead.

`038560e58` needed three fork-specific decisions:

- Upstream's `AppSidebarLayout.tsx` is gone. Its `SidebarControl` lives in
  `shell/WorkspaceShell.tsx`, which is where the `ml-px` mirror landed.
- The `RightPanelTabs` hunk is **already in the tree**: Ronin's tab bar never carried the
  `[--workspace-topbar-height:--spacing(11)]` override the fix removes, because the tab bar was
  restyled with a `border-b` instead. Nothing to apply.
- Ronin's thread-view controls already used the bare `workspace-titlebar-controls` inset plus
  `mr-px`, so only the pull-requests route needed realignment: it dropped its `right-2` /
  `wco:right-…` overrides, mounts the toggle in both panel states, and reserves the closed-state
  footprint with the upstream spacer.

### Already in the tree (0)

None as whole commits. One hunk of `038560e58` was already satisfied — recorded above.

### Skipped (7)

| Upstream    | Title                                                                                    | Why                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `7e01d33f0` | perf(build): stop unpacking node_modules wholesale from the Windows asar (#5877)         | WSL is cut — see the note below                                                                                    |
| `baaeda305` | fix: avoid stale Live Activities when publishing is disabled (#6325)                     | T3 Connect / hosted relay cut — see the note below                                                                 |
| `8f9ab0845` | fix(mobile): add breathing room between the git progress overlay and the app bar (#6587) | no mobile app in this repo                                                                                         |
| `6ae44b418` | refactor(mobile): name the iOS nav bar height fallback (#6589)                           | no mobile app in this repo                                                                                         |
| `b3b4b5779` | fix(mobile): preserve keyboard suggestions while typing (#6323)                          | no mobile app in this repo (Kotlin/Swift native composer views)                                                    |
| `21a3669ce` | fix(mobile): prevent OTA update restart crashes (#6324)                                  | no mobile app in this repo; its `docs/user/updating.md` hunk documents Expo OTA updates, which Ronin does not ship |
| `184d8ef33` | fix(mobile): steer active turns by default (#6543)                                       | no mobile app in this repo                                                                                         |

`7e01d33f0` exists to shrink `WINDOWS_ASAR_UNPACK`, a constant Ronin does not have: this fork sets
no `asarUnpack` at all and leans on electron-builder's smart unpack, so there is no wholesale
`**/node_modules/**` unpack to fix. Its `DesktopWslEnvironment.ts` hunk and the `apps/server`
`vite.config` `define` block (relay/Clerk build vars) are both cut surfaces here. Inverting the CLI
bundle's externals with no WSL backend to drive it would be an opportunistic refactor, not a port.

`baaeda305` lands entirely on cut surfaces: `cloud/config.ts`, `relay/AgentAwarenessRelay.ts`,
`features/agent-awareness/` and `cli/connect.ts` are all absent from `apps/server`, and the new
`agentActivityPublishing` capability exists only to stop the mobile app seeding a Live Activity that
would never repaint.

### Verification

- `pnpm typecheck` per package: `@t3tools/contracts`, `@t3tools/client-runtime`, `@t3tools/web`,
  `apps/desktop`, `apps/server` — 0 errors. The Effect-diagnostic _suggestions_ in `apps/server` and
  `DesktopBackendPool.test.ts` are pre-existing and in files this batch never touched.
- `vp test run` per package: `apps/desktop` 48 files / 371 tests pass; `packages/contracts` +
  `packages/client-runtime` 63 files / 816 tests pass; `apps/server/src/preview/` + `server.test.ts`
  - `http.test.ts` 4 files / 142 tests pass.
- `vp test run apps/web` — 242 files / 2382 tests pass, **1 pre-existing failed suite**:
  `apps/web/src/terminal/ghostty/runtimeAbi.test.ts` fails at import analysis on
  `./vendor/ghostty-vt.wasm?inline` ("content contains invalid JS syntax… add `**/*.wasm?inline` to
  `assetsInclude`"). It imports only vendored wasm/VERSION assets and `./keyCodes`, none of which
  this batch touches, and `apps/web/src/terminal/` is clean in `git status`.
- `vp lint` over every changed file — one pre-existing `eslint(require-yield)` warning at
  `Manager.ts:1080`, on Ronin's own `pickElement` no-op stub, which this batch does not modify.
- `git diff --check` and `git diff --cached --check` pass; no unexpected or untracked files.

## Batch 4 — reviewed through `e9ae134c5` (17 commits)

### Ported (9)

| Upstream    | Title                                                                           | Notes                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `80991402d` | fix(server): terminal subprocess polling no longer floods the PID space (#6377) | clean — Ronin's `terminal/Manager.ts` was byte-identical to upstream's parent                                             |
| `1add47b32` | fix(web): add copying terminal selection with ctrl+c in the web app (#5638)     | clean — includes the new `LocalApi.contextMenu.close`; no desktop hunk needed, the native menu self-dismisses             |
| `196c8ea0d` | fix(web): style sidebar action tooltips (#6371)                                 | clean — snooze, unpin and settle all matched verbatim; applied to the worktree to preserve uncommitted `Sidebar.tsx` work |
| `9885a845c` | refactor(web): simplify global styling (#6381)                                  | **subset only** — the `MenuPopup` min-width fix. See below                                                                |
| `f0719072a` | fix(server): handle files named HEAD in git status (#6397)                      | clean — `git diff HEAD --numstat --` plus the `bad revision 'head'` unborn-HEAD branch                                    |
| `74f7b4348` | fix(web): bound OKLCH gamut mapping (#6485)                                     | clean — real hang: `log2(C / 1e-6)` overflows to `Infinity` for huge chroma, so the bisection loop never terminated       |
| `57a299a78` | feat(web): open remote environments in your local editor over SSH (#6572)       | **adapted** — see below                                                                                                   |
| `48ddb3d46` | feat(web): older chat timestamps show the date, not just the time (#6654)       | **adapted** — hand-applied; Ronin's `timestampFormat.ts` has diverged well past upstream's                                |
| `8c628f149` | fix(web): align pull request action menu rows (#6534)                           | clean — the `MenuRadioItem` hunk is independent of `9885a845c`'s `MenuPopup` hunk, so it ports on its own                 |

`9885a845c` is a 69-file pass that rewrites upstream's monolithic `index.css` (1101 lines) and folds
one-off control classes into shared `Button`/`Select` variants. Ronin already simplified global
styling its own way — `index.css` is a 32-line manifest over `styles/{tokens,base,chrome,themes,motion,…}.css`
— so the reorganization is superseded, and three of its parts would actively regress this fork:

- **`--control-radius` means something else here.** Upstream introduces it as the input/control
  radius replacing `--radius-lg`. Ronin already defines `--control-radius: 0.1875rem` in
  `tokens.css` for _dense_ controls, so taking upstream's `input.tsx` / `input-group.tsx` hunks
  would silently re-radius every input to 3px.
- **The class-migration hunks invert Ronin's architecture.** `terminal/ghostty/surface.ts`,
  `SidebarChrome.tsx`, `routes/settings.tsx` and `routes/_chat.index.tsx` replace `.t3-ghostty-*`,
  `.sidebar-brand` and `.workspace-topbar` with inline utilities. Those classes are owned by
  `styles/terminal.css` and `styles/chrome.css` here on purpose.
- **New `Button`/`Select` geometry (`compact`, `icon-micro`, `ghost-muted`, `glass`) and
  `getVirtualizedScrollFadeClassName`** are only reachable from the same commit's call-site rewrites
  across Settings and the pull-request surfaces, which Ronin has restyled. Taking the variants alone
  would be dead code; taking the call sites would be adopting upstream's visual pass.

What _was_ portable is the `MenuPopup` default width. `not-[class*='w-']:min-w-32` compiles to
`:not([class*='w-'])` evaluated against the element's whole class attribute — which always contains
the variant's own `min-w-32` — so the selector never matched and every menu without an explicit
width fell back to content width. The check now runs in JS against the incoming `className` only.
The `skeleton.tsx` hunk (`motion-reduce:after:content-none`) is **already in the tree**: `motion.css`
zeroes the same sweep via `[data-slot="skeleton"]::after { content: none }` under
`prefers-reduced-motion`.

`57a299a78` is a remote-ready feature, so it belongs here: when the client is not on the
environment's machine, "Open in editor" now hands the OS a
`vscode://vscode-remote/ssh-remote+<host><path>` deep link instead of exec'ing an editor on the
environment host. Every prerequisite already existed (`packages/tailscale`'s `readTailscaleStatus`,
`HostProcessHostname`, and `Net.ts`'s private `hasListenerOnHost`, which the commit promotes onto
`NetServiceShape`). Four fork-specific decisions:

- **`RelayConnectionTarget` does not exist here.** `remoteOpen.test.ts` used it to build "a remote
  environment that advertises no hosts". Ronin's equivalent non-local, non-primary target is a
  `BearerConnectionTarget` with a `connectionId` outside the `local:` prefix, so the case is now
  expressed that way. `remoteOpen.ts` itself never referenced relay.
- **The `apps/desktop/src/wsl/DesktopWslBackend.test.ts` hunk was dropped** — one line adding
  `hasListenerOnHost` to a WSL `NetService` stub, and WSL is cut. Every other `NetService` stub in
  the tree (`PortScanner.test.ts`, `tunnel.test.ts`, `dev-runner.test.ts`,
  `RemoteOpenTargets.test.ts`) was checked and updated.
- **The four desktop IPC files were hand-applied.** Ronin's own `FOCUS_WINDOW_CHANNEL` /
  `focusWindow` sits exactly where upstream inserts `probeRemoteEditors`, in all of `channels.ts`,
  `preload.ts`, `DesktopIpcHandlers.ts` and `methods/window.ts`. The handler import is placed
  alphabetically (`pickThemeFiles`, `probeRemoteEditors`, `setTheme`) rather than at upstream's
  unsorted position.
- **`packages/contracts/src/ipc.ts` was hand-applied** because Ronin adds members between
  `openExternal` and `onMenuAction`, and because the file already carried this batch's
  `contextMenu.close` addition from `1add47b32`.

### Already in the tree (2) — do not re-port

| Upstream    | Title                                                  | Where it lives                                                                                      |
| ----------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `6ae9662d8` | fix(web): restore selected themes in dark mode (#6665) | `styles/themes.css:60` already carries the `html[data-theme-id], html.dark[data-theme-id]` pair     |
| `f0ebc628c` | fix(web): improve Codex usage graph contrast (#6669)   | `usageProviders.ts` already reads `var(--provider-codex)` / `--provider-claude` / `--provider-grok` |

`f0ebc628c` exists because upstream hardcoded Codex's series as `#e6e6e6`, invisible in light mode;
its fix swaps in `var(--foreground)`. Ronin solved that earlier and further: per-mode tokens in
`tokens.css` (`--provider-codex: #1baf7a` light, `#199e70` dark) give Codex a distinct hue rather
than the text color, the chart paints colored swatches instead of leaning on brand marks to key the
series, and labels/order are shared via `@t3tools/shared/providerVocabulary`. Upstream's remaining
diff is its `PROVIDER_PRESENTATION` record consolidation, which would undo that sharing and drop
Ronin's Grok entry. Deliberately not taken.

### Skipped (6)

| Upstream    | Title                                                       | Why                                                                        |
| ----------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `1a6599437` | fix(web): clarify desktop update status (#6504)             | upstream's electron-updater update pill is cut — see below                 |
| `c9063f03e` | perf(desktop): speed up Windows update installation (#6169) | depends on the skipped `7e01d33f0`, plus WSL and `asarUnpack` — see below  |
| `e25021af7` | feat(packaging): maintain AUR packages in-repo (#4128)      | upstream's `t3code-bin` AUR identity and publish pipeline — see below      |
| `d7abd7f3b` | feat(web): refresh workspace layouts and tool activity      | reverted upstream by `804cba430`; `git diff d7abd7f3b^ 804cba430` is empty |
| `804cba430` | revert: refresh workspace layouts and tool activity (#6657) | the revert of the above — the pair nets to zero, nothing to port           |
| `e9ae134c5` | docs: route feature requests to Discussions                 | upstream governance: its issue templates, CONTRIBUTING and README          |

`1a6599437` builds entirely on upstream's `desktopUpdate` state machine — `useDesktopUpdateState`,
`resolveDesktopUpdateButtonAction`, `bridge.checkForUpdate()`, the downloading/downloaded statuses
and the nightly-channel release notes. None of it exists here: Ronin replaced that surface with
`appUpdate.ts` + `AppUpdateProvider`/`AppUpdateNotification`, a GitHub-releases poller whose states
are `unavailable | checking | up-to-date | available | error` with no download/install lifecycle to
visualize. Same reason Batch 1 skipped `860179723`.

`c9063f03e` moves the packaged server tree from `app.asar.unpacked` into a `resources/server.asar`
sidecar so NSIS copies one archive instead of thousands of loose files on update. Ronin sets no
`asarUnpack` at all (see Batch 3's note on `7e01d33f0`), has no `serverRoot`, and has no
`apps/desktop/src/wsl/` — and the commit's justification is precisely the WSL backend needing to
read that tree with plain `wsl.exe -- node`. It also edits `scripts/lib/cli-external-packages.ts`,
a file this fork does not have because `7e01d33f0` created it and Batch 3 skipped it. Its
`DesktopBackendConfiguration.ts` hunks are all inside `resolveWslStartConfig`.

`e25021af7` publishes `pkgname=t3code-bin` / `t3code-nightly-bin` to the AUR from
`url='https://github.com/pingdotgg/t3code'`, under an upstream maintainer's name, via a
`publish-aur.yml` workflow keyed to upstream's AUR SSH secrets. Porting it as written would have
Ronin's repo publishing upstream's package. A _Ronin_ AUR package is a reasonable idea and the
PKGBUILDs are a decent starting point, but it needs Ronin's package name, repo URL, release asset
names and its own AUR credentials — a new product decision, not a port.

### Verification

- `vp run typecheck` per package — 0 errors in `packages/contracts`, `packages/shared`,
  `packages/client-runtime`, `packages/ssh`, `packages/tailscale`, `apps/server`, `apps/web`,
  `apps/desktop`, `scripts`. The Effect-diagnostic _suggestions_ in `apps/server` remain
  pre-existing and are in files this batch never touched.
- `vp test run` — `apps/web` 252 files / 2461 tests pass; `apps/desktop` 48 / 371;
  `packages/contracts` 19 / 256; `packages/shared` 36 / 325; `packages/client-runtime` 44 / 560;
  `packages/ssh` 4 / 25; `apps/server` touched scopes (`terminal/`, `vcs/`, `environment/`,
  `preview/`, `server.test.ts`) 17 / 307; `scripts/dev-runner.test.ts` 1 / 72.
- **Batch 3's one pre-existing failure is gone.** `apps/web/src/terminal/ghostty/runtimeAbi.test.ts`
  now passes, so `apps/web` is fully green (242 → 252 files as this fork has grown).
- `vp lint` over all 75 changed files — 0 findings. `vp fmt --check` over the same set — all
  correctly formatted.
- `git diff --check` and `git diff --cached --check` pass. No unexpected or generated files; the
  index is left unstaged, as it was found.

**Uncommitted local work was preserved.** This batch landed alongside in-progress keybinding /
shortcuts-cheat-sheet / attention-chime work. Two files overlapped and were applied to the worktree
rather than through `--3way`: `Sidebar.tsx` (the tooltip wraps sit clear of the local
`SidebarWorkingDuel settled` edit) and `MessagesTimeline.tsx` (the two timestamp call sites sit clear
of the local edits). None of the other 19 locally-modified files or 11 untracked files were touched.

## Batch 5 — reviewed through `d484735c6` (89 commits)

Snapshot tip: `d484735c64ed98a0737b594818996660f72c1616`. Watermark was `e9ae134c5`.

### Ported (77)

Clean applies unless noted. `.github/pr-assets` and `apps/desktop/src/ipc/methods/wsl.test.ts` were
never taken.

| Upstream    | Title                                                                                       | Notes                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `d8a6dfd31` | fix(desktop): app zoom no longer zooms the preview browser (#6649)                          | **adapted** — kept Ronin's no-op `pickElement`; 3way tried to restore the cut picker            |
| `afca73d36` | fix(server): keep provider notification consumers alive past startSession (#6538)           | clean                                                                                           |
| `75472802b` | fix(server): treat removed Bitbucket permissions endpoint as unknown, not blocking (#6525)  | clean                                                                                           |
| `672216d7e` | fix(ssh): let cold remote servers finish starting (#6168)                                   | **adapted** — 60s ready / 90s launch; kept "Remote Ronin server" copy                           |
| `1e8702926` | fix(web): preserve Claude insight line breaks (#4344)                                       | clean                                                                                           |
| `a6ac27e7f` | feat(web): accept file drops across the chat workspace (#6636)                              | **adapted** — new `workspaceFileDrop`; kept `ComposerDictationContext` and mention-drag capture |
| `eaa6c4712` | fix(web): widen ordered-list marker gutter for 3+ digit item numbers (#6527)                | **adapted** — CSS in `styles/markdown.css`, not upstream `index.css`                            |
| `71c6f8248` | fix(server): bound thread activity hydration (#6153)                                        | clean                                                                                           |
| `48cba7d93` | fix(web): restore the Archive action in the default sidebar thread menu (#6526)             | clean                                                                                           |
| `9f26656cb` | fix(web): open diff files from nested projects (#6174)                                      | clean                                                                                           |
| `2cb1a26f0` | fix(web): open the file a bare filename reference names (#6297)                             | clean                                                                                           |
| `ddee418a8` | fix(server): stop the provider title mirror from overwriting real thread titles (#5941)     | **adapted** — did not reintroduce unused `ServerSettingsService` import                         |
| `178da6bc3` | fix(shared): match source-control providers by DNS label (#6175)                            | clean                                                                                           |
| `b7dbbbaf6` | feat(desktop): Chrome-style hold-to-quit (#5508)                                            | **adapted** — dropped WSL test; hand-applied IPC/settings into Ronin's extra members            |
| `d94fbda34` | fix(gitlab): submit review comments on context lines (#6348)                                | clean                                                                                           |
| `a38cac81d` | fix(web): keep a long path from running under the folder picker button (#4823)              | **adapted** — kept Ronin's `WORKSPACE_COMMANDS` catalog                                         |
| `270489b88` | fix(terminal): right-click paste works in the terminal (#5240)                              | clean behavior; import merge only                                                               |
| `9bdd91293` | fix(web): stop counting a workflow coordinator as a working agent (#6672)                   | clean                                                                                           |
| `6e6d1b494` | fix(web): keep floating preview anchored after panel closes (#6547)                         | 3way                                                                                            |
| `7afa184a9` | fix(web): keep send reachable while a turn is running on mobile (#4781)                     | **adapted** — `showSendWhileRunning` on `max-sm`; kept `ComposerDictationControl`               |
| `34a12bc33` | fix(web): reject unsupported composer image types at attach time (#6574)                    | **subset** — dropped mobile hunks                                                               |
| `5ffbf3ce4` | Make ClaudeTextGeneration tests hermetic on Windows (#4508)                                 | clean                                                                                           |
| `143f713c7` | fix(web): show command output in work log (#4083)                                           | clean                                                                                           |
| `06dd9993b` | fix(web): reserve sibling column width when resizing the right panel (#6279)                | clean                                                                                           |
| `9e61d0f12` | fix(web): replace whitespace in new ref names with dashes (#6270)                           | clean                                                                                           |
| `c7b14a866` | fix(client-runtime): branch list no longer resets while paging through refs (#5858)         | clean                                                                                           |
| `b0de38577` | fix(web): support Shift+Insert terminal paste (#5982)                                       | clean                                                                                           |
| `135dc156e` | fix(codex): keep background memory out of chats (#5468)                                     | clean                                                                                           |
| `51c6daa3b` | fix(server): treat a missing Codex rollout as a recoverable resume error (#6671)            | clean                                                                                           |
| `3cde99b25` | fix(web): hide provider Update toast action while an update is running (#6544)              | 3way                                                                                            |
| `e204f5a5d` | fix(desktop): agent shells inherit a UTF-8 locale on macOS (#6236)                          | clean                                                                                           |
| `474cc5fb0` | fix(server): ignore Claude command lifecycle messages (#6606)                               | clean                                                                                           |
| `402c9e074` | docs: mention Bitbucket user read scope needed by auth probe (#6291)                        | clean; docs already Ronin-branded                                                               |
| `551f4c99c` | fix(server): return valid preview action results (#5966)                                    | **adapted** — MCP preview toolkit is live even though pick-element is a stub                    |
| `e9e46972f` | fix(claude): make "Always allow for session" stick, and only for the session (#5041)        | clean + `requestId` on new test fixtures                                                        |
| `9d0f2fc21` | fix(ssh): surface a failed remote t3 install instead of a silent 0-byte server.log (#5132)  | **adapted** — kept Ronin ready-message; took empty-log branch                                   |
| `f075a5811` | perf(server): persist the wire projection for streaming tool.updated data (#6675)           | 3way                                                                                            |
| `c4556ab23` | fix(web): stop wrapping partial code block selections in markdown fences (#5069)            | clean                                                                                           |
| `a5d35321b` | fix(web): show provider account accent badge in sidebar rows and hover card (#5980)         | clean                                                                                           |
| `c0f9d917c` | fix(server): wait for concurrent SQLite writers instead of failing with SQLITE_BUSY (#5134) | clean                                                                                           |
| `7c55e8632` | fix(web): reject oversized prompts before provider turn start (#6602)                       | **adapted** — `docs/user/composer.md` rebranded; ChatComposer structure kept                    |
| `40ab7bf32` | feat(web): collapse the question prompt from its header (#6773)                             | **adapted** — collapse UI with Ronin `text-2xs` / `duration-(--duration-fast)`                  |
| `684d703b0` | fix(shared): degrade an unknown system time zone to UTC in usage windows (#6670)            | clean                                                                                           |
| `ad47d2347` | fix(claude): discover repo-local .agents/skills in skill discovery (#5488)                  | clean                                                                                           |
| `d715c2e56` | fix(server): let slow provider CLIs raise their discovery probe budget (#6223)              | clean                                                                                           |
| `d5465aebf` | fix(web): retain terminal PR badges after checkout switch (#4755)                           | clean                                                                                           |
| `ca37b19cf` | fix(web): show selected model in context window tooltip (#4772)                             | **adapted** — `modelDisplayName` through Ronin's footer                                         |
| `5e1473715` | fix(web): scale command details with code font (#6510)                                      | **adapted** — `--font-size-code`; dropped PR assets                                             |
| `cf7bfd1c9` | fix(web): preserve XML-like tags in user messages (#4133)                                   | **adapted** — strip `title` on Ronin's `MarkdownImage` path                                     |
| `7c8848ebb` | fix(desktop): route mouse thumb buttons to the in-app browser (#4459)                       | **adapted** — new `preview-guest-preload.ts` instead of cut `PickPreload`                       |
| `f91532091` | fix(web): keep the final segment of directory paths with a trailing separator (#5460)       | clean                                                                                           |
| `7083bce26` | Keep block code plain when copying from rendered markdown (#4468)                           | clean                                                                                           |
| `21b6fb528` | fix(web): add web app manifest so installed app keeps its scope (#4306)                     | **adapted** — added Ronin `name`/`short_name`                                                   |
| `db02c6b9c` | Skip user hooks during Claude capability probes (#4466)                                     | clean                                                                                           |
| `b72d5d798` | fix(desktop): timestamps follow the OS locale instead of en-US (#6190)                      | **adapted** — hand-applied IPC; dropped missing `DesktopLifecycle.test.ts`                      |
| `1a5ff424c` | fix(web): keep multi-select questions open after the first click (#6646)                    | clean                                                                                           |
| `d550b829b` | fix(web): stop clipping the changed-files expand hover on Windows (#6545)                   | **adapted** — kept Ronin's duration label                                                       |
| `86fb47afd` | fix(server): allow long-running git pushes (#6499)                                          | clean                                                                                           |
| `160c76c6d` | fix(desktop): keep probing backend readiness while the process is alive (#5526)             | clean                                                                                           |
| `dc0ff8f13` | fix(server): allow install scripts in npm-global provider updates (#5646)                   | clean                                                                                           |
| `7ce419470` | fix: detect SSH remotes with non-git user prefixes (e.g. gitlab@) (#3649)                   | clean                                                                                           |
| `39167eb1a` | fix(web): describe what Ultracode does in the Reasoning picker (#6092)                      | clean                                                                                           |
| `3b54a2a57` | fix(server): settle pending user-input requests when a Claude session stops (#5127)         | clean                                                                                           |
| `4fc80fcbd` | fix(server): stop replaying a command receipt for a different aggregate (#5246)             | clean                                                                                           |
| `07e668dc4` | fix(server): settle snoozed threads immediately (#5379)                                     | clean                                                                                           |
| `62bb97428` | fix(web): contain long approval commands (#6503)                                            | **adapted** — `flex-wrap` on Ronin's approval toolbar; dropped PR assets                        |
| `e17f244e0` | feat(web): make right panel maximize bindable (#5091)                                       | **adapted** — dispatched from `runWorkspaceCommand`; exported `STATIC_KEYBINDING_COMMANDS`      |
| `61b2e744d` | fix(server): respect inherited OPENCODE_CONFIG_CONTENT (#4242)                              | **adapted** — uses `cliSpec.configContentEnvVar` so Kilo is covered too                         |
| `931e91527` | Keep the server alive when a response write hits a dead socket (#4470)                      | 3way                                                                                            |
| `664499c92` | Limit physical key fallback to non-Latin layout output (#4469)                              | clean                                                                                           |
| `2fc676239` | fix: restore CLAUDE.md symlink target (#3929)                                               | recreated `CLAUDE.md` → `AGENTS.md` with no trailing newline                                    |
| `ec141c125` | fix(clients): default clone destination to folder plus repo name (#5989)                    | **subset** — dropped mobile; kept `WORKSPACE_COMMANDS` tests                                    |
| `20a70420a` | fix(web): keep timestamp date and time in the same locale (#7081)                           | clean                                                                                           |
| `a5e29edee` | feat(web): send PR line requests to agent (#6597)                                           | clean                                                                                           |
| `e58cbb9e7` | fix(web): restore dark theme palette (#6663)                                                | **adapted** — `html[data-theme-id]:not([data-theme-id=""])` in `styles/themes.css`              |
| `2f486ab80` | refactor(web): simplify advanced theme controls (#7107)                                     | **adapted** — kept Ronin Paper/Graphite themes; family updater before them                      |
| `d484735c6` | fix(web): keep highlighted command menu items clear of the scroll fade (#7132)              | 3way                                                                                            |

### Already in the tree (0)

None as whole commits.

### Skipped (12)

| Upstream    | Title                                                                                               | Why                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `b277cc65e` | fix(mobile): use tryOpenExternalUrl for markdown links in ThreadFeed (#5872)                        | no mobile app                                                                                                                               |
| `db3278f97` | fix(marketing): keep Grok mark clear of mobile hero copy (#4542)                                    | no marketing site                                                                                                                           |
| `3bc4fdf05` | fix(mobile): recover the QR pairing scanner when camera access is denied (#6487)                    | no mobile app                                                                                                                               |
| `4db50757c` | fix(mobile): explain iOS-only settings on Android (#4981)                                           | no mobile app                                                                                                                               |
| `a7c5ad5db` | fix(web): unstick /connect after in-modal sign-in by redirecting to the authorize endpoint (#5133)  | Clerk / T3 Connect cut                                                                                                                      |
| `efe1773e9` | fix(web): hide T3 Connect toggle in web app settings (#5068)                                        | Connect toggle is already gone from `ConnectionsSettings`                                                                                   |
| `d79f975d0` | fix(web): keep the composer glass aligned with the context strip at any interface font size (#5703) | Ronin composer is a flat `.composer-surface`; no `shape()` glass clip-path                                                                  |
| `31d0fb6ca` | fix(mobile): use Android monospace font family (#4609)                                              | no mobile app                                                                                                                               |
| `277a7cb44` | fix(mobile): prevent crash on sign out in settings (#4899)                                          | Clerk / mobile cut                                                                                                                          |
| `f8bb92b51` | fix(mobile): local-checkout threads record their branch so PR badges show (#4986)                   | no mobile app                                                                                                                               |
| `04f23098e` | fix(marketing): detect Mac chip on homepage download button (#4197)                                 | no marketing site                                                                                                                           |
| `ad117235b` | feat(desktop): add signal macOS DMG installer background (#6201)                                    | upstream Signal/T3 branding; deletes `resources/icon.{icns,ico,png}` Ronin still launches from. A Ronin DMG theme is a separate design task |

### Verification

- `git diff --check` — clean.
- Typecheck: `@t3tools/contracts`, `@t3tools/shared`, `@t3tools/client-runtime`, `@t3tools/ssh`,
  `@t3tools/web`, `@t3tools/desktop`, `t3` (server) — 0 errors. Server Effect-diagnostic
  _suggestions_ remain pre-existing (`decider.ts`, `AntigravityAdapter.ts`, `PiAdapter.ts`,
  `workflowScriptQuery.ts`, speech-to-text) and were not introduced by this batch.
- Focused tests: desktop preview/window/quit-hold/ElectronApp 81 tests pass; shared/contracts/ssh/
  client-runtime 148 tests pass; server adapters/orchestration/MCP/SQLite/Claude 390+ tests pass;
  web composer/markdown/timeline/palette/keybindings 277+ tests pass.
- `vp lint` on 10 representative new/adapted files — 0 findings.
- Index left unstaged, as found. New files from this batch remain untracked until committed.

**Hit every surface (for this batch):** desktop (zoom isolation, hold-to-quit, locale, thumb-button
preload, backend readiness, UTF-8 shells), web renderer (composer, markdown, preview, PRs,
settings, keybindings), contracts (IPC, keybindings, orchestration attachments), providers
(Claude / Codex / Cursor / Grok / OpenCode), remote SSH, docs (`docs/user/composer.md`,
`keybindings.md`, `source-control.md`, `providers-claude.md`). No mobile / Connect / WSL /
Playwright picker restore.

## Batch 6 — reviewed through `bab4b6f02` (7 commits)

Snapshot tip: `bab4b6f02b8bdaf15fd32636a97f69ff657cec50`. Watermark was `d484735c6`.

### Ported (3)

| Upstream    | Title                                                                           | Notes                                                                  |
| ----------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `3583cd27d` | test: favor behavior over implementation details (#7157)                        | **subset** — web + shared hunks only; mobile hunks dropped             |
| `4cb676cc1` | docs: point CLAUDE.md at AGENTS.md with an @import instead of a symlink (#7171) | clean — reverses Batch 5's `2fc676239`, matching upstream's new stance |
| `4c1d99d7f` | fix(web): show filenames when commit dialog paths overflow (#6392)              | clean — Ronin's changed-file row still matched upstream's parent       |

`3583cd27d` is upstream's "assert behavior, not implementation" pass. Two of its three targets are
mobile (`peekPendingTerminalLaunch`, `threadTerminalSubscriptionKey` and their tests) and were
dropped. What applies here removes genuinely dead exports rather than coverage:

- `toolCallExpandedBodyClassName` is un-exported from `MessagesTimeline.tsx` and its test dropped.
  That test asserted the class string carries `var(--font-size-code`, from Batch 5's `5e1473715`
  port. The `--font-size-code` sizing itself is untouched; only the string-shape assertion goes.
- `COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX` was an alias of
  `COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX` with no reader outside its own module and
  test. Verified by grep across `apps/web` and `packages` before removing it.
- One duplicate `nextTerminalId([])` assertion in `packages/shared/src/terminalLabels.test.ts`.

`4cb676cc1` replaces the `CLAUDE.md → AGENTS.md` symlink with a one-line `@AGENTS.md` import.
Recreating that symlink _was_ a Batch 5 port (`2fc676239`); upstream has now reversed itself, and the
new form is the one that survives a Windows checkout — which matters for a fork whose shipped
product is a Windows desktop app. Nothing in the tree reads `CLAUDE.md` as content: the only
references are the bundled `mattpocock` skills (generic guidance) and a file-icon test fixture. The
resulting blob is byte-identical to upstream's.

`4c1d99d7f` adds `StartTruncatedPath` (an RTL `<bdi>` trick that keeps the filename visible when a
long path overflows) and points the commit dialog's changed-file rows at it. Both new files match
upstream byte for byte; Ronin's `ui/tooltip` already exposes the `Tooltip` / `TooltipTrigger render=`
/ `TooltipPopup` API the component needs.

### Already in the tree (0)

None.

### Skipped (4)

| Upstream    | Title                                                    | Why                                                                     |
| ----------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `277322933` | test: remove redundant and stale tests (#6267)           | test-only deletion; the tests are not stale here — see below            |
| `d23b181da` | feat(mobile): add built-in themes (#6619)                | mobile feature; its web/shared hunks only exist to feed it — see below  |
| `89c52a331` | fix(mobile): keep sheet actions below status bar (#6635) | no mobile app in this repo                                              |
| `bab4b6f02` | fix(web): align Windows update confirmation copy (#7208) | upstream's electron-updater surface is cut — same reason as `1a6599437` |

`277322933` deletes 875 lines of tests across 11 files. Three of those files do not exist here
(`PickPreload.test.ts`, `infra/relay/scripts/deploy.test.ts`, `scripts/mobile-showcase.test.ts` —
all cut surfaces) and one more is absent (`apps/web/src/features/terminal/terminalMenu.test.ts`).
The remaining seven were run before deciding, and **all pass: 75 tests across 7 files**. They cover
live Ronin behavior, including `orchestrationRecovery.test.ts` (10 tests on the replay/recovery
coordinator, which is the remote-ready reconnect path this fork is built around),
`orchestrationEventEffects.test.ts`, `historyBootstrap.test.ts`, `terminalUiStateCleanup.test.ts`,
`ProviderRegistry.test.ts`'s merged-snapshot persistence, `commandInvariants.test.ts`'s
`requireNonNegativeInteger`, and `tailscaleEndpointProvider.test.ts`'s CGNAT-boundary check for
`isTailscaleIpv4Address`. Upstream leaves those production functions in place, so porting the
deletion would only make them untested. "Redundant" is upstream's coverage judgment on upstream's
suite; taking it buys this fork nothing and costs it coverage on a path it diverges toward.

`d23b181da` lifts the built-in palettes (T3 Chat, Ember, Grove, Iris, Ocean) out of
`apps/web/src/themePalette.ts` into `packages/shared/src/themePalettes.ts`, plus a shared
`themePreview.ts` render spec, so the mobile app can render the same themes. There is no behavior
change for web — `ThemePreviewCircles` swaps inline constants for spec-derived ones that compute to
the same blur, scale and gradient stops. With no mobile app to consume it, the extraction is churn
across a module where Ronin has deliberately diverged (its own Sakura / Paper / Graphite themes).

`bab4b6f02` drops the Windows-specific paragraph from an install-confirmation dialog that does not
exist here. All four files it touches are cut: `desktopUpdate.logic.ts`, `LegacySidebar.tsx` and
`sidebar/SidebarUpdatePill.tsx` are absent, and `SettingsPanels.tsx` never calls
`getDesktopUpdateInstallConfirmationMessage` — Ronin replaced that whole state machine with
`appUpdate.ts` + `AppUpdateProvider` (see Batch 4's note on `1a6599437`).

### Verification

- Focused tests: `StartTruncatedPath` + `composerFooterLayout` + `terminalLabels` 3 files / 15 tests;
  `MessagesTimeline.test.tsx` 20 tests; `GitActionsControl.logic.test.ts` 62 tests — all pass.
- Triage evidence for `277322933`: the 7 present files it deletes were run and pass (4 web files /
  22 tests, 3 server+desktop files / 53 tests).
- Typecheck: `@t3tools/web`, `@t3tools/shared` — 0 errors.
- `vp lint` over all 8 changed/added source files — 0 findings. `vp fmt --check` — all correctly
  formatted.
- `git diff --check` and `git diff --cached --check` pass. Index left unstaged, as found; the two
  new `StartTruncatedPath` files remain untracked until committed.

**Hit every surface (for this batch):** web renderer (commit dialog changed-file rows, composer
footer layout, message timeline), `packages/shared` (terminal labels test), repo agent docs
(`CLAUDE.md`). No contract, provider, desktop-IPC, connection-mode or user-doc surface is touched by
what was ported — the commit-dialog fix is presentation-only and reversible by nature (the full path
stays available in the row's tooltip).

## Batch 7 — reviewed through `cebac353d` (7 commits)

Reviewed `949feb61e..cebac353d`, snapshotted at `cebac353d` for the whole run.

> **Log gap, not a review gap.** Commit `3a253cdb3` moved the watermark from `bab4b6f02` to
> `949feb61e` without appending the batch section for that range. Those commits were judged (the
> watermark is authoritative and their work is in the tree — preview defaults, PR rate limits, the
> Integrations panel), but their per-commit verdicts were never written down. This batch does not
> re-review them.

### Ported (4)

| Upstream    | Title                                                                      | Notes                                              |
| ----------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| `cd096b9ad` | feat(server): let users withhold browser access from agents (#7083)        | **adapted** — see below                            |
| `c7e6d711d` | feat(web): make review verdicts legible in the pull request detail (#7077) | **adapted** — one import conflict, both sides kept |
| `a4cc1367b` | fix(web): show all usage breakdown periods (#7219)                         | **adapted** — same bug here, different render path |
| `3723722f7` | test(web): remove duplicate lookup assertion (#7364)                       | clean                                              |

`cd096b9ad` is the substantial one: a server-authoritative `enableAgentBrowserAccess` setting that
withholds the MCP credential, so the preview toolset is never attached to a provider session and the
prompt text describing those tools is dropped with it. Four fork-specific decisions:

- **Branding.** Ronin's Codex prompt block is `RONIN_BROWSER_TOOL_INSTRUCTIONS` describing the
  `ronin` MCP server, not upstream's `T3_CODE_BROWSER_TOOL_INSTRUCTIONS` / `t3-code`. The two
  exported constants became the `codexPlanModeDeveloperInstructions(browserToolsAvailable)` /
  `codexDefaultModeDeveloperInstructions(browserToolsAvailable)` functions upstream introduced, but
  they gate Ronin's block under Ronin's names.
- **`nativeMode` preserved.** Ronin's `buildCodexCollaborationMode` passes `nativeMode` to
  `buildCodexDeveloperInstructions`, where upstream passes `input.interactionMode`. Only the new
  third argument was added; the fork's choice of first argument stands.
- **A vacuous assertion fixed.** Upstream's new deny-path test asserts
  `doesNotMatch(/T3 Code collaborative browser/)`. Against Ronin's "## Ronin collaborative browser"
  heading that passes whether or not the block is present, so it would have tested nothing. Changed
  to `/Ronin collaborative browser/`.
- **Cut surface + fork divergence in the new tests.** `AnalyticsService` does not exist in this repo
  at all, so `Layer.provide(AnalyticsService.layerTest)` was dropped. Ronin's `ProviderService` also
  resolves the continuation ledger, so the directory layer now uses the file's own
  `makeSessionRepositoriesLayer(SqlitePersistenceMemory)` helper instead of upstream's
  runtime-repository-only layer. Upstream's unused `EnvironmentId` import was dropped rather than
  carried in, because this repo's lint flags it.

`a4cc1367b` drops a `.slice(0, 8)` that truncated the usage breakdown table to 8 rows in a window
that can hold 90. Ronin has the same truncation but renders through a `TimeBreakdown` subcomponent
rather than an inline `<tbody>`, so only the memo and the one prop site changed; the rename to
`breakdownPeriods` was kept so the name stops claiming a recency limit that no longer exists.

`c7e6d711d` applied cleanly across five of six files. `pullRequestPresentation.tsx` conflicted only
on an import line — Ronin has `DiffStatLabel` where upstream added `Badge` — and both are needed, so
both were kept. The commit's approval-count header, verdict badges and timeline verdict rows sit
alongside this fork's segmented-control tab styling in `PullRequestDetailPanel.tsx` without
overlapping it.

### Already in the tree (0)

None.

### Skipped (3)

| Upstream    | Title                                                          | Why                                                |
| ----------- | -------------------------------------------------------------- | -------------------------------------------------- |
| `13458e651` | fix(web): center the context usage meter (#7296)               | fixes an artifact of upstream's `Button` primitive |
| `33a8b07dd` | fix(mobile): rotate snoozed and settled shelf chevrons (#7276) | no mobile app in this repo                         |
| `cebac353d` | fix(mobile): show structured input option descriptions (#7321) | no mobile app in this repo                         |

`13458e651` adds `mx-0!` to the meter's SVG. Upstream renders that meter inside its `Button`
primitive, whose `[&_svg]:-mx-0.5` shifts the circle off-centre; the override cancels that margin.
Ronin's `ContextWindowMeter` uses a raw `<button>` with its own classes and no svg margin rule —
there is nothing for `mx-0!` to override, and no global svg margin exists in `styles/`. Taking it
would add a no-op `!important`. (Separately noted, not acted on: the component is currently exported
but not imported anywhere in this fork.)

The two mobile commits touch only `apps/mobile/`, which this fork does not have.

### Verification

- Focused tests, all pass: `ProviderService.test.ts` 32 tests (incl. the 3 new agent-browser-access
  cases), `CodexSessionRuntime.test.ts` 25 tests, `apps/web/src/components/pullRequest/` 15 files /
  280 tests, `workspaceBasenameLookup.test.ts`, `apps/web/src/components/usage` — 19 files / 357
  tests together.
- Typecheck: `@t3tools/contracts` 0 errors, `@t3tools/web` 0 errors. `@t3tools/server` reports one
  error in `src/background/HostPowerMonitor.ts:69` (`exactOptionalPropertyTypes` on an
  `Option.match` returning `Effect<boolean> | Effect<void>`). **Pre-existing and unrelated** —
  reproduced on a stashed clean tree at `e44e1718e`; no file in this batch touches it.
- `vp lint` over all 17 changed files — 0 findings. `vp fmt --check` — all 17 correctly formatted.
- `git diff --check` clean. Index left fully unstaged, as found; `git apply --3way` had staged the
  files it touched and left two unmerged, so the index was reset after resolving.

**Hit every surface (for this batch):** contracts (`ServerSettings` + `ServerSettingsPatch` gain
`enableAgentBrowserAccess`), server (provider MCP credential issuance, Codex prompt construction),
web renderer (Integrations settings row, settings search index, restore-defaults label list, usage
breakdown table, pull request detail/summary/timeline). Reverse state is covered: the setting has a
reset action, is listed by name in the restore-defaults confirmation, and the deny path revokes an
already-issued credential rather than only withholding the next one. No desktop-IPC, provider-adapter
or connection-mode surface is touched. No user-facing doc in `docs/user/` describes agent browser
access yet — worth adding when the setting is next revisited, but out of scope for a port.

---

## Batch 8 — reviewed through `beab6886f` (45 commits)

Reviewed `cebac353d..beab6886f`, snapshotted at `beab6886f` for the whole run.

Two decisions were taken to the developer before any code was written, because both were product
calls rather than port mechanics:

- **The five-commit redesign wave** (`#7147` usage insights, `#7148` pull request details, `#7150`
  composer state drawers, `#7152` collapse tool activity, `#7153` unify workspace navigation).
  Ronin has deliberately diverged on every one of those surfaces. Decision: **take the non-visual
  parts only**, skip the visual rewrites. What that meant in practice is spelled out under
  _Partially ported_ below.
- **`npx t3 triage`** (`324ddda31`). Decision: **skip** — see _Skipped_.

### Ported (30)

| Upstream    | Title                                                                                     | Notes                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `82b8a9380` | fix(orchestration): do not revive idle tasks from status-free progress (#7172)            | clean                                                                    |
| `a87f691bd` | fix(preview): open local environment ports on localhost (#7300)                           | clean                                                                    |
| `f3cb7f509` | fix(desktop): prevent quit shortcut spillover (#7397)                                     | clean                                                                    |
| `3b5d476eb` | fix(desktop): stop overwriting a custom dock icon on launch (#7125)                       | **adapted** — fork added a Windows protocol block; context only          |
| `fda740ad7` | feat(web): show project location in new thread picker (#7392)                             | **adapted** — one import-block conflict                                  |
| `26af903b9` | fix(web): label pull request merge actions (#7381)                                        | clean                                                                    |
| `636caf4c7` | fix(server): avoid PRs inherited from default upstreams (#7317)                           | clean                                                                    |
| `3a02c9cf1` | feat(desktop): mute a browser tab (#7252)                                                 | **adapted** — see below                                                  |
| `bcfd48586` | fix(web): improve disconnected composer placeholder (#7122)                               | **adapted** — fork's guard is `phase === "disconnected" && activeThread` |
| `fe281c540` | fix(desktop): throttle hidden preview rendering (#7445)                                   | **adapted** — see below                                                  |
| `e7f6a30ca` | fix(server): stop probing Grok, Cursor, and OpenCode unless turned on (#7459)             | **adapted** — see below                                                  |
| `efcf7d1ac` | fix(desktop): boot the main window unthrottled so cold start paints at full speed (#7460) | **adapted** — see below                                                  |
| `f21b47e52` | fix(threads): a merged PR settles its thread only once (#7454)                            | **adapted** — mobile hunks dropped; fork's board updated too             |
| `3b8e7bbbe` | feat(web): add shortcuts to the surface dropdown (#7318)                                  | **adapted** — two context conflicts                                      |
| `36f4314ab` | fix(web): animate command palette when closing (#5169)                                    | clean                                                                    |
| `2aa5f095f` | feat(server): run the background service on macOS via launchd (#6286)                     | **adapted** — see below                                                  |
| `8bbbab505` | fix(web): align sidebar statuses with project names (#7491)                               | clean                                                                    |
| `24c4ba68f` | fix(desktop): close the window before quit cleanup (#6562)                                | **adapted** — no `DesktopLifecycle.test.ts` in this fork                 |
| `68d569138` | fix(web): align version text with its label (#7521)                                       | **adapted** — see below                                                  |
| `4347f14b8` | fix(web): refresh open file with the file tree (#7490)                                    | **adapted** — context only                                               |
| `cf251c3bd` | Add OpenCode skill discovery (#3154)                                                      | clean                                                                    |
| `80c37f1a7` | fix(web): hide opencode's plan agent when legacy plan mode is off (#6420)                 | **adapted** — see below                                                  |
| `3c0665543` | feat: refine thread action menus (#7476)                                                  | **adapted** — see below                                                  |
| `51341f2ac` | fix(server): outdated gh no longer reads as "not authenticated" (#7588)                   | **adapted** — docs rebranded to Ronin                                    |
| `0508792c5` | feat(web): confirm before closing a terminal (#7592)                                      | **adapted** — fork routes shortcuts through `runWorkspaceCommand`        |
| `62654d279` | fix(web): usage hourly breakdown lists every hour chronologically (#7595)                 | **adapted** — fork's `UsagePage` had drifted                             |
| `105cd5e0c` | fix(web): remove the terminal pane's app-canvas gutter (#6222)                            | clean                                                                    |
| `b2e2ccfdb` | fix(server): preserve tool lifecycle identity (#7151)                                     | clean — paired with a one-line web fix, see below                        |
| `f708f63fa` | test(web): remove redundant timestamp assertions (#7633)                                  | clean                                                                    |
| `beab6886f` | fix(web): import dependency-heavy Open VSX themes (#7642)                                 | clean                                                                    |

Fork-specific decisions worth recording:

- **`3a02c9cf1` (mute a browser tab).** The whole feature lands — IPC channel, preload bridge,
  `PreviewManager.setAudioMuted`, per-tab `audioMuted`/`audible` in the contracts, and the tab-strip
  indicator. Six test hunks rejected against `Manager.test.ts`: three were webContents mocks that
  needed the two new methods (added mechanically), three targeted picture-in-picture tests this fork
  does not have.

- **`fe281c540` + `efcf7d1ac` (background throttling).** These two are a pair and only make sense
  together: the first drops the blanket `backgroundThrottling: false` and hands throttling to the
  preview manager, the second re-introduces it as a boot-only measure released on first reveal. Both
  were applied and the net state matches upstream. The manager adaptation is real: Ronin has no
  picture-in-picture, so `setMainWindow`'s new `closed` handler stops recordings only, where upstream
  also closes PiP windows. `Fiber` is now imported for the cleanup fiber.

- **`e7f6a30ca` (opt-in provider probing).** Grok and OpenCode become default-off, joining Cursor.
  Ronin's four extra providers (Antigravity, Droid, Kilo, Pi) were **already** default-off, so no
  change was needed there and none was made. `docs/user/install.md` gained the opt-in note, worded
  for Ronin's nine-provider table rather than upstream's five.

- **`f21b47e52` (settle-on-merge happens once).** The mobile half was dropped. The fork-only piece:
  `apps/web/src/components/board/` classified lanes through a `changeRequestStateByThreadKey` map of
  bare PR states, which cannot express "this merge predates the thread's latest event". It now
  carries the full change request as `changeRequestByThreadKey`, so the board, the sidebar and the
  chat header all settle on the same rule. `ChatHeader`'s `changeRequestState` prop became
  `changeRequest` to match.

- **`2aa5f095f` (launchd).** `apps/server/src/cli/connect.ts` and `apps/server/src/cloud/http.ts`
  do not exist here (T3 Connect is cut), so those two hunks were dropped; everything else — the
  `BootServiceManager` abstraction, the plist renderer, `HostProcessUserId`, the launcher comment —
  applied. `cli/service.ts` needed hand-adaptation because Ronin had already stripped the "stays
  reachable through T3 Connect" copy from the onboarding prompt; the platform-aware wording was
  rebuilt on top of Ronin's shorter message. `docs/user/background-service.md` gained upstream's
  whole Platform Support section, rebranded.

- **`68d569138` (version alignment).** Upstream's `AboutVersionTitle` is a label plus a `<code>`;
  Ronin's also renders an "Update available" `Badge`. Flipping the outer flex to `items-baseline`
  would have dragged the badge onto the text baseline too, so the label and code were wrapped in
  their own `items-baseline` span and the badge left centred. Same fix, no collateral.

- **`80c37f1a7` (hide OpenCode's plan agent).** Applied whole, including the new
  `planAgentSelectionHeal.tsx`. `TraitsMenuContentProps` gained a required `planModeEnabled`, which
  Ronin's own `AutomationModelField.tsx` also had to pass — it reads it from `usePrimarySettings()`,
  the same merged-settings source `ProjectSettingsPanel` uses.

- **`3c0665543` (thread action menus).** Upstream folds the three copy actions into a "Copy"
  submenu and puts icons and `separatorBefore` dividers on the rest. Ronin has two extra items
  upstream lacks — "Discard captured task" and the "Export conversation" submenu — which upstream's
  patch knows nothing about. Both were kept and given icons so the menu does not end up half
  iconned: `trash` for discard (it exists in the fallback icon map; Delete stays visually distinct
  because it is destructive-styled) and a new `download` path added to `ICON_PATHS` for export,
  marked in the source as Ronin-only. Upstream's new `contextMenuFallback.test.ts` harness tripped
  this repo's `no-this-alias` lint rule in a `FakeElement.isConnected` getter; the walk was lifted
  into a free `rootOf()` helper, which is behaviour-identical and keeps lint at zero findings.

### Partially ported (1)

Only one of the five redesign commits had a design-neutral half worth taking.

- **`4a9edff4c` (#7152).** Taken: the one-line `extractToolCallId` change in
  `apps/web/src/session-logic.ts`, which prefers the runtime `payload.toolCallId` over the legacy
  nested `payload.data.toolCallId`. This is not cosmetic — it is the client half of `b2e2ccfdb`,
  which changed the **server's** snapshot retention to key on the same field. Porting the server
  side alone would have left the two ends collapsing lifecycle rows under different identities.
  Not taken: the timeline row model (`work-live` rows, tool-group summaries, expand/collapse), the
  `MessagesTimeline` rewrite, and the ~74 lines of `index.css` it needs.

The other four are recorded under _Skipped_.

### Already in the tree (1) — do not re-port

| Upstream    | Title                                                                                                | Where it lives                 |
| ----------- | ---------------------------------------------------------------------------------------------------- | ------------------------------ |
| `1896f39a3` | refactor(server): simplify error transformation with Effect.mapError in GitHubPullRequestCli (#7385) | `GitHubPullRequestCli.ts:1454` |

The patch does not reverse-apply because our surrounding comment has drifted, but the
`Effect.mapError(() => error)` form is already the code on disk.

### Skipped (13)

| Upstream    | Title                                                                               | Why                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `db0659fea` | fix(packaging): install AUR launcher icons where icon themes look (#7421)           | no `packaging/` in this repo                                                                          |
| `6a687ee43` | fix(desktop): stop the passkey dialog from popping as soon as sign-in opens (#7437) | Clerk cut — zero `clerk` references remain in the tree                                                |
| `7441b3692` | fix(desktop): upgrade Clerk OAuth transport (#7479)                                 | Clerk cut; lockfile/workspace only                                                                    |
| `324ddda31` | feat(cli): npx t3 triage hands broken installs to your own coding agent (#6563)     | see below                                                                                             |
| `5ea5a80a8` | fix(marketing): Safari gets the arm64 Mac download (#7473)                          | no `apps/marketing` in this repo                                                                      |
| `67e2fe71d` | fix(marketing): never serve the Intel build to Apple Silicon Macs (#7477)           | same                                                                                                  |
| `f2d5fc91e` | fix(desktop): stop automatic passkey prompts (#7522)                                | Clerk cut                                                                                             |
| `a354dd9dd` | fix(desktop): refresh queued updates before install (#6269)                         | see below                                                                                             |
| `9027d6267` | chore(desktop): use stable Clerk Electron release (#7602)                           | Clerk cut; lockfile/workspace only                                                                    |
| `07f8027d9` | feat(web): unify workspace navigation (#7153)                                       | redesign wave — navigation chrome end to end, superseded by Ronin's shell                             |
| `792a1404f` | feat(web): attach composer state drawers (#7150)                                    | redesign wave — its `session-logic.ts` work computes plan-step durations only the new drawer displays |
| `a850895f6` | feat(web): refresh pull request details (#7148)                                     | redesign wave — see below                                                                             |
| `8c85b4933` | feat(web): redesign usage insights (#7147)                                          | redesign wave — see below                                                                             |

- **`324ddda31`.** `npx t3 triage` is real product surface, but everything that makes it work points
  at upstream: it clones `pingdotgg/t3code` at the user's release tag, fetches its playbook from
  that repo's `main`, files into that repo's issue tracker via a new `.github/ISSUE_TEMPLATE`, and
  its playbook text asks about `app.t3.codes` and the mobile app. Making it useful in Ronin means
  rewriting the playbook for this fork's repository and tracker — a product decision, not a port.
  Confirmed skipped with the developer. Worth revisiting deliberately if Ronin wants its own triage
  flow.

- **`8c85b4933`.** Its only fork-neutral-looking change, `ProviderTotals.sessions` in
  `packages/shared/src/usageMerge.ts`, exists purely to feed the redesigned per-provider rows;
  landing it here would add an unread field to a shared contract. (The genuinely useful usage fix in
  this range, `62654d279`, is a separate commit and **was** ported.)

- **`a850895f6`.** Nothing survives the visual cut: `changeRequestRepositoryUrl` and
  `isStackedPullRequestBase` are helpers only the redesigned detail panel calls, and its
  `pullRequestHandoffLabels` change _removes_ the `resolve`/`resolveConflicts` labels because the new
  panel dropped those buttons — Ronin still renders them.

- **`a354dd9dd`.** All six files are missing: this fork has no `apps/desktop/src/updates/` and no
  `apps/web/src/components/desktopUpdate.logic.ts`. Ronin's updater is a different implementation
  (`apps/desktop/src/app/DesktopAutoUpdate.ts`), so upstream's `updateMachine` refresh has nothing
  to attach to.

### Verification

- **Typecheck, all clean:** `@t3tools/contracts`, `@t3tools/shared`, `@t3tools/client-runtime`,
  `@t3tools/web`, `@t3tools/desktop`, `t3` (server). Four **pre-existing** suggestions survive and
  were reproduced on a stashed clean tree: `DesktopAutoUpdate.ts:175` (`runEffectInsideEffect`) and
  three `unnecessaryFailYieldableError` hits in `ClaudeAdapter.ts` / `ProviderService.ts`. No file in
  this batch touches any of them.

  Two type errors _were_ introduced by the port and fixed: `board.logic.ts` /
  `board.logic.test.ts` / `useBoard.ts` still passing `changeRequestState` (see `f21b47e52` above),
  and `AutomationModelField.tsx` missing the new required `planModeEnabled` prop.

- **Focused tests, all pass.**
  - server: `ThreadBackgroundLiveness` · `ActivityPayloadProjection` · `GitHubSourceControlProvider`
    · `serverSettings` (44 tests); `GrokProvider` · `OpenCodeProvider` ·
    `ProviderInstanceRegistryLive` · `opencodeRuntime.cliParsers` · `opencodeRuntime.inventory` ·
    `cli/service` · `cloud/bootService` (59 tests); `GitManager` (84) and
    `ProviderRuntimeIngestion` (47).
  - desktop: `DesktopAppIdentity` · `QuitHold` · `DesktopWindow` · `ElectronWindow` · `ElectronMenu`
    (55 tests); `preview/Manager` (56 tests).
  - web: 16 files / 281 tests across `browserTargetResolver`, `CommandPalette.logic`,
    `RightPanelTabs`, `ThreadStatusIndicators`, `board.logic`, `composerProviderState`,
    `threadActionMenu.logic`, `contextMenuFallback`, `modelSelection`, `openVsxThemes`,
    `previewStateStore`, `timestampFormat`, `terminalCloseConfirm`, `PreviewView`,
    `usePreviewBridge`; plus 18 files / 393 tests across `components/usage`, `session-logic`,
    `MessagesTimeline.logic` and `components/pullRequest`.
  - `packages/client-runtime` `threadSettled` (191 tests); `packages/contracts` `settings` (37).

  **One flake, not a failure:** `GitManager.test.ts > does not reuse a cross-repo PR when GitHub
omits head identity metadata` timed out at 20s when `GitManager.test.ts` and
  `ProviderRuntimeIngestion.test.ts` ran together. It passes alone, and the full 84-test
  `GitManager` file passes alone in 20s. These tests shell out to real `git`; the budget is tight
  under parallel load.

- **Lint:** `vp lint --report-unused-disable-directives` over all 107 changed/added `.ts`/`.tsx`
  files — 0 findings, after the `no-this-alias` fix noted under `3c0665543`.
- **Format:** `vp fmt --check` over those 107 files plus the four changed docs — all correct.
- `git diff --check` clean. Nothing staged; the index was left as found.

**Hit every surface (for this batch):**

- **Contracts** — `ContextMenuItem.separatorBefore`; `DesktopPreviewTabState.audioMuted`/`audible`
  plus `DesktopPreviewSetAudioMutedInputSchema` and the bridge method;
  `VcsStatusChangeRequest.updatedAt`; `resolveProviderInstanceEnabled` /
  `providerInstanceConfigEnabledFlag` / `defaultEnabledForDriver`; Grok and OpenCode default-off.
- **Server** — liveness, PR lookup keyed on the default branch, settings folding of the legacy
  in-config `enabled` flag, `gh` version detection, tool lifecycle identity, OpenCode skill
  discovery, launchd boot service.
- **Desktop (Electron/IPC)** — quit hold, quit-time window teardown, dock icon, preview mute
  channel, background throttling, native menu separators.
- **Web renderer** — command palette (project location, close animation), right panel surface
  shortcuts and mute indicator, sidebar/board/chat-header settle rules, composer placeholder and
  plan-agent healing, file browser refresh, terminal close confirmation, usage hourly breakdown,
  settings (provider cards, source control, version row).
- **Providers** — the enabled-default change is per driver and was checked against all nine
  adapters; OpenCode gains skill discovery; no other adapter needed a decision.
- **Reverse states** — mute has unmute (and survives webview swaps); the terminal close
  confirmation has a cancel path; a merged PR that settles a thread no longer re-settles it after
  the user re-engages; provider opt-in has an opt-out on the same card.
- **Connection modes** — `a87f691bd` matters for local loopback environments specifically;
  `fda740ad7` labels local vs remote environments in the picker, which only exists because Ronin is
  multi-environment.
- **Docs** — `docs/user/install.md` (provider opt-in), `docs/user/source-control.md` (gh 2.81.0),
  `docs/user/background-service.md` (macOS platform support), `docs/internals/server-updates.md`
  (service manager wording). No new vocabulary, so `docs/internals/glossary.md` is untouched.

## Batch 9 — reviewed through `be7d35aae` (31 commits)

Reviewed `beab6886f..be7d35aae`, snapshotted at `be7d35aae` for the whole run. No commit needed a
product decision from the developer; every verdict fell out of what this fork already has.

Two upstream commits in this range are a **pair that cancels out**, and one is a **revert of a
batch-8 port** — both are recorded under _Ported_ as their net effect, not as their individual
patches.

### Ported (25)

| Upstream    | Title                                                                                | Notes                                                                   |
| ----------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `8824f8f24` | fix(web): retry failed thread bootstraps with a fresh id (#7664)                     | clean                                                                   |
| `21e80a063` | fix(web): copy terminal selection instead of a blank clipboard (#7678)               | clean                                                                   |
| `aa17ec6e7` | revert(web): restore sparse hourly usage breakdown (#7718)                           | **adapted** — reverts batch 8's `62654d279`; see below                  |
| `0929907ff` | fix(server): reconcile orphaned provider sessions (#7719)                            | **adapted** — both test harnesses needed Ronin's service shapes         |
| `490f48ed9` | fix(web): fix subagent row left border being cut off (#7207)                         | **adapted** — kept Ronin's `text-sm`, dropped the `-mx-1`               |
| `cd14b3ec2` | fix(web): unify composer control rounding (#5957)                                    | clean                                                                   |
| `5ff5f735e` | fix(web): show pointer on add project button (#5545)                                 | **adapted** — kept Ronin's `text-2xs`, added `cursor-pointer`           |
| `730ce9edd` | fix(server): enable the Cursor provider by default like every other provider (#7089) | net with `fe8750208`; see below                                         |
| `fe8750208` | fix(contracts): reconcile provider default tests (#7725)                             | net with `730ce9edd`; see below                                         |
| `1afe5545b` | fix(web): fix thread jumping after reorder (#7103)                                   | clean                                                                   |
| `4bdbd8ce1` | fix(server): keep Daybreak models out of legacy models (#7659)                       | clean                                                                   |
| `6d3bf01b4` | fix(web): show the full path in file link tooltips (#7741)                           | **adapted** — kept Ronin's `markdown-file-link-tooltip-scroll` class    |
| `820e5639c` | fix(server): serve html assets with utf-8 charset (#6409)                            | clean                                                                   |
| `12c497083` | fix(vcs): give `git worktree add` a longer timeout on large repos (#6326)            | clean                                                                   |
| `9167622a4` | chore: move implementation plans out of repository (#7665)                           | **adapted** — no `.plans/` here to delete; see below                    |
| `20e5a3396` | fix(desktop): restrict editor deep links (#7697)                                     | clean                                                                   |
| `6d5c6c4a6` | fix(web): prevent pinned threads reshuffling after drop (#7676)                      | **adapted** — kept Ronin's flat-order comment inside the new `<ul>`     |
| `18f6d0348` | fix(web): encode shifted characters correctly in the terminal (#7485)                | clean                                                                   |
| `f3fcfe1f6` | fix(web): resolve sidebar provider icons from the thread's own environment (#7292)   | **adapted** — one hoist conflict; see below                             |
| `ce8ca5bb3` | fix(web): hide thread jump hints while the terminal is focused (#7277)               | **adapted** — `LegacySidebar.tsx` hunk dropped (cut surface)            |
| `e2697d63e` | fix(web): keep following the stream after scrolling back to the live edge (#6519)    | clean                                                                   |
| `d7b9a689f` | perf(ci): parallelize the test suite and split out Rust checks (#7286)               | **adapted** — see below                                                 |
| `9f12eab38` | chore: stop committing pull request assets (#7762)                                   | **adapted** — no `.github/pr-assets/` here to delete; guard still added |
| `549201fcf` | fix(clients): default GitHub clones to HTTPS (#7760)                                 | **adapted** — mobile hunk dropped                                       |
| `be7d35aae` | perf(web): stop preview loading rerenders (#7561)                                    | **adapted** — CSS lands in Ronin's `styles/motion.css`; see below       |

Fork-specific decisions worth recording:

- **`aa17ec6e7` (revert the dense hourly breakdown).** Batch 8 ported `62654d279`, which zero-filled
  every hour in the 24h window so the table read chronologically. Upstream reverted it eight hours
  later: sparse rows, newest first. The revert applied to the `useMemo`, but deleting `zeroHour`
  conflicted because Ronin's `UsagePage` has a `ProviderShareBar` where upstream has `ProviderMark`.
  Resolved by keeping Ronin's components and dropping only the helper. Upstream's new
  `UsagePage.test.tsx` was **rewritten** for this fork: its mocks name upstream's module graph
  (`PROVIDER_PRESENTATION`, `WorkspacePageHeader`, `../../env`), where Ronin's page imports
  `WorkspaceTopbar`, `Kbd`, `ProviderMark`, and `PROVIDER_COLOR`/`PROVIDER_LABEL`. Ronin's page also
  renders an empty state for `records === 0`, so the fixture sets `records`. The assertion is the
  regression guard unchanged: exactly two rows, newest first.

- **`730ce9edd` + `fe8750208` (Cursor on by default).** These two are one change split across two
  commits — the first flips `CursorSettings.enabled` to `true` and adds a test, the second deletes
  that test and fixes the two pre-existing default tests it contradicted. Only the net state was
  landed: Cursor decodes enabled, `defaultEnabledForDriver("cursor")` is `true`, and the comment
  reads "Enabled by default alongside Codex and Claude Agent." This reverses half of batch 8's
  `e7f6a30ca` — Grok and OpenCode **stay** default-off, and Ronin's four extra providers
  (Antigravity, Droid, Kilo, Pi) are untouched. `docs/user/install.md` now says "Codex, Claude, and
  Cursor are on by default."

- **`0929907ff` (orphaned provider sessions).** `serverRuntimeStartup.ts` applied clean and
  typechecks. Both tests needed adaptation, because Ronin's service shapes have grown members
  upstream's fakes predate: `ProviderServiceShape` carries `stopAgent`, `getContinuationState`, and
  `clearContinuationLedger`; `ProviderSessionDirectoryShape` carries `getLedgerEntry`,
  `listLedgerEntries`, and `clearLedger`. All six were added to the stubs. The integration harness
  needed three more edits: `src/telemetry/AnalyticsService.ts` does not exist here (telemetry is
  cut), so its import and layer were dropped; Ronin's startup also starts an `AutomationScheduler`,
  which is now mocked; and Ronin's `ProviderSessionDirectoryLive` is backed by a
  `ProviderSessionLedgerRepository`, whose layer is now provided from the same SQLite persistence.
  The upstream `.github/check-run-agents/` hunk was dropped — no such directory here.

- **`f3fcfe1f6` (per-environment provider icons).** Applies whole, including
  `deriveProviderEntriesByEnvironment`. The one conflict is a hoist: upstream moves the
  `environmentServerConfigsAtom` read up to feed the new map, and Ronin's original declaration site
  also holds the fork-only `useBuildSystems` block. The read moved, the build-system lines stayed.
  This matters more here than upstream — Ronin is multi-environment by design, and default instance
  ids are literally driver slugs, so a flat map mis-resolved icons across environments.

- **`9167622a4` (plans out of the repository).** `.plans/` never existed in this fork, so nothing
  was deleted. Taken: the `.gitignore` entry, the `vite.config.ts` ignore-pattern removal, the
  `markdown-links.test.ts` fixture change off a `.plans/` path, `docs/README.md`, and
  `docs/internals/work-artifacts.md` (rebranded to Ronin). `AGENTS.md` gained upstream's "Plans and
  work artifacts" section verbatim, placed before "How it works" as upstream places it.

- **`d7b9a689f` (CI parallelization).** Applies clean against Ronin's `ci.yml`, which diverges from
  upstream only in swapping `mobile_native_static_analysis` for a `windows` job and hardening the
  Clerk preload grep — neither of which this patch touches. Net: `check` and `test` stop installing
  a Rust toolchain, a `rust` job owns `cargo fmt --check` and `cargo test`, `test` runs everything
  except `t3` with `--parallel`, and `test_server` shards `apps/server` across three runners. The
  sharding comment was corrected from upstream's 239 server test files to this fork's 258.
  `docs/internals/ci.md` was rewritten to describe all six jobs — it previously claimed three and
  had already gone stale on the `windows` job. **This is the one change in the batch that cannot be
  verified locally**; only its YAML structure and the package filters (`t3`, `@t3tools/monorepo`)
  were checked against this workspace.

- **`9f12eab38` (no committed PR assets).** No `.github/pr-assets/` in this fork, so nothing was
  deleted, but the guard is still worth having: the `check` job now fails on any tracked file under
  that path, `.gitignore` covers it, and `AGENTS.md` says to upload PR evidence to GitHub. Grouped
  with `d7b9a689f` in `ci.yml`.

- **`be7d35aae` (preview loading bar).** The JS progress simulator ticked `useState` every 120ms,
  rerendering the whole preview view for the length of every page load; it is replaced by one CSS
  animation keyed off `data-loading`. `useLoadingProgress.ts` is deleted. Upstream appends the CSS
  to `index.css`; Ronin split that file into `styles/*.css`, so the rules land in
  `styles/motion.css` next to the other keyframes, and the two hard-coded 150ms/220ms values are
  written as `var(--duration-fast)` / `var(--duration-base)` to match the rest of that module —
  which also means the reduced-motion token override in `tokens.css` applies on top of the explicit
  `prefers-reduced-motion` block. Upstream's new rerender test mounts the real component through
  `createRoot`, so it tripped over Ronin's `subscribeBrowserRecordingAutoStopped` effect; that
  export was added to the existing `~/browser/browserRecording` mock.

### Already in the tree (1) — do not re-port

| Upstream    | Title                                                   | Where it lives                                         |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------ |
| `e72350122` | feat(composer): list skills with slash commands (#7737) | `ChatComposer.tsx:1145`, `ComposerCommandMenu.tsx:104` |

Ronin already lists provider skills in the `/` menu, and its version is the richer one:
`composerMenuItems` filters skills the user disabled in settings, labels them with
`formatProviderSkillDisplayName` instead of a raw `skill:` prefix, and `groupCommandItems` already
files them under a dedicated **Skills** group between Built-in and Provider. `searchProviderSkills`
returns every enabled skill for an empty query, which is the behavior upstream's new
`providerSkillSearch` test asserts. The only thing upstream has that this fork does not is `/skill:`
prefix matching, which exists to serve upstream's `skill:name` label — an affordance Ronin's labels
never advertise. Porting the patch would have replaced a grouped menu with a flat one.

### Skipped (5)

| Upstream    | Title                                                                         | Why                                                                             |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `7107a98a2` | chore: vouch Seth Webster and pcstyle (#7728)                                 | upstream governance — `.github/VOUCHED.td` is that repo's contributor allowlist |
| `f0fb83aff` | fix(web): polish theme library buttons, search, and import dialog (#7580)     | visual polish on a surface this fork already restyled; see below                |
| `68966c1e6` | fix(web): add space above composer task tabs (#7740)                          | depends on the skipped composer state drawers (`792a1404f`, #7150); see below   |
| `45a2c4b2a` | Update user count in AGENTS.md (#7658)                                        | upstream's user-base figure, not a fact about this fork                         |
| `8f7da3b99` | ci: only boot the macOS native lint runner when native sources change (#7283) | gates a job this fork does not have; see below                                  |

- **`f0fb83aff`.** Every hunk is chrome. Upstream replaces the search form and its submit button
  with an `InputGroup`, swaps the license badge and text "Source" link for an icon-only button
  behind a new `SourceLinkIcon` (which is what the new `GitLabIcon` `monochrome` prop exists to
  feed), retunes the JSON textarea's selection colors, narrows the library grid from 17rem to
  16rem, and renames "Import theme" to "Add theme" with different icons. Ronin has diverged on all
  of it and has no `SourceLinkIcon`. The one behavior worth checking — searching on Enter with an
  IME guard — Ronin already gets from its `<form onSubmit>`.

- **`68966c1e6`.** The commit adds top padding when a composer shoulder tab is showing. This fork
  has no shoulder tabs: no `ComposerTasksBadge`, no `ComposerTasksDrawer`, no
  `externalDrawerAttached` prop, and `ComposerStashBadge` is defined but unrendered. All of that
  arrives with `792a1404f` (#7150), which batch 8 skipped as part of the redesign wave. Attempting
  a three-way apply reconstructed ~250 lines of that unported surface, which is the tell.

- **`8f7da3b99`.** Adds a cheap Linux gate job so the macOS runner only boots when
  `apps/mobile` native sources change. This fork removed `mobile_native_static_analysis` entirely
  when mobile was cut, so there is nothing to gate, and its `docs/internals/ci.md` hunk edits a
  bullet describing that job. `ci.md` was still updated in this batch, but for `d7b9a689f`.

### Verification

- **Typecheck, all clean:** `@t3tools/contracts`, `@t3tools/client-runtime`, `@t3tools/web`,
  `@t3tools/desktop`, `t3` (server). Four **pre-existing** suggestions survive, all recorded in
  batch 8 and untouched by this batch: `DesktopAutoUpdate.ts:175` (`runEffectInsideEffect`), and
  three `unnecessaryFailYieldableError` hits in `ClaudeAdapter.ts:4612` and `ProviderService.ts:854`
  / `:862`.

  Two sets of type errors **were** introduced by the port and fixed, both in the two test harnesses
  from `0929907ff` — see that entry above.

- **Focused tests, all pass.**
  - server: `serverRuntimeStartup.reconcile` · `http` · `CodexProvider` (18 tests);
    `orphanedProviderSessionStartup.integration` (1); `GitVcsDriverCore` (52); `server.test.ts`
    filtered to `bootstrap` (8 run, including both new cases:
    _cleans up created bootstrap threads when worktree creation defects_ and _does not report a
    deleted bootstrap thread when cleanup fails_).
  - contracts / client-runtime: `settings` · `orchestration` · `errors/orchestration` ·
    `operations/projects` (101 tests).
  - desktop: `ElectronShell` (6 tests, including the three new deep-link cases).
  - web: `Sidebar.logic` · `providerInstances` · `keybindings` · `useTerminalFocus` ·
    `markdown-links` · `composerDraftStore` (307 tests); `PreviewView` · `PreviewChromeRow` ·
    `MessagesTimeline` · `UsagePage` (30); `CommandPalette.logic` (20); `ChatMarkdown` (7);
    `terminal/ghostty/surface` · `terminal/ghostty/keyCodes` (47).

- **Two pre-existing failures, both reproduced on a clean checkout of the file before judging them:**
  - `apps/web/src/terminal/ghostty/runtimeAbi.test.ts` does not load at all — Vite fails import
    analysis on `vendor/ghostty-vt.wasm?inline` ("content contains invalid JS syntax"). It fails
    identically at `HEAD` with this batch's hunk reverted, so `21e80a063`'s new ABI case is present
    but unexercised locally. A toolchain/`assetsInclude` issue, not a port regression.
  - `MessagesTimeline.test.tsx > keeps the copy button for collapsed long user messages` fails on
    `aria-label="Copy link"`. Also reproduced at `HEAD` with both this batch's `MessagesTimeline`
    changes reverted.

- **Lint:** `vp lint --report-unused-disable-directives` over all 51 changed/added `.ts`/`.tsx`
  files — 0 findings.
- **Format:** `vp fmt --check` over all 58 changed/added files (including `motion.css`, `ci.yml`,
  and the four docs) — all correct.
- `git diff --check` clean. Nothing staged; the index was left as found.

**Hit every surface (for this batch):**

- **Contracts** — `OrchestrationDispatchCommandError.bootstrapThreadDisposition`;
  `CursorSettings.enabled` default and `defaultEnabledForDriver("cursor")`.
- **Server** — startup reconciliation of provider sessions orphaned by a restart, bootstrap-thread
  cleanup reporting through `ws.ts`, UTF-8 on HTML assets, a 300s `git worktree add` timeout, Codex
  Daybreak models out of the legacy list.
- **Desktop (Electron/IPC)** — `openExternal` now admits only genuine `vscode://vscode-remote/ssh-remote+…`
  deep links, rejecting userinfo and extension command URLs.
- **Web renderer** — sidebar (pinned reorder animation, pinned list semantics, per-environment
  provider icons, add-project cursor), chat (timeline live-edge follow, bootstrap-thread retry,
  file-link tooltips, composer control rounding, subagent row alignment), terminal (copy selection,
  shifted-character encoding, jump hints suppressed while focused), preview (CSS-driven load bar),
  usage (sparse hourly breakdown), command palette (HTTPS clone default).
- **Providers** — Cursor becomes default-enabled; the other eight adapters were checked and none
  needed a decision. Codex's current-model set gains the two Daybreak ids.
- **Reverse states** — a failed bootstrap thread gets a fresh id so the user can retry rather than
  being stranded on a deleted one; the terminal copy primer is cleared on the next keydown and on
  composition start, so it cannot swallow an IME candidate; scrolling back to the live edge releases
  the send anchor, which is the way out of the anchored-turn framing.
- **Connection modes** — `f3fcfe1f6` is a multi-environment fix specifically: instance ids are
  per-environment routing keys and default ids are driver slugs, so a flat map resolved a remote
  thread's icon from the local environment. `0929907ff` matters most where the server restarts
  underneath a still-connected client.
- **Docs** — `docs/user/install.md` (Cursor on by default), `docs/internals/ci.md` (rewritten for
  the six-job pipeline), `docs/internals/work-artifacts.md` (new, rebranded), `docs/README.md`
  (index entry), `AGENTS.md` (plans/work-artifacts section, PR-evidence bullet). No new vocabulary,
  so `docs/internals/glossary.md` is untouched.

## Batch 10 — reviewed through `035058a23` (11 commits)

Reviewed `be7d35aae..035058a23`, snapshotted at `035058a23` for the whole run. No commit needed a
product decision from the developer; every verdict fell out of what this fork already has.

### Ported (9)

| Upstream    | Title                                                                    | Notes                                                               |
| ----------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `0a46daaf6` | fix(web): keep messages clear of composer banners (#7792)                | **adapted** — import-adjacency conflict only                        |
| `837f6b871` | feat(web): double-click chat header title to rename thread (#7817)       | **adapted** — kept Ronin's `rounded-(--control-radius)`             |
| `9b5d41687` | fix(web): give sidebar un-settle button a tooltip (#7796)                | clean                                                               |
| `c3e37094e` | fix(web): render oversized terminal graphemes without crashing (#7809)   | **adapted** — `new Array(n)` trips Ronin's lint; see below          |
| `e0b4f4639` | feat(web): cmd+enter to create thread in background (#7821)              | **adapted** — three additive conflicts; docs rebranded              |
| `b381fdb12` | fix(web): launcher shortcuts no longer hijack the empty composer (#7794) | clean                                                               |
| `44e4a7071` | feat(desktop): choose external project icons (#7823)                     | **adapted** — no `ghost-muted` button variant here; see below       |
| `421088c27` | fix(search): oversized thread queries no longer crash clients (#6633)    | **adapted** — Ronin's search key carries a third element; see below |
| `592c5983c` | perf(web): dedupe terminal mouse motion reports (#7845)                  | clean                                                               |

Fork-specific decisions worth recording:

- **`c3e37094e` (oversized graphemes).** `ghosttyCellText` converts a cell's codepoints in 4,096-wide
  chunks so a base character followed by a six-figure run of combining marks cannot overflow the
  spread-argument limit inside `String.fromCodePoint`. Upstream preallocates the chunk with
  `new Array<number>(count)` and fills it by index; Ronin's oxlint config enables
  `unicorn(no-new-array)`, so the fill is written as
  `Array.from({ length: count }, (_unused, index) => …)`. Same preallocation, same three new tests,
  no warning.

- **`e0b4f4639` (Mod+Enter starts a thread in the background).** The feature ports whole —
  `composerSubmissionIntentForEnter`, the `backgroundSubmissionThreadKeys` slice in
  `composerDraftStore`, `resolveDraftHeroState` / `resolveDraftPromotionNavigationTarget` /
  `resolveBackgroundDraftWorkspaceOptions`, and the `useHandleNewThread` reuse guard that stops a
  promoted draft from being handed back out. Three conflicts, all additive adjacency:
  `ChatView.tsx` does not import `parseStandaloneComposerSlashCommand` here (Ronin routes slash
  commands through `@t3tools/shared/composerSlashCommands`), so only the new
  `ComposerSubmissionIntent` type joined that import; `composer-logic.ts` keeps Ronin's
  `ComposerSlashCommand = BuiltInComposerSlashCommand` alias rather than upstream's inline union;
  and `docs/user/composer.md` already had a **Reading width** section, so the new paragraph was
  placed above it and rebranded (`T3 Code` → `Ronin`). The "On desktop" qualifier was dropped —
  upstream uses it to exclude their mobile app, which this fork does not have — but the behavior is
  unchanged, since `composerSubmissionIntentForEnter` still returns `null` for a mobile viewport.
  Ronin's `ChatComposer` already carries the `routeKind: "server" | "draft"` prop the gate needs.

- **`44e4a7071` (external project icons).** Applies across all four layers this fork still has —
  contracts (`DesktopBridge.pickProjectFavicon`, optional so an older shell can host a newer
  renderer), desktop (`PICK_PROJECT_FAVICON_CHANNEL`, `pickFiles` gaining an explicit `multiple`
  flag so the icon picker opens single-select), server (`project-favicon-external` asset claims
  keyed on the canonical file path, and `ProjectFaviconResolver` accepting an absolute saved path
  under a new `"filesystem"` candidate scope), and web. Two adaptations. First, upstream's new
  `CommandFooterAction` uses a `ghost-muted` button variant that does not exist here; Ronin's
  variant list is `default | destructive | destructive-outline | ghost | link | outline |
secondary`, so the component was written with `variant="ghost"` plus the exact
  `text-muted-foreground … hover:text-foreground` classes Ronin's `CommandPalette` footer button
  already used — the extraction is behavior-preserving on both call sites. Second,
  `canPickExternalProjectFavicon` exists upstream to hide the native picker for WSL project paths;
  WSL is cut from this fork (only comments survive in `DesktopBackendManager.ts`), so the predicate
  is kept for its still-true general meaning — the native dialog returns a host path, so it is only
  offered when the project lives on this machine — with a doc comment saying that and the test
  renamed off "WSL project paths". The `member.environmentId === primaryEnvironmentId` guard is what
  actually carries the remote case, which matters more here than upstream.

- **`421088c27` (oversized search queries).** Ronin has the same crash: `parseThreadSearchKey` ran
  `JSON.parse` and `Schema.decodeUnknownSync`, either of which throws inside an atom body. The fix
  ports as `Schema.fromJsonString` + `Schema.decodeUnknownOption` with a `None` short-circuit — but
  Ronin's key is a **three**-element tuple, `[environmentIds, query, scope]`, where upstream's is
  two: this fork keys searches by `OrchestrationThreadSearchScope` so active and archived results do
  not collide. The schema, the destructure, and both new tests were widened accordingly, and a third
  assertion was added for an unknown scope value (`'[["env-a"],"needle","nope"]'`), which is a
  malformed-key shape upstream cannot produce.

### Already in the tree (0)

Nothing in this range was already present.

### Skipped (2)

| Upstream    | Title                                                                                     | Why                                                                  |
| ----------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `292c6dd8c` | fix(web): model picker no longer shows a double border (#7772)                            | upstream-only defect; this fork's popover chrome differs — see below |
| `035058a23` | fix(mobile): stop a directly-saved backend from hiding its T3 Connect environment (#7086) | mobile and T3 Connect are both cut surfaces                          |

- **`292c6dd8c`.** The double border is a property of upstream's popover chrome, not of the model
  picker. Upstream's `PopoverPopup` is `dropdown-glass` plus a `::before` inner hairline, and their
  `ModelPickerContent` drew a _second_ frame with its own `dropdown-glass` and
  `[clip-path:inset(0_round_var(--radius-lg))]`; the fix deletes the content's frame and lets the
  popup keep its own, rounding the viewport to `calc(var(--radius-lg)-1px)` to nest inside the 1px
  border. Ronin resolves the same overlap in the opposite direction and already has no double
  border: `PopoverPopup` carries `surface-menu`, which sets a real `border: 1px solid var(--border)`
  in `@layer components`, and the model picker's `className` zeroes it with `border-0` — a
  utilities-layer declaration, so it wins the cascade — along with `bg-transparent p-0 shadow-none`.
  The single visible frame is then drawn by the content's own `surface-menu model-picker-surface`,
  where `model-picker-surface` is a Ronin-only rule that forces an opaque `var(--popover)` fill in
  dark mode. Taking upstream's patch would delete that rule's element and reintroduce a translucent
  model picker. The one cosmetic difference left is that the content rounds to `var(--radius)` (8px)
  where every other Ronin menu rounds to `--radius-lg` (10px); the popup viewport's `rounded-lg`
  clip is the larger of the two, so nothing is cut. Aligning those radii is a deliberate design
  call, not this commit, and was left alone.

- **`035058a23`.** Every hunk is under `apps/mobile/src/features/connection/`, and the behavior is
  about a directly-saved backend shadowing its T3 Connect environment in the mobile connection list.
  This fork has no `apps/mobile` and no T3 Connect.

### Verification

- **Typecheck, all clean:** `@t3tools/contracts`, `@t3tools/client-runtime`, `@t3tools/web`,
  `@t3tools/desktop`, `t3` (server). The same four **pre-existing** suggestions from batches 8 and 9
  survive untouched: `DesktopAutoUpdate.ts:175` (`runEffectInsideEffect`), and three
  `unnecessaryFailYieldableError` hits in `ClaudeAdapter.ts:4612` and `ProviderService.ts:854` /
  `:862`. This batch introduced no type errors at any point.

- **Focused tests, 483 passing across 18 files.**
  - web: `ghostty/core` (3, new file) · `ghostty/surface` (44) · `timelineScrollAnchoring` (8) ·
    `RightPanelTabs` (17) · `lib/utils` (5) · `composer-logic` (41) · `ChatView.logic` (53) ·
    `composerDraftStore` (80) · `ProjectFaviconPickerDialog` (3, new file) · `Sidebar.logic` (112) ·
    `CommandPalette.logic` (20) · `ChatHeader` (11) · `markdown-links` (37).
  - client-runtime: `threadSearch` (7, including both new cases).
  - desktop: `ElectronDialog` (4) · `ipc/methods/window` (5) — including the two new picker cases.
  - server: `AssetAccess` (13) · `ProjectFaviconResolver` (20) — including the two new
    external-path cases.

- **Two pre-existing failures, both confirmed independent of this batch:**
  - `MessagesTimeline.test.tsx > keeps the copy button for collapsed long user messages` fails on
    `aria-label="Copy link"`. Reproduced by checking out `MessagesTimeline.tsx` and
    `timelineScrollAnchoring.ts` at `HEAD` and rerunning: identical failure. Same failure recorded
    in batch 9.
  - `.github/scripts/thread-transfer-report.test.cjs` fails to load at all — "No test suite found in
    file". Nothing in `.github/` is touched by this batch, and the error is structural.

- **Lint:** `vp lint --report-unused-disable-directives` over all 43 changed/added `.ts`/`.tsx`
  files — 0 findings. One warning appeared mid-port (`unicorn(no-new-array)` in `core.ts`) and was
  fixed rather than suppressed; see `c3e37094e` above.
- **Format:** `vp fmt --check` over all 44 changed/added files (including the two docs) — all
  correct. `ChatView.tsx` and `threadSearch.test.ts` needed one `vp fmt` pass after hand-editing.
- `git diff --check` clean. Nothing staged; the index was left as found.

**Hit every surface (for this batch):**

- **Contracts** — `DesktopBridge.pickProjectFavicon`, declared optional so an older desktop shell
  can host a newer renderer without the settings panel throwing.
- **Server** — `AssetAccess` issues and resolves a `project-favicon-external` claim bound to a
  canonical file path, so a saved icon outside the workspace is served without widening
  workspace-relative resolution; `ProjectFaviconResolver` gained a `"workspace" | "filesystem"`
  candidate scope, and only the saved-override lookup uses `"filesystem"` — `t3.json` `iconPath`,
  the well-known candidates, and HTML `<link rel=icon>` hrefs all stay workspace-bound.
- **Desktop (Electron/IPC)** — a new single-select image picker channel; `ElectronDialog.pickFiles`
  now takes `multiple` explicitly instead of always passing `multiSelections`, and the theme-file
  picker passes `multiple: true` to keep its behavior.
- **Web renderer** — chat (timeline stays at the live edge when a composer banner grows,
  double-click the header title to rename, Mod+Enter starts a draft in the background), sidebar
  (un-settle button gained a tooltip), terminal (oversized grapheme clusters render instead of
  crashing, duplicate motion reports are dropped), right panel (launcher letters no longer claim an
  empty composer), settings (project icon picker can reach outside the workspace), command palette
  (footer action extracted to `CommandFooterAction`).
- **Providers** — none of the nine adapters needed a decision; nothing in this range is
  provider-shaped.
- **Reverse states** — a failed background submission clears its pending flag and resets the local
  dispatch, so the composer is usable again rather than stranded in the hero layout; a background
  submission that cannot open a fresh composer still toasts that the task started; the chevron
  remains the explicit menu affordance so double-click-to-rename does not remove the way into the
  thread menu, and the pending menu-open is cancelled on thread change, unmount, and blur.
- **Connection modes** — the external icon picker is gated on the project living on the primary
  environment, because the native dialog returns a path on the machine running Electron; a remote
  or Tailscale-attached environment's projects keep the in-workspace picker only. `AssetAccess`
  serves the chosen file through the same capability URL, so a remote browser renders it too.
- **Entry points** — the project icon picker is reachable from Settings → Projects; the background
  submission is a composer keybinding documented under `mod+enter`, not a palette command.
- **Docs** — `docs/user/composer.md` and `docs/user/keybindings.md` both describe background
  submission (rebranded, with upstream's mobile-only qualifier dropped). No new vocabulary, so
  `docs/internals/glossary.md` is untouched.

## Batch 11 — reviewed through `2433f4c1c` (21 commits)

Reviewed `035058a23..2433f4c1c`, snapshotted at `2433f4c1c` for the whole run. Two commits needed a
product decision and were put to the developer before any code was written: the appearance contrast
control was taken (adapted), and the Codex `/feedback` upload was declined.

### Ported (16)

| Upstream    | Title                                                                                 | Notes                                                                           |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ce91284f8` | fix(web): stop marking mixed tool runs as failed (#7893)                              | **adapted** — server hunks only; the web hunk has no counterpart, see below     |
| `f34b9d31b` | fix(web): command-click spaced folder links (#6439)                                   | clean                                                                           |
| `2274444e9` | fix(chat): stop pushing follow-up messages to the top (#7897)                         | **adapted** — mobile hunks dropped; web and shared applied clean                |
| `2c4158f87` | fix(web): handle wide ordered-list marker edge cases (#7856)                          | **adapted** — the CSS hunks live in `styles/markdown.css` here, not `index.css` |
| `49c2b4471` | fix(ssh): restore user PATH for remote servers (#7213)                                | clean — matters more here, remote environments are core                         |
| `d9c1732b2` | fix(desktop): keep tailscale spawn defects from breaking advertised endpoints (#7116) | clean                                                                           |
| `dedcd99a9` | fix(web): keep Codex service tier labels readable (#4503)                             | clean                                                                           |
| `77c9d1eb5` | fix: render workspace images in chat markdown (#6433)                                 | **partial** — only the UNC hunk; the feature itself is already here, see below  |
| `6c693baec` | fix(clients): keep opening responses visible after turns settle (#7723)               | **adapted** — one test assertion keeps Ronin's row shape, see below             |
| `6e9c57f7b` | feat(web): add appearance contrast control (#7906)                                    | **adapted** — 254 CSS lines redistributed across four stylesheets, see below    |
| `4e00471d1` | fix(server): stop completed Codex threads from staying stuck on working (#7937)       | clean                                                                           |
| `4e169df1d` | fix(web): remove duplicate provider update progress (#7761)                           | clean                                                                           |
| `30be31195` | fix(server): fall back to the remote default branch instead of assuming main (#7078)  | clean                                                                           |
| `fdd1572b6` | fix(web): give sidebar project menu rows the same side padding as other menus (#7913) | clean                                                                           |
| `afa830980` | fix(clients): reconnect after credentials fail during remote server updates (#7953)   | clean                                                                           |
| `4d12e5222` | fix(server): stop kills lingering Claude work (#5891)                                 | **adapted** — `stopTask` stays on the runtime interface, see below              |

Fork-specific decisions worth recording:

- **`ce91284f8` (mixed tool runs).** The two server hunks are the substantive fix and apply clean:
  `mapItemLifecycle` now carries a Codex item's `failed`/`declined` status instead of flattening
  every `item.completed` to `completed`, and `projectActivityPayload` projects that status onto the
  payload for both the `mcp_tool_call` and generic branches. Ronin renders per-entry tool status
  through `workEntryIndicatesToolFailure` in `session-logic.ts`, so the server fix is visible here.
  The web hunk was dropped: it rewrites `hasFailure` on a `work-toggle` row that summarises a whole
  tool group, and Ronin's `work-toggle` row carries no `summary`, `summaryKind`, or `hasFailure` —
  this fork renders each work entry as its own row rather than collapsing a group behind a summary,
  so there is no group-level failure flag to correct. The new upstream test asserting the projection
  through `buildThreadFeed` (the mobile feed builder) had its mobile half removed and was renamed
  "preserves failed stored tool outcomes for the web client"; the web half, which is the assertion
  that matters here, is kept intact.

- **`77c9d1eb5` (workspace images).** The feature is **already in the tree** and was solved
  independently: `MarkdownImage` in `ChatMarkdown.tsx` routes a local image source through
  `isLocalImageSource` / `localImagePathFromSource` / `isWorkspaceImagePreviewPath` to a
  `WorkspaceMarkdownImage` backed by a signed workspace asset URL, with a `MissingMediaChip`
  placeholder, and `chatMarkdownImage.test.ts` covers it. Ronin's version additionally gates on a
  preview-supported extension, which upstream's `classifyMarkdownImageSource` does not. Nothing was
  re-ported for it, and `packages/client-runtime/src/markdownImages.ts` was deliberately not added —
  a second classifier would be a competing source of truth. What **was** taken is the one hunk in
  `markdown-links.ts` that this fork genuinely lacked: `parseFileUrlHref` dropped a file URI's
  authority, so `file://server/share/x.svg` resolved to `/share/x.svg` instead of the UNC path
  `\\server\share\x.svg`, while `file://localhost/...` correctly stays a plain local path. Both
  upstream test pairs came with it.

- **`6c693baec` (opening responses).** `deriveTurnFolds` ports whole: a settled turn now keeps its
  first assistant message visible alongside the terminal one, and the fold anchors at the first
  _hidden_ entry rather than the first entry. One assertion in the expanded-rows test had to keep
  Ronin's shape — with the same fixture upstream expects `work-toggle:work-entry-1` where this fork
  expects `work-entry-1`, because Ronin expands a fold into its individual work rows instead of a
  single toggle. A comment on that line records why the two differ.

- **`6e9c57f7b` (appearance contrast).** Upstream's diff is 190 added lines in one 2,397-line
  `index.css`; this fork's `index.css` is a 32-line import manifest, so the change was redistributed:
  - `styles/tokens.css` gets the four runtime inputs (`--appearance-contrast-base`, `-boost`,
    `-border-boost`, `-target`, with the target flipping to white under the `dark` variant), the
    fifteen `@theme inline` remaps from `var(--role)` to `var(--contrast-role)`, the derived
    `--sidebar-icon-color` now reading the adjusted sidebar role, and the whole
    `:root, [data-app-sidebar]` block that computes every `--contrast-*` value. Declaring it on
    `[data-app-sidebar]` as well as `:root` matters here because `.dark [data-app-sidebar]` in
    `themes.css` redefines `--foreground`, `--border`, and friends for the sidebar's local palette.
  - `styles/themes.css` gets the sidebar row hover/active/selected mixes and the themed chat-header
    and panel-control toolbar roles.
  - `styles/chrome.css` gets the settings-slider track. Ronin restyled that slider (2px track, no
    box-shadows), so only the two `var(--border)` reads had a counterpart; upstream's thumb-shadow
    substitutions have nothing to apply to.
  - `styles/markdown.css` gets the file-link tooltip scrollbar. Upstream inlines those scrollbar
    utilities on the element and edits them there; Ronin extracted them into
    `.markdown-file-link-tooltip-scroll`, so the four `color-mix(in srgb, var(--border) 78%, …)`
    reads were changed in the class instead and `ChatMarkdown.tsx` kept its class reference.

  At the default 100% every mix is the identity (`base` 100%, `boost` 0%), so an untouched install
  renders exactly as before. Three further adaptations: upstream's `button.tsx` hunk arrives with
  its `ghost-muted`, `glass`, and rebuilt `outline` variants, none of which exist here — only the
  `[--control-icon-color:…]` reads were switched to the contrast role. `usageProviders.ts` was left
  alone entirely: upstream restructured `PROVIDER_COLOR` into `PROVIDER_PRESENTATION` and gave Codex
  `var(--contrast-foreground)`, while Ronin keys usage colors off its own `--provider-*` brand
  tokens, which are marks rather than contrast-adjusted roles. Finally, upstream's `GlassAppearanceSync`
  and its glass-opacity settings row appear throughout the conflicts as context, because upstream has
  them and this fork does not; they were excluded as out-of-batch. That exposed a **pre-existing fork
  gap, deliberately not fixed here**: `glassOpacity` exists in `ClientSettingsSchema` but this fork
  has no settings row for it and nothing that writes `--glass-opacity` to the document, so the
  setting is inert. It is unrelated to this commit and belongs to its own change.

- **`4d12e5222` (Stop kills lingering Claude work).** The behavior ports whole: `stopSessionInternal`
  now closes the query _first_ so the SDK can escalate to SIGKILL before any cleanup that might wait
  on the provider, emits `task.completed{status:"stopped"}` for every still-live task, guards both
  the exit event and the map delete on the context still being the registered session, propagates
  the first failure out of `stopAll` and the finalizer, and bounds the context-usage read with a
  one-second timeout. `interruptTurn` becomes a hard session close, because SDK `interrupt()` can
  acknowledge while resumed background work keeps the CLI alive. The one adaptation: upstream
  deletes both `interrupt` and `stopTask` from `ClaudeQueryRuntime`, but this fork also has
  `stopAgent` — the Agents-surface control that stops one subagent while its parent turn keeps
  running — built on `stopLiveTask`, which is now the only caller of `stopTask`. So `stopTask` stays
  on the interface (with a comment saying why it survived upstream's removal) and on the test fake,
  while `interrupt` goes with the method that used it. Ronin's two `stopAgent` tests asserted
  "the parent turn was never interrupted" via `interruptCalls.length === 0`; that assertion now
  reads `closeCalls === 0`, which is the same claim against the mechanism that replaced it.

### Already in the tree (0)

Nothing in this range was wholly present, though `77c9d1eb5`'s workspace-image rendering was (see
the Ported notes above — the commit is recorded there because one of its hunks was genuinely new).

### Skipped (5)

| Upstream    | Title                                                                         | Why                                                                 |
| ----------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `11f051373` | feat(analytics): threads and turns now know which client started them (#7774) | telemetry is a cut surface; see below                               |
| `0ede2ed0d` | test(desktop): remove redundant release note assertion (#7873)                | `apps/desktop/src/updates/releaseNotes.test.ts` does not exist here |
| `5a7a7cf29` | fix(mobile): preserve markdown image dimensions (#7940)                       | no mobile app in this repo                                          |
| `3db38b881` | feat(codex): submit thread feedback to OpenAI (#7949)                         | declined by the developer; see below                                |
| `2433f4c1c` | fix(ci): let Macroscope approve pull requests again (#7970)                   | upstream governance: whether their review bot may approve their PRs |

- **`11f051373`.** The commit's whole purpose is stamping an `origin` (client surface plus app
  version) onto orchestration event metadata and auth session rows so upstream's analytics can
  attribute threads and turns. This fork has no analytics sink — batch 9 already recorded that
  `src/telemetry/AnalyticsService.ts` "does not exist here (telemetry is cut)" — so nothing would
  consume the stamp, and it also collides on migration numbering: upstream adds
  `041_AuthSessionClientConnection` while this fork's `041` is `ProviderSessionLedger` and the
  sequence already runs to `049`. **One salvage if ever wanted:** `ClientSurface` plus `appVersion`
  on `AuthClientPresentationMetadata` is the piece that would let Settings → Connections say
  "desktop 0.6.8" rather than just "desktop", which is worth more in a fork that is remote-ready by
  design than the analytics it was written for. That would be its own change, not this one.

- **`3db38b881`.** Put to the developer with the case for and against and declined: a `/feedback`
  slash command that uploads a thread transcript and Codex logs to OpenAI is a one-command path for
  a whole conversation to leave the machine, and anyone who wants it can run `/feedback` in the
  Codex CLI directly. Nothing else in the range depends on it; `provider.uploadFeedback`, the
  `ProviderUploadFeedback*` contracts, and the composer surface are all absent here.

### Verification

- **Typecheck, all clean:** `@t3tools/contracts`, `@t3tools/client-runtime`, `@t3tools/shared`,
  `@t3tools/web`, `@t3tools/desktop`, `@t3tools/ssh`, `@t3tools/tailscale`, and `t3` (server). The
  same **pre-existing** suggestions from batches 8–10 survive untouched and nothing new appeared:
  `DesktopAutoUpdate.ts:175` (`runEffectInsideEffect`) and three `unnecessaryFailYieldableError`
  hits in `ClaudeAdapter.ts` and `ProviderService.ts`. One real error was introduced mid-port and
  fixed rather than suppressed: `SettingsPanels.tsx` needed `CSSProperties` added to its type import
  once the contrast slider style landed.

- **Focused tests, 622 passing across 20 files.**
  - server: `ClaudeAdapter` (77, including this fork's two `stopAgent` cases and upstream's two new
    close-failure cases) · `CodexAdapter` (28) · `ActivityPayloadProjection` server-test (20) and
    orchestration-test · `ProviderRegistry` · `GitManager` (46) · `GitVcsDriverCore` (62) ·
    `GitWorkflowService`.
  - web: `MessagesTimeline.logic` (31) · `MessagesTimeline` · `TraitsPicker` · `ChatView.logic` ·
    `ChatMarkdown` · `markdown-links` · `appearanceContrast` (new file) · `contextMenuFallback` ·
    `ui/button` · `ProviderUpdateLaunchNotification.logic` · `settingsSearch` (10).
  - contracts: `settings` (45, including the four new contrast cases). shared: `chatList` (5).
    client-runtime: `state/server` (13). ssh: `tunnel` (13). tailscale: `tailscale` (14).
    desktop: `DesktopClientSettings` (8).

- **One pre-existing failure, re-confirmed against this batch:**
  `MessagesTimeline.test.tsx > keeps the copy button for collapsed long user messages` fails on
  `aria-label="Copy link"`. Reproduced by restoring `MessagesTimeline.tsx`, `MessagesTimeline.logic.ts`,
  and `MessagesTimeline.test.tsx` to `HEAD` and rerunning: the same test still fails. Recorded as
  pre-existing in batches 9 and 10. With this batch applied it is the only failure in that file —
  the two other failures visible at `HEAD` (`anchors a sent attachment message using its measured
height`, `hands end-following back to the list once the send anchor is released`) are the ones
  `2274444e9` fixes.

- **Lint:** `vp lint --report-unused-disable-directives` over all 58 changed/added `.ts`/`.tsx`
  files — 0 findings.
- **Format:** `vp fmt --check` over all 62 changed/added files (including the four stylesheets) —
  all correct.
- `git diff --check` clean. Nothing staged; the index was left as found.

**Hit every surface (for this batch):**

- **Contracts** — `ClientSettingsSchema` and `ClientSettingsPatch` gain `appearanceContrast`, bounded
  50–200 and defaulted to 100 through `withDecodingDefault`, so an older stored settings blob decodes
  unchanged.
- **Server** — Codex item lifecycle carries `failed`/`declined` through to activity projection;
  Codex `collabAgent/interacted` no longer re-reports a settled child as running; Claude Stop is a
  hard session boundary; base-branch resolution falls back to the remote's own default branch
  (`resolveDefaultBranchName` is now exposed on the `GitVcsDriver` interface) instead of assuming
  `main`.
- **Desktop (Electron/IPC)** — no IPC change; `DesktopClientSettings` picks up the new client
  setting through the shared contract, and its test asserts the added key.
- **Web renderer** — chat (a follow-up message returns to the live edge instead of being anchored to
  the top; a settled turn keeps its opening response visible; Codex service tiers read as their own
  label), markdown (spaced folder links resolve, command-click opens in the editor, wide and negative
  ordered-list markers get a gutter, file URIs keep their UNC authority), sidebar (project menu rows
  match other menus' side padding), settings (a Contrast slider under Appearance, searchable), and
  provider updates (one progress toast instead of two).
- **Providers** — Codex and Claude adapters both changed; the other seven needed no decision, and
  nothing in this range is shaped like a cross-provider capability.
- **Reverse states** — the contrast slider ships with its reset-to-default action and reports itself
  in the "changed from default" summary; a failed Claude process close now leaves the session
  available and `ready` rather than half-torn-down, which upstream added a test for; `stopAgent`
  still fails loudly when a task did not settle instead of reporting a stop that did not happen.
- **Connection modes** — two fixes are specifically about non-local environments: remote servers
  launched over SSH now start under a login shell (`sh -l`) so a user's PATH is present, and a
  client whose credential is rejected by a just-restarted server keeps retrying on the paced
  reconnect instead of parking in `blocked`. The Tailscale status reader no longer lets a synchronous
  spawn defect (a non-directory entry on PATH throws `ENOTDIR`) escape as an uncaught error and take
  the advertised endpoints with it.
- **Entry points** — Contrast is reachable from Settings → Appearance and from settings search; it
  is not a palette command or a keybinding.
- **Docs** — no user-facing doc changed. The contrast control is self-describing in the settings row,
  and every other port is a fix to existing documented behavior. No new vocabulary, so
  `docs/internals/glossary.md` is untouched.

---

## Batch 12 — reviewed through `b4be33f07` (12 commits)

Reviewed `2433f4c1c..b4be33f07`, snapshotted at `b4be33f07` for the whole run.

One decision went to the developer before any code was written, because it was a product call
rather than port mechanics: **`9da0fab08` (#8009) `showSkillsInSlashMenu`**. Ronin already shows
skills in the `/` menu under their own grouped **Skills** header with install-source labels, and
already has per-skill disable through `settings.skills.disabled`. Decision: **skip the setting**,
take only the behavior Ronin genuinely lacked. See _Partially ported_ below.

### Ported (8)

| Upstream    | Title                                                                        | Notes                                                                              |
| ----------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `f70eeeeb0` | fix(clients): move settled pinned threads into the settled section (#7969)   | **adapted** — mobile hunks dropped; Ronin's `needsYou` shelf kept above; board too |
| `25dcee00a` | perf(ci): speed up release builds and Windows packaging (#7975)              | **adapted** — Windows asar hunks dropped; see below                                |
| `ea8c9e5ca` | fix(web): stop tool calls from leaving a blank page in threads (#7971)       | clean — machinery is identical here                                                |
| `9da0fab08` | feat(web): redesign skills in `$` menu and in `/` menu (#8009)               | **partially ported** — native-command dedupe only; see below                       |
| `fa219001d` | perf(web): reuse work log rows during streaming (#8006)                      | **adapted** — cache keyed on the provider label map; see below                     |
| `a9cd94eb9` | fix(web): keep provider badge legible in dark themes (#7968)                 | clean                                                                              |
| `69e5ad884` | fix(web): treat configured urls with uppercase schemes as secure (#8005)     | clean                                                                              |
| `09df91f72` | fix(web): restore right panel toggle clicks after closing on desktop (#8016) | **adapted** — Ronin's raw `<header>` instead of `WorkspacePageHeader`              |

Fork-specific decisions worth recording:

- **`f70eeeeb0` (settle beats pin).** The classification loop lives inline in `Sidebar.tsx` here,
  and Ronin has a fourth shelf upstream does not: **Needs you**, which sits between snooze and the
  pin. The upstream reorder is snoozed → settled → pinned → active; Ronin's becomes snoozed →
  needsYou → settled → pinned → active, so the "blocked on the user" rule is untouched and only the
  pin/settle pair swaps. `isPinned` moves from `section === "pinned"` to `thread.pinnedAt != null`,
  and the pin marker is lifted into one `pinIndicator` that the slim row now renders too — which is
  what makes a pinned thread still readable as pinned from inside the settled and snoozed shelves.
  The three mobile files (`threadListV2.ts`, `thread-list-v2-items.tsx`, and their test) are cut
  surfaces.

  **`board.logic.ts` had to follow.** Its Done lane carried the mirrored rule in so many words
  ("same as the sidebar partition, which checks the pin first") and gated settlement on
  `thread.pinnedAt == null`. Left alone, the same finished pinned thread would read as Settled in
  the sidebar and Up Next on the board. The board is Ronin-only, so upstream had nothing to port
  here; its existing pin-beats-settle test was rewritten into a settle-beats-pin one that still
  pins the two things the pin does keep (a never-run pinned thread is a Draft, a live one still
  floats in its lane).

- **`25dcee00a` (release build perf).** Three of the four parts apply:

  - The `quality` job split is portable as-is. Ronin's `preflight` had the same shape upstream's
    did — resolve metadata, then run `vp check` / `typecheck` / `test` in front of everything — so
    lint, typecheck, and tests move into their own job that runs beside the build matrix, and
    `publish_cli` and `release` both grow a `needs: quality` gate so nothing ships on red.
  - The resource-monitor cache and its `T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR` knob apply as-is.
    Ronin's mac legs are per-arch (`arm64`, `x64`), never `universal`, so
    `resolveResourceMonitorRustTargets` returns exactly one target per matrix leg and the
    single-path cache key is correct. On a reuse hit the Rust toolchain install is skipped; the
    existence check still runs, so a missing or corrupt restore fails loudly instead of shipping an
    artifact with no monitor. `stageResourceMonitor` is now exported for the ported test.
  - The `pnpm-workspace.yaml` overrides dropping the eight `@anthropic-ai/claude-agent-sdk-*`
    platform binaries apply: Ronin's `ClaudeAdapter` passes `pathToClaudeCodeExecutable`, so the
    bundled binaries are unused here for the same reason they are upstream. Lockfile regenerated
    (8 insertions, 77 deletions) and reinstalled.
  - **Dropped:** everything about the Windows server sidecar — `resolveWindowsServerAsarIgnoreGlobs`,
    the `arch` parameter on `packWindowsServerAsar`, and the two asar tests. Ronin's
    `scripts/build-desktop-artifact.ts` has no `WINDOWS_SERVER_ASAR_IGNORE_GLOBS` and no asar
    packing path at all; that whole surface was cut long before this batch.

- **`9da0fab08` (#8009), partially ported.** Upstream is converging on a `/` menu Ronin already
  has, from the other side. Taken: **hiding a provider's native slash command when a visible skill
  carries the same name**. Ronin's `shouldHideProviderNativeSlashCommand` already models "the app
  is offering this name" against built-in commands, so the adaptation folds normalized visible-skill
  names into that same set rather than adding upstream's separate
  `getProviderSlashCommandsForSlashMenu` helper — `packages/client-runtime/src/providerSkills.ts`
  does not exist here (it arrived with `792a1404f` / #7150, skipped in batch 8), and Ronin's
  equivalents live in `apps/web/src/providerSkillPresentation.ts`.

  Dropped, all superseded by Ronin's own design: the `showSkillsInSlashMenu` setting and its
  Settings row, search entry, contract fields, and desktop fixture (developer's call, above); the
  `/skill:Name` label prefix and `SkillSourceBadge` redesign (Ronin renders a grouped **Skills**
  section with `formatProviderSkillInstallSource` and its own glyph); and the
  `scoreSlashCommandItem` skill branch (Ronin ranks skills through `searchProviderSkills`, not
  through `searchSlashCommandItems`, which only ever sees command items).

- **`fa219001d` (reuse work log rows).** The commit ports whole — private `Symbol` for the collapse
  key, `activityKind` renamed to `sourceActivityKind` so the derived entry is handed to callers
  as-is instead of being copied field-by-field, and a `WeakMap` from activity to derived row. One
  Ronin difference forced an adaptation: `deriveWorkLogEntries` and `toDerivedWorkLogEntry` take a
  second `WorkLogDerivationOptions` argument that upstream does not have, and
  `providerLabelByInstanceId` feeds `extractProviderBoundary`. A cache keyed on the activity alone
  would keep serving a stale provider label after a rename, so the cache stores the label map that
  produced the entry and re-derives when it differs. Keying on the map itself and not the options
  wrapper matters: `ChatView` rebuilds `{ providerLabelByInstanceId }` on every recompute while the
  map is `useMemo`'d on `providerStatuses`. Upstream's two tests were taken plus one for the
  rename case.

- **`09df91f72` (right panel toggle).** Same bug, same fix, different container. Ronin's pull
  requests column uses a raw `<header className="workspace-topbar drag-region …">` rather than
  upstream's `WorkspacePageHeader`, so the strip is passed down as `titlebarControls` and rendered
  as the header's first child while the panel is closed. Upstream's `className="relative
bg-background"` was dropped: `.workspace-topbar` is already `position: relative` (so the absolute
  `.workspace-titlebar-controls` anchors to the same box), and it carries `material-toolbar`, which
  `bg-background` would flatten.

### Already in the tree (0)

Nothing in this range was found already present.

### Skipped (4)

| Upstream    | Title                                                                     | Reason                                                                        |
| ----------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `55c909334` | fix(mobile): isolate markdown image requests (#7942)                      | mobile-only; `apps/mobile` is a cut surface                                   |
| `b1670ac7d` | fix(web): stop recovered tool failures from marking work logs red (#7999) | depends on the skipped collapsed tool-activity summary rows; see below        |
| `5427ca056` | fix(web): keep server update banners flush with the composer (#8000)      | depends on the skipped composer drawer surface; see below                     |
| `b4be33f07` | fix(desktop): keep release notes visible while downloading (#6412)        | `sidebar/SidebarUpdatePill.tsx` is absent and the bug does not reproduce here |

- **`b1670ac7d`.** The fix narrows `hasFailure` on the `work-toggle` row so a tool failure that a
  later retry recovered stops painting the collapsed group red. Ronin's `work-toggle` row has no
  `hasFailure` — nor `summary` or `summaryKind`. Those three fields arrived with `4a9edff4c` (#7152,
  collapse tool activity), whose visual rewrite batch 8 skipped; Ronin collapses overflow rows
  behind a plain "+N" toggle with no failure state to get wrong.

- **`5427ca056`.** A one-class fix (`before:mask-none`) on the `chat-composer-drawer-attached`
  variant of `ComposerBannerStackAlert`. Ronin's alert has no attached/floating split — it renders
  `surface-alert rounded-[var(--radius-lg)] border border-border` unconditionally — and neither
  `chat-composer-drawer-surface` nor `chat-composer-drawer-attached` exists anywhere in
  `apps/web/src`. The attached drawer arrived with the skipped composer state drawers
  (`792a1404f`, #7150).

- **`b4be33f07`.** The file it touches never existed here: batch 6 already recorded that
  `sidebar/SidebarUpdatePill.tsx` is absent because Ronin replaced upstream's desktop update state
  machine with `appUpdate.ts` + `AppUpdateProvider`. The bug is a `disabled` HTML button swallowing
  hover, which kills the tooltip carrying the release notes mid-download. Ronin's two update
  surfaces — `ServerUpdateAction.tsx` and `sidebar/SidebarProviderUpdatePill.tsx` — set `disabled`
  on nothing, so there is no tooltip to lose.

### Verification

- Focused tests: `session-logic` + `session-logic.command-output` + `ChatView.logic` +
  `MessagesTimeline` + `MessagesTimeline.logic` + `board.logic` + `primary/bootstrap` +
  `composerSlashCommands` + `Sidebar.logic` + `Sidebar.snooze` — 10 files, 408 tests, 407 pass.
  `scripts/build-desktop-artifact.test.ts` — 25 tests, all pass.
- **One pre-existing failure**, verified as such by stashing every change and re-running on the
  clean tree: `MessagesTimeline.test.tsx` › "keeps the copy button for collapsed long user messages"
  expects `aria-label="Copy link"`, which the rendered footer does not emit. Clean tree: 21 pass /
  1 fail. With this batch: 22 pass / 1 fail — the same one. Unrelated to anything here.
- Typecheck: `@t3tools/web`, `@t3tools/contracts`, `@t3tools/shared`, `@t3tools/scripts`,
  `@t3tools/desktop`, `t3` — 0 errors. (`t3` and `@t3tools/desktop` emit pre-existing Effect LSP
  _suggestions_ in `ClaudeAdapter.ts`, `ProviderService.ts`, and `DesktopAutoUpdate.ts`; none are
  errors and none are in files this batch touched.)
- `vp lint --report-unused-disable-directives` over all 18 changed `.ts`/`.tsx` files — 0 findings.
- `vp fmt --check` over all 23 changed files — all correct.
- `.github/workflows/release.yml` re-parsed after editing; job graph confirmed as
  `check_changes → preflight → {quality, build} → publish_cli → release → finalize → announce_discord`.
- `git diff --check` clean. Nothing staged; the index was left as found.

**Hit every surface (for this batch):**

- **Contracts** — comment-only: `OrchestrationThread.pinnedAt` no longer claims a pin keeps a thread
  out of every shelf. No schema change, so no decode-compatibility question.
- **Server** — untouched. Nothing in this range is a server behavior change; settle-vs-pin is a
  client classification and the decider already clears each on the other.
- **Desktop (Electron/IPC)** — no IPC change. Two entries are desktop-shaped and were checked
  against it: the pull requests toggle fix is specifically about Electron drag-region hit-testing,
  and `b4be33f07` was skipped after confirming Ronin's update surfaces do not disable their
  tooltip triggers.
- **Web renderer** — sidebar (pinned rows classify into Settled, marker follows the row, slim rows
  show it too), board (Done lane realigned to match), chat (a turn opening with tool calls no longer
  parks on a blank page; work log rows keep identity across a streaming turn; the provider badge
  reads on dark surfaces), composer (a skill and its native twin are one row), pull requests (the
  right panel toggle is clickable again after closing), and environment bootstrap.
- **Providers** — no adapter changed. The composer dedupe is provider-shaped but generic: it keys on
  reported command names against reported skill names, so every adapter that reports both gets it
  with no per-provider decision.
- **Reverse states** — the pin is not consumed by settling: the marker stays on the row, the
  `pinOrderKey` survives, and unsettling returns the thread to the pinned block at its old slot.
  The anchor release is one-directional by design and already had its way back (the scroll-to-end
  pill, plus `scrollToEnd` now clearing the positioned/settled anchor refs it used to leave behind).
- **Connection modes** — `69e5ad884` is squarely a remote-access fix: an operator who configures
  `VITE_HTTP_URL`/`VITE_WS_URL` with an uppercase scheme was being silently downgraded off TLS.
  Two tests pin both directions of the derivation.
- **Entry points** — the pin marker is reachable from every shelf that can hold a pinned thread, and
  unpinning still lives in the context menu as well. The pull requests toggle keeps its one fixed
  top-right anchor in both panel states.
- **Docs** — `docs/user/thread-sidebar.md` (pinned threads settle, and come back),
  `docs/user/slash-commands.md` (the skill/native duplicate resolves to the Skills row),
  `docs/operations/release.md` (checks run beside the builds; the new job appears in the release
  checklist). No new vocabulary, so `docs/internals/glossary.md` is untouched.

### Not tested

The sidebar shelf classification and the composer's slash-menu derivation both live inline inside
`Sidebar.tsx` and `ChatComposer.tsx` with no pure seam, so neither ported behavior has a direct unit
test. Extracting one would be a refactor beyond this sync. What is covered: the board's mirrored
Done rule (`board.logic.test.ts`), and the dedupe predicate itself
(`composerSlashCommands.test.ts`, extended with the skill-shadow case).

## Batch 13 — reviewed through `99960383d` (30 commits)

### Ported (23)

| Upstream    | Title                                                                           | Notes                                                                                              |
| ----------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `17dbe8dda` | fix(web): show only providers with usage in usage views (#7563)                 | **adapted** — time-breakdown table only; the panel and chart legend keep every provider. See below |
| `643daa516` | fix(web): prevent expanded tool calls from hiding thread content (#8052)        | clean — `@legendapp/list` patch; `apps/web` uses it, lockfile hash regenerated                     |
| `b60a2c0b9` | test(server): remove no-op live activity tests (#8056)                          | clean — both tests existed here verbatim                                                           |
| `10626c537` | fix(web): clarify terminal sidebar grouping (#7967)                             | **adapted** — Ronin's control radius and type scale on the shared button. See below                |
| `7c6163c67` | fix(codex): show app access approval prompts (#8058)                            | **adapted** — Ronin's approval panel and button design. See below                                  |
| `e9f50c3ef` | feat(web): upload image attachments before sending (#8048)                      | **adapted** — dropped the `providerUploadFeedback` RPC context. See below                          |
| `58ba55944` | fix(server): bound OpenCode skill discovery output (#7675)                      | clean — bounds Kilo's discovery too, same runtime                                                  |
| `be3da50e9` | fix(server): check out submodules in a new worktree (#7674)                     | clean                                                                                              |
| `ba30177b5` | fix(server): preserve merged PR badges after branch deletion (#6216)            | clean                                                                                              |
| `229b05df0` | fix(server): return fresh live pull request reads (#6472)                       | clean — drops the list/detail stale-while-revalidate windows, keeps the diff's                     |
| `6f5c951a4` | fix(web): compare client and server versions as semver, not strings (#7579)     | **adapted** — the mismatch hint keeps Ronin's wording                                              |
| `c0047c252` | fix(web): stop follow-ups from leaving giant blank space (#8068)                | clean — second `@legendapp/list` patch bump; final hash matches upstream's tip exactly             |
| `6a2608292` | fix(server): keep the authoritative subagent model when snapshots race (#7583)  | clean                                                                                              |
| `3fd506433` | fix(server): run the CLI on Node versions without import.meta.main (#7141)      | clean — `bin.ts` and `serviceLauncher.ts` both exist here                                          |
| `17822fab7` | fix(server): recover from provider interrupt failures (#7412)                   | **adapted** — hand-ported around Ronin's agent-stop handler. See below                             |
| `01fc7d228` | fix(server): recreate a thread's worktree before starting a turn (#7839)        | clean                                                                                              |
| `e6a109b9f` | fix(server): thread delete no longer fails on already-removed worktrees (#8076) | clean — applies after `01fc7d228`, which introduces `pruneWorktrees`                               |
| `5f1147cad` | fix(web): detect outdated nightly servers (#8124)                               | clean                                                                                              |
| `8287f2c3a` | fix(web): align usage page skeleton layout (#8111)                              | **adapted** — only the missing Breakdown block reproduces here. See below                          |
| `883e1a3cd` | fix(web): make terminal links appear clickable only when clickable (#7488)      | clean                                                                                              |
| `a09f92171` | fix(web): make Windows file links clickable in chat (#8081)                     | **adapted** — dropped the `rehypeNormalizeWindowsImageSrc` hunk, absent here. See below            |
| `a1379db81` | fix(web): sort usage models by token count (#8108)                              | **adapted** — same behavior against Ronin's extracted `ModelBreakdown`                             |
| `99960383d` | fix: open agent file links in the file viewer (#8098)                           | clean (web hunks only; the mobile module is a cut surface)                                         |

- **`17dbe8dda` (only providers with usage), scoped down on the developer's call.** Upstream drops
  idle providers from the chart series, the tooltip, the provider panel, and the time table.
  Ronin's `providerRows` carries an explicit counter-decision — "a key that gains and loses rows as
  the range changes stops being one" — because that panel doubles as the chart's legend. That
  rationale covers the panel and the legend; it does not cover the table, which with four providers
  runs seven columns wide and puts up to five `$0.00` columns between the reader and the numbers.
  So `providersWithUsage` landed in `usageProviders.ts` and only `TimeBreakdown` consumes it, taking
  the provider list as a prop and sizing its empty-state `colSpan` from it. The panel, the share
  bar, the chart series and its legend are untouched.

- **`10626c537` (terminal sidebar grouping).** The commit is really two things: extract the
  icon-swaps-to-X close button into `ui/panel-tab-close-button.tsx`, and replace the terminal
  sidebar's `Group 1` / `Group 2` headers and `└` tree glyphs with the group's split shape
  (Single / Stacked / Side by side) plus a pane count. Both port. The shared button takes Ronin's
  `rounded-(--control-radius) hover:bg-accent` rather than upstream's `rounded-sm hover:bg-muted`,
  since `RightPanelTabs` — the other caller — was already on the token. Upstream's `text-[10px]` /
  `text-[11px]` literals become Ronin's `text-3xs` / `text-2xs`. As upstream intends, the close
  action is no longer gated on `normalizedTerminalIds.length > 1`: the terminal glyph is the close
  button on hover for every row, including the last one.

- **`7c6163c67` (Codex app access approvals).** The server and contract halves apply as-is:
  `mcp-elicitation` joins `ProviderRequestKind`, `acceptAlways` joins `ProviderApprovalDecision`,
  `RequestOpenedPayload` grows `appName` and `options`, and `CodexSessionRuntime` handles
  `mcpServer/elicitation/request` with `describeMcpElicitation` / `toMcpElicitationResponse`.
  Ronin's generated `effect-codex-app-server` schemas already carry the method, so nothing had to
  be regenerated.

  Two client files needed rewriting rather than patching, because Ronin's approval UI diverged long
  ago. Upstream's `ComposerPendingApprovalActions` renders four `size="micro" variant="ghost-muted"`
  buttons and encodes emphasis in `className` strings; Ronin's renders `size="sm"` buttons with real
  variants (`ghost` / `destructive-outline` / `outline` / `default`) and different labels
  ("Cancel turn", "Approve once"). The adaptation keeps Ronin's design and makes the list
  data-driven the same way upstream does: `DEFAULT_APPROVAL_OPTIONS` holds Ronin's four labels, and
  `APPROVAL_ACTION_VARIANT` maps decision to variant so a provider-supplied list still reads with
  the right emphasis regardless of its order. `ComposerPendingApprovalPanel` keeps Ronin's
  headline-plus-`<pre>` block layout — upstream's is a single flex row of `<code>` — and the app
  name goes on the headline beside the summary, because an elicitation can arrive with no detail
  at all and upstream's placement assumes the detail element is always there.

  `ComposerPendingApprovalActions.test.tsx` did not exist here and was written from upstream's,
  minus the three assertions that pin upstream's button metrics (`h-5`, `sm:text-[11px]`,
  `not sm:h-6`). The two new panel tests were rewritten against Ronin's markup. `docs/user/providers-codex.md`
  gets the new section rebranded, without upstream's "mobile app" mention and without the
  `/feedback` section that surrounded it in the patch context — that is a separate upstream feature
  Ronin does not have.

- **`e9f50c3ef` (upload attachments before sending), ported in full on the developer's call.**
  Images now upload over HTTP through a signed, short-lived URL as soon as they are added, and the
  turn command carries stored `ChatAttachment` references instead of base64 `dataUrl`s. This is
  squarely a Ronin concern: a multi-megabyte data URL crossing the WebSocket is exactly the payload
  problem `AGENTS.md` calls out, and it is worst over Tailscale and SSH.

  Everything applied against Ronin's tree except three edges:

  - `ClientThreadTurnStartCommand.attachments` becomes `Array(Union([UploadChatAttachment,
ChatAttachment]))`, but keeps Ronin's `PROVIDER_SEND_TURN_MAX_ATTACHMENTS` and
    `PROVIDER_SEND_TURN_MAX_INPUT_CHARS` checks, which upstream's version of this struct does not
    have.
  - The patch's `rpc.ts` and `RpcAuthorization.ts` hunks carried `WsProviderUploadFeedbackRpc` and
    its scope as context. That RPC does not exist in Ronin, so only the two `attachments.*` entries
    were taken.
  - `ws.ts` gains the `cleanupFailedUploadedAttachments` tap on the dispatch failure path.
    Upstream's neighboring `recordClientCommandAnalytics(normalizedCommand)` line was dropped; that
    helper does not exist anywhere in this fork.

  Client-side, `LegacySidebar.tsx` is gone, so its `releaseComposerDraftUploads` call has no
  counterpart — `Sidebar.tsx`, `useThreadActions.ts` and `ProjectSettingsPanel.tsx` cover every way
  a draft or thread is discarded here. `ComposerPreviewAnnotationCards`' new retry affordance uses
  a raw `<button>` matching the file's existing remove button rather than upstream's `Button`,
  which this file has never imported; upstream's accompanying "uses the shared button contract for
  removal" test was left out for the same reason — it predates this commit and describes a
  divergence, not a regression.

- **`17822fab7` (recover from interrupt failures), hand-ported.** The patch's context runs straight
  through `processAgentStopRequested`, which is Ronin-only, so a three-way apply produced a
  conflict spanning both handlers in both the source and the test. `recoverInterruptFailure` was
  written into `processTurnInterruptRequested` by hand instead, with one substitution: it calls
  Ronin's existing `formatFailureDetail` (which unwraps a `ProviderAdapterRequestError` to its
  `detail`) rather than `Cause.pretty`, matching upstream's own choice and the rest of this
  reactor. The three tests were added the same way, and the harness gains upstream's
  `interruptTurnEffect` / `stopSessionEffect` knobs beside Ronin's existing ones.

- **`8287f2c3a` (usage skeleton), reduced to one hunk.** Upstream's other three parts do not
  reproduce: Ronin's skeleton and its real page already agree on the grid track (`19rem` in both,
  not upstream's mismatched `16rem`/`18rem`), and Ronin's skeleton deliberately renders real
  `ProviderMark`s and labels rather than grey placeholders, which is the same legend-stability
  decision as `providerRows`. What does reproduce is the missing Breakdown section: it is the
  tallest block on the page, and leaving it out of the skeleton makes the whole view jump when
  usage lands. Added, matching Ronin's own card and segmented-control geometry.

- **`a09f92171` (Windows file links).** Two of the three parts port: `remarkTagInlineCode` becomes
  `remarkNormalizeLinksAndTagInlineCode` and rewrites `C:\...` link and definition URLs to
  `file:///C:/...` before sanitization, and the path-normalization fixes in
  `buildFileLinkParentSuffixByPath`, `normalizeMarkdownLinkHrefKey`, and the file-link label
  lookup apply as-is. Dropped: `rehypeNormalizeWindowsImageSrc`. Ronin's `ChatMarkdown` has no
  image-src normalization pass at all, and adding one would be a new surface rather than a port.
  `WINDOWS_DRIVE_PATH_REGEX` is still hoisted, since three call sites use it.

### Already in the tree (1) — do not re-port

| Upstream    | Title                                                                  | Where it lives                                                                |
| ----------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `04df98db4` | fix(server): honor auto-accept edits for the OpenCode provider (#7100) | `opencodeRuntime.ts:430` — Ronin's own `editAction` fix, with its own comment |

Ronin already gates `edit` on `runtimeMode === "auto-accept-edits"` and already covers it in
`opencodeRuntime.cliParsers.test.ts`. Upstream's new `opencodeRuntime.permissions.test.ts` would
have been a second file asserting the same three things, so it was not taken. Its one genuinely
new case — that `"auto"` still asks, because providers without an AI reviewer fall back to
Supervised — was folded into the existing block instead.

### Skipped (6)

| Upstream    | Title                                                                         | Reason                                                                  |
| ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `9eba1252c` | fix(mobile): persist thread shelf collapse state (#5152)                      | mobile-only; `apps/mobile` is a cut surface                             |
| `2d2efff28` | fix(mobile): restore Android tablet thread controls, clean up header (#5385)  | same                                                                    |
| `f9a726e62` | fix(mobile): land the first thread open above the composer on Android (#5585) | same                                                                    |
| `e31e568bd` | fix(marketing): stop automatic Vercel deployments on pull requests (#8070)    | `apps/marketing` does not exist here                                    |
| `a00218741` | chore: vouch repeat contributors (#8071)                                      | upstream governance file                                                |
| `f035a0f4c` | fix(web): stop update notices showing through the composer (#8083)            | reverts `5427ca056`, which batch 9 skipped for the same missing surface |

- **`f035a0f4c`.** The commit deletes the `before:mask-none` class that `5427ca056` (#8000) added
  one batch earlier. Batch 9 skipped that one because Ronin's `ComposerBannerStackAlert` has no
  attached/floating split — it renders `surface-alert rounded-[var(--radius-lg)] border
border-border` unconditionally — and neither `chat-composer-drawer-surface` nor
  `chat-composer-drawer-attached` appears anywhere in `apps/web/src`. Confirmed still true. Taking
  the revert of a change that was never taken would be a no-op at best.

### Verification

- Focused tests, all green:
  - Web: the full `apps/web/src` suite — 294 files, 3038 tests, 3036 pass (two pre-existing
    failures, below).
  - Server: `server` (101), `ProviderCommandReactor` (58), `GitVcsDriverCore` + `GitManager` +
    `PullRequestService` (242), `ClaudeAdapter` + `opencodeRuntime.cliParsers` +
    `opencodeRuntime.inventory` + `OpenCodeProvider` + `entrypoint` + `ActivityPayloadProjection`
    (133), `AttachmentUpload` + `attachmentStore` + `Normalizer.attachments` + `ServerEnvironment`
    (26), `CodexAdapter` + `CodexSessionRuntime` + `ProviderRuntimeIngestion.approval` (69),
    `CodexCollabRuntime.integration` + `effect-codex-app-server` (28).
  - Contracts: the full `packages/contracts/src` suite — 21 files, 286 tests.
- **Two pre-existing failures**, both verified by stashing every change and re-running on the clean
  tree:
  - `MessagesTimeline.test.tsx` › "keeps the copy button for collapsed long user messages" expects
    `aria-label="Copy link"`, which the rendered footer does not emit. Same failure clean; carried
    over from batch 9, where it was already recorded.
  - `terminal/ghostty/runtimeAbi.test.ts` collects zero tests: Vite cannot parse
    `vendor/ghostty-vt.wasm?inline` for import analysis. A build-config gap, unrelated to this
    range; fails identically on the clean tree.
- Typecheck: `@t3tools/contracts`, `@t3tools/web`, `t3`, `@t3tools/desktop`, `@t3tools/shared`,
  `@t3tools/client-runtime` — 0 errors. (`t3` still emits the four pre-existing Effect LSP
  _suggestions_ in `ClaudeAdapter.ts` and `ProviderService.ts`; none are errors and none are in
  hunks this batch touched.)
- `vp lint --report-unused-disable-directives` over all 91 changed `.ts`/`.tsx`/`.mjs` files —
  0 findings.
- `vp fmt --check` over all 93 changed files — all correct.
- `vp install` re-run after the two `@legendapp/list` patch bumps; the regenerated
  `patch_hash=064530db8…` matches upstream's tip byte for byte.
- `git diff --check` clean. Nothing staged; the index was left as found.

**Hit every surface (for this batch):**

- **Contracts** — three additive changes, all backward-compatible on decode:
  `ProviderRequestKind` gains `mcp-elicitation`, `ProviderApprovalDecision` gains `acceptAlways`,
  and `RequestOpenedPayload` gains optional `appName` / `options`. `ExecutionEnvironmentCapabilities`
  gains optional `attachmentUploads`, absent on older servers, which is exactly what the client
  branches on. `ClientThreadTurnStartCommand.attachments` widens to a union, so an older client
  still sending inline `dataUrl`s decodes unchanged.
- **Server** — provider adapters (Codex elicitation handling, Claude subagent model buffering,
  OpenCode discovery bounds), orchestration (interrupt recovery, worktree recreation, attachment
  normalization), git/VCS (submodules, prune, tolerant remove), HTTP (the signed upload route),
  WS (two new RPCs and the failed-turn attachment cleanup), and the CLI entrypoint guard.
- **Desktop (Electron/IPC)** — no IPC change. The renderer picks up all of the web work; the
  attachment upload posts to the same origin the renderer already uses, so nothing in the shell
  needed a decision. Typechecked.
- **Web renderer** — composer (upload state, retry, send gating, app-access approvals), chat
  transcript (Windows and agent file links), terminal (link hover honesty, sidebar grouping),
  right panel (shared close button), usage (active-provider columns, model sort, skeleton), and
  version-skew banners.
- **Providers** — Codex gets the elicitation surface; Claude gets the subagent-model fix; OpenCode
  and Kilo share the bounded discovery. Grok, Cursor, Antigravity, Droid and Pi need no decision:
  the composer's approval row is driven entirely by whatever `options` an adapter reports, and an
  adapter that reports none falls back to the same four choices it had before.
- **Reverse states** — every attachment upload has a release: removing an image, stashing a draft,
  discarding a draft, deleting a thread, and removing a project all call through to
  `releaseAttachmentUpload` / `releaseComposerDraftUploads` / `releaseProjectDraftUploads`, and a
  turn that fails to dispatch has its uploads swept server-side. A failed upload is retryable in
  place rather than only removable. An environment that loses the capability mid-session releases
  its queued uploads and falls back to the inline path.
- **Connection modes** — the upload URL is relative and signed, so it works unchanged over LAN,
  Tailscale and SSH forwards, and its CORS headers are asserted from a cross-origin client in
  `server.test.ts`. The capability flag is what keeps a new client talking to an old server.
  `229b05df0` matters most remotely: a stale pull-request listing was being served for up to ten
  minutes to whoever opened the page next.
- **Entry points** — the terminal close action is reachable from the sidebar row and the context
  menu; approvals answer from both the expanded and collapsed-mobile composer; usage columns follow
  the same metric toggle everywhere on the page.
- **Docs** — `docs/user/composer.md` (images upload as you add them; retry or remove a failed one),
  `docs/user/providers-codex.md` (approving app access). No new vocabulary, so
  `docs/internals/glossary.md` is untouched.

### Not tested

- The terminal sidebar's group header (split shape and pane count) and the shared
  `PanelTabCloseButton` render inline inside `ThreadTerminalDrawer.tsx` and `RightPanelTabs.tsx`
  with no pure seam, so neither has a direct unit test. Both were typechecked and linted; the
  behavior they replace had no test either.
- The usage skeleton's new Breakdown block is markup-only and untested, matching the rest of
  `UsageSkeleton`.

## Batch 14 — reviewed through `994372ba4` (20 commits)

Reviewed `99960383d..994372ba4`, snapshotted at `994372ba4` for the whole run. Nothing needed a
product decision from the developer; every verdict fell out of what this fork already has.

The worktree carried uncommitted local work on Claude/Codex text generation and the Claude
context-window defaults (`ClaudeProvider.ts`, `ClaudeTextGeneration.*`, `CodexTextGeneration.*`).
It was preserved untouched; nothing in this range overlapped it.

### Ported (18)

| Upstream    | Title                                                                                    | Notes                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `c034f51bb` | fix(server): stop routine events from rescanning thread history (#8150)                  | clean                                                                                 |
| `2394998aa` | fix(deps): stop pnpm installs from changing the lockfile (#8163)                         | **adapted** — hand-applied; `git apply --3way` mangles this lockfile. See below       |
| `143341b0b` | feat(web): settle and restore threads with a keyboard shortcut (#8089)                   | **adapted** — folded into Ronin's `runWorkspaceCommand`. See below                    |
| `63eb0429f` | perf(desktop): cut macOS signing calls by 81% (#8093)                                    | **adapted** — the batched-`codesign` half only. See below                             |
| `3c75eb113` | feat: link pull requests to threads (#8160)                                              | **adapted** — migration renumbered to `050`; mobile and `LegacySidebar` hunks dropped |
| `bd9ed2b4b` | feat(web): safely attach HEIC photos as JPEG images (#8161)                              | **adapted** — `heic-to` added; docs rewritten in Ronin's desktop-first voice          |
| `afc834280` | fix(grok): bound cumulative tool output updates (#7279)                                  | clean                                                                                 |
| `e6d487e4f` | fix(web): delay thread shortcut hints by 200 ms (#8172)                                  | clean (import-adjacency conflict only)                                                |
| `43f723f80` | fix(server): stop probing Cursor until enabled (#8175)                                   | clean                                                                                 |
| `1a4a7596c` | docs(release): verify remote updates with database migrations (#8177)                    | clean                                                                                 |
| `1baf99195` | fix(server): keep provider CLIs available in the macOS service (#8173)                   | clean                                                                                 |
| `c7222ca4d` | feat(claude): compact old threads before they burn through usage (#8144)                 | **adapted** — `ChatView`/`ChatComposer` hand-ported. See below                        |
| `589a9d0e2` | fix(client-runtime): retry queries after connection interruption (#8117)                 | clean                                                                                 |
| `06de9e90a` | fix(server): keep previously used providers working after upgrades (#8176)               | **adapted** — Ronin-only write-failure test layer needed the new SQL dependency       |
| `5d7665396` | fix(web): thread jump hints no longer stick after a dictation paste (#8189)              | clean                                                                                 |
| `e67074f80` | fix(web): keep grouped project renames (#7831)                                           | clean                                                                                 |
| `082e6ea52` | feat(web): reveal chat file chips in the system file manager (#7140)                     | **adapted** — the CSS hunk moved to `styles/markdown.css`. See below                  |
| `994372ba4` | fix(server): push no longer writes a feature branch's commits to its base branch (#8228) | clean                                                                                 |

Fork-specific decisions worth recording:

- **`2394998aa` (lockfile churn), hand-applied.** The commit adds two `deprecated:` lines to the
  `@xmldom/xmldom@0.8.13` / `@0.9.10` package entries so `pnpm install` stops rewriting the lockfile.
  Both versions are in Ronin's lockfile too, via the same transitive path, so the same churn
  reproduces here. `git apply --3way` on `pnpm-lock.yaml` produced a 4,665-line merge mess (the
  preimage blob is upstream's whole lockfile), so the two lines were inserted directly.
  `pnpm install --lockfile-only` afterwards was a no-op, which is the proof the fix works.

- **`143341b0b` (`thread.settle` shortcut).** Upstream's handler lives inline in the `keydown`
  effect and calls `event.preventDefault()` / `stopPropagation()` itself. Ronin long ago extracted
  that dispatch into `runWorkspaceCommand(command, terminalFocusOwner): boolean`, shared with the
  command palette, where returning `true` _is_ "we consumed the event". The handler was rewritten in
  that shape: every `return;` becomes `return true;`, matching upstream's unconditional consumption
  of the shortcut. A side effect Ronin gets for free: `thread.settle` is now reachable from the
  command palette as well as the keyboard, because both go through the same function. Upstream's
  `keydown` dependency-array hunk was dropped (Ronin's array is just
  `[activeThreadId, composerRef, keybindings, runWorkspaceCommand, terminalUiState.terminalOpen]`);
  the new dependencies went on `runWorkspaceCommand`'s own array instead.

- **`63eb0429f` (macOS signing), reduced to the parts that reproduce.** Three of the four changes
  port: `MAC_FILE_EXCLUSIONS` (Ronin ships `node-pty`, so the Windows `conpty`/`win32-*` prebuilds
  are dead weight in a macOS bundle and slow signing and notarization), the custom
  `scripts/sign-macos.ts` hook wiring `@electron/osx-sign` with `batchCodesignCalls: true` — the
  actual 81% — and the mac-only `electron-osx-sign*` / `electron-notarize*` verbose DEBUG
  namespaces. Dropped: `resolveMacStageDependencies`. It splits the macOS staged dependency tree the
  way upstream splits Windows', and depends on `selectCliRuntimeExternalDependencies` and the
  Windows `server.asar` sidecar machinery, neither of which exists in Ronin's much smaller
  `build-desktop-artifact.ts`. Ronin's merged tree is the shape upstream's comment calls "Linux
  retains its existing full dependency tree", so it stays as it is.
  `@electron/osx-sign@2.7.0` is a new direct dependency of `scripts/`; the lockfile entry was
  hand-written to match upstream's byte for byte and then confirmed stable by
  `pnpm install --lockfile-only`. The new `sign-macos.test.ts` keeps upstream's assertions with its
  fixture app name and signing identity rebranded.

- **`3c75eb113` (link pull requests to threads), 39 files upstream, 33 here.** The whole feature
  ports: a `linked_pull_request_json` column on `projection_threads`, `ThreadLinkedPullRequest` on
  the thread contracts and the `thread.meta.update` command/event, the `threadPullRequestLinking`
  capability, `matchesLinkedPullRequestUrl` / `changeRequestRepositoryUrl`, the
  **Link to thread** / **Unlink from thread** entries on the chat markdown link context menu, and
  the sidebar and chat-header PR indicators reading the linked PR ahead of the branch's own.
  Three adaptations:
  - The migration is `050_ProjectionThreadLinkedPullRequest`, not upstream's `042`. Ronin is
    already at 49 migrations (upstream's 42 slot is `ProjectionThreadMessageProvider` here), so the
    file, its test, and the manifest entry were renumbered and the test's
    `runMigrations({ toMigrationInclusive })` pair moved to 49/50.
  - `apps/mobile` and `LegacySidebar.tsx` hunks dropped — both cut surfaces. So was the
    `ChatMarkdown.workspace-images.test.tsx` mock hunk: that file does not exist here.
  - `ServerEnvironment.test.ts` conflicted because upstream's new
    `threadPullRequestLinking` assertion sits next to `agentActivityPublishing` and a whole relay
    publish-capability test. Only the capability assertion was taken.
    `openPullRequestLink.ts` and its test now match upstream byte for byte.

- **`c7222ca4d` (Claude compaction), the two large web files hand-ported.** Server, contracts,
  shared, and the smaller web files applied. `ChatView.tsx` and `ChatComposer.tsx` did not:
  `git apply --3way` reconstructs upstream's preimage and 3-way merges, and those two files have
  diverged so far that the merge surfaced every Ronin-vs-upstream difference rather than this
  commit's. Both were restored to their pre-apply state and the commit's own hunks re-applied by
  hand. Substitutions:
  - Ronin has no `feedbackUploading` (that upload surface is cut), so it is not part of
    `compactDisabled`.
  - The resume-compaction banner slots after `calmSystemItems`, as upstream places it — ahead of
    Ronin's own `wokeThreadItems` and behind its `quotaResumeItems`, which keep the priority the
    batch-9 comment gives them.
  - `ContextWindowMeter.tsx` keeps Ronin's plain-`<button>` dial and `text-2xs` scale; only
    `formatContextWindowCompactionMessage`'s new `autoCompactThreshold` argument and the
    `Compact context` button were taken. The `Button` import upstream has on line 1 had to be
    re-added: the merge kept Ronin's `cn` import in that slot and dropped it.
  - `ComposerBannerStack.test.tsx`'s new case asserts `chat-composer-drawer-attached`. That class
    does not exist in this fork — batch 10 already recorded that Ronin's `ComposerBannerStackAlert`
    renders `surface-alert` unconditionally with no attached/floating split — so the assertion
    checks `surface-alert` instead, which is the same "banners share one accessible surface" claim
    against Ronin's markup.
  - Two `ClaudeAdapter.test.ts` call sites needed a `requestId`. Ronin is on
    `@anthropic-ai/claude-agent-sdk@^0.3.227`, where `OnUserDialog` and `CanUseTool` both require it
    in their options; upstream's `^0.3.170` did not.

- **`082e6ea52` (reveal file chips in the file manager).** The server, contracts, and web halves
  apply. Two adaptations: the `.macroscope/check-run-agents/ui-consistency.md` hunk is upstream
  check-run tooling this fork does not have, and the `index.css` hunk lands in
  `apps/web/src/styles/markdown.css` instead — Ronin split the monolithic `index.css` into
  `styles/*.css` long ago. Only upstream's selector widening was taken
  (`a.chat-markdown-file-link` → `.chat-markdown-file-link`, so the chip styles apply now that it
  can render as a `<button>`); Ronin's own colors and focus ring stay.
  `server.test.ts` needed the new "advertises the usable file manager and its reveal label" case
  spliced in as its own block: upstream's hunk landed on top of Ronin's
  "disconnects an active websocket when its session is revoked" test, which is Ronin-only.
  No desktop IPC decision: reveal travels over the existing `shell.openInEditor` RPC, so it works
  the same locally, over the LAN, over Tailscale, and over SSH.

### Already in the tree (0)

None.

### Skipped (2)

| Upstream    | Title                                                       | Reason                                                    |
| ----------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| `bce680926` | feat(mobile): track device models and OS versions (#8169)   | mobile-only; `apps/mobile` is a cut surface. See below    |
| `c6b8bb825` | feat(desktop): build macOS previews from a PR label (#8182) | upstream release CI; nothing here builds a `-pr.` version |

- **`bce680926`.** The commit reads as cross-cutting — it touches `ws.ts`, `packages/contracts/auth`
  and `packages/client-runtime` — but every path is gated on `clientSurface === "mobile"`.
  `appendClientConnectionParams` only sets `clientOs` / `clientOsMajorVersion` /
  `clientDeviceModel` when `clientMetadata.surface === "mobile"`, and
  `readMobileDeviceAnalyticsProps` returns `{}` for any other surface. With no mobile client to send
  them, the contract fields and the server reader would both be dead.

- **`c6b8bb825`.** Two parts. `.github/workflows/desktop-macos-preview.yml` is a pingdotgg/t3code
  workflow keyed to their PR label and signing secrets. The `build-desktop-artifact.ts` half adds
  `isDesktopPreviewVersion` to suppress the publish config for `-pr.`-suffixed versions — which only
  matters if something produces such a version. Nothing in Ronin does, so it would be machinery with
  no caller. Worth revisiting if Ronin ever adds per-PR desktop previews.

### Verification

- Focused tests, all green except one pre-existing failure:
  - Server: `orchestration` + `persistence` + `provider/acp` + `ClaudeAdapter` +
    `ProviderRegistry` + `ProviderInstanceRegistryLive` + `serverSettings` + `keybindings` +
    `bootService` + `GitVcsDriverCore` + `environment` + `externalLauncher` + `textGeneration` —
    85 files / 881 tests pass, 2 files / 7 tests skipped. Plus `server.test.ts` — 103 tests.
  - Web: the full `apps/web/src` suite — 297 files, 3,114 tests, 3,113 pass.
  - Contracts: 21 files / 297 tests. Shared: 37 files / 352 tests.
    Client-runtime: 45 files / 590 tests. Scripts: 16 files / 173 tests.
- **One pre-existing failure**, verified by stashing every change and re-running on the clean tree:
  `MessagesTimeline.test.tsx` › "keeps the copy button for collapsed long user messages" expects
  `aria-label="Copy link"`, which the rendered footer does not emit. Carried over from batches 9
  and 13, where it was already recorded.
- **One flake, not a regression.** The first full server run failed
  `ProviderRegistry.test.ts` › "re-probes when settings change the codex binaryPath". It polls a
  real spawner under `TestClock` and is load-sensitive; it passes alone, passes with its own file,
  and passed on a re-run of the identical 87-file selection. Recorded rather than "fixed".
- Typecheck: `@t3tools/contracts`, `@t3tools/shared`, `@t3tools/client-runtime`,
  `@t3tools/scripts`, `@t3tools/web`, `t3`, `@t3tools/desktop` — 0 errors. (`t3` still emits the
  four pre-existing Effect LSP _suggestions_ in `ClaudeAdapter.ts` and `ProviderService.ts`, and
  `@t3tools/desktop` the one in `DesktopAutoUpdate.ts`; none are errors, none are in hunks this
  batch touched.)
- `vp lint --report-unused-disable-directives` over all 103 changed `.ts`/`.tsx`/`.mjs`/`.css`
  files — 0 findings.
- `vp fmt --check` over the same 103 files — all correct except
  `apps/server/src/textGeneration/ClaudeTextGeneration.test.ts`, which is the developer's
  uncommitted local work and was left alone.
- `pnpm install --lockfile-only` is a no-op after the three lockfile changes
  (`@xmldom/xmldom` deprecation markers, `@electron/osx-sign@2.7.0`, `heic-to@1.5.2`).
- `git diff --check` clean.

**Hit every surface (for this batch):**

- **Contracts** — every change is additive and backward-compatible on decode:
  `ExecutionEnvironmentCapabilities` gains optional `threadPullRequestLinking`;
  `OrchestrationThread` / `OrchestrationThreadShell` / `thread.meta.update` /
  `ThreadMetaUpdatedPayload` gain optional `linkedPullRequest`; `ThreadTokenUsageSnapshot` gains
  optional `autoCompactThreshold`; `ClaudeSettings` gains `autoCompactWindow` (pattern-checked at
  both the full-schema and patch boundary); `ServerConfig` gains optional
  `shellRevealInFileManager` / `shellRevealInFileManagerKind`; `LaunchEditorInput` gains optional
  `reveal`; `ServerSettingsOperation` gains `read-provider-history`; `THREAD_KEYBINDING_COMMANDS`
  gains `thread.settle`. `CursorSettings.enabled` flips its _default_ to `false` — an explicit
  `true` in settings.json still decodes to enabled, and `06de9e90a` is the safety net for users who
  never wrote one.
- **Server** — projection pipeline (skip the full thread-shell refresh for events that cannot change
  the summary; persist and read the linked PR), decider/projector/repositories, migration 050,
  provider adapters (Claude resume-compaction dialog and `autoCompactWindow`, ACP/Grok bounded tool
  output), settings load (provider history restores Cursor/Grok/OpenCode for existing users),
  external launcher (file-manager reveal), WS config, git push refspec, and the macOS boot service's
  `PATH`.
- **Desktop (Electron/IPC)** — no IPC change. Reveal-in-file-manager goes over the same
  `shell.openInEditor` RPC the renderer already uses, so the shell needed no decision. The build
  script changes are packaging-only. Typechecked.
- **Web renderer** — composer (HEIC/HEIF conversion, `/compact` injection and the context-meter
  Compact button, the resume-compaction banner), chat transcript (link-to-thread context menu,
  reveal-in-file-manager on file chips), sidebar (linked-PR indicator, 200 ms jump-hint delay,
  dictation-paste modifier reset), settings (grouped project renames, Claude **Auto-compact after**),
  and the keyboard/palette settle command.
- **Providers** — Claude gets compaction and the resume dialog; Grok (and every other ACP provider)
  gets the bounded tool-output cap; Cursor is off by default for new installs and restored for
  anyone who used it. Codex, OpenCode, Antigravity, Droid, Kilo and Pi need no decision: the
  compaction UI is gated on `selectedProvider === "claudeAgent"`, and the PR-linking menu is driven
  by the server capability, not the provider.
- **Reverse states** — `thread.settle` is a toggle: it un-settles a settled thread. **Link to
  thread** has **Unlink from thread** on the same menu, and the unlink path no-ops unless the stored
  PR actually matches the link that was right-clicked. The resume-compaction banner has both a
  session dismissal and a permanent one, and the permanent one mirrors Claude's own
  "Don't ask again" answer in either direction. **Auto-compact after** clears back to Claude's
  default when emptied (`clearWhenEmpty: "omit"`).
- **Connection modes** — `589a9d0e2` matters most remotely: an environment query interrupted by a
  session swap now retries instead of surfacing a failure, and a query only settles as failed once
  the supervisor is genuinely `available` / `offline` / `blocked`. Reveal-in-file-manager and PR
  linking both run server-side, so they behave the same over LAN, Tailscale and SSH; both are gated
  on a capability flag so a new client against an old server simply hides them.
- **Entry points** — settle is reachable from the thread menu, the chat header, the command palette
  and now `mod+shift+s`. Compaction is reachable from the context-window meter, the resume banner,
  and `/compact`. Reveal is on the file chip's context menu alongside **Open in editor**.
- **Docs** — `docs/user/keybindings.md` (`thread.settle`), `docs/user/thread-sidebar.md` (linking a
  pull request to a thread), `docs/user/composer.md` (HEIC/HEIF), `docs/user/providers-claude.md`
  (**Auto-compact after** and compaction, rewritten in Ronin's voice — upstream's version names the
  product and splits by client), `docs/operations/release.md` (migration-bearing remote updates).
  No new vocabulary, so `docs/internals/glossary.md` is untouched.

### Not tested

- The macOS `sign` hook is wired through `createBuildConfig` and asserted there, but the batched
  `codesign` path itself only runs on a signed macOS build, which this Linux checkout cannot
  produce. `MAC_FILE_EXCLUSIONS` and the `sign` path are both covered by unit assertions.
- HEIC decoding runs through `heic-to/csp`, which needs a real browser codec. The unit tests cover
  `isHeicImageFile` detection and the ISO-BMFF dimension pre-check; the decode itself is untested
  here, matching upstream.

## Batch 15 — reviewed through `b0a028126` (4 commits)

Reviewed `994372ba4..b0a028126`, snapshotted at `b0a028126` for the whole run. Small range: three
commits are Clerk or upstream release plumbing, one is a real feature. That feature needed the one
product decision of this batch — where a fork should fetch its model manifest from — and the
developer chose Ronin's own repository.

The worktree was clean at the start of the run.

### Ported (1)

| Upstream    | Title                                                                          | Notes                                      |
| ----------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| `badae6a5c` | feat(server): fetch legacy model classification from a hosted manifest (#8227) | adapted — manifest URL points at this fork |

- **`badae6a5c` (hosted model manifest), one deliberate divergence.** The commit replaces the
  hard-coded `CURRENT_CLAUDE_MODELS` / `CURRENT_CODEX_MODELS` sets with a `ModelManifest` service
  reading `apps/server/src/provider/model-manifest.json`, refreshed at runtime over HTTP so a model
  can leave the picker's legacy section with a commit instead of a release. Ronin carried the
  identical static sets (`isLegacyClaudeModel`, `isLegacyCodexModel`) and the identical slugs, so
  the bundled JSON is byte-for-byte upstream's and the classification a user sees today does not
  change.
  - **`MODEL_MANIFEST_URL` is `raw.githubusercontent.com/0veek/Ronin/main/...`, not
    `pingdotgg/t3code`.** Ronin owns its own classification data: the bundled JSON that lands with
    each sync batch is also the live source, so upstream's model list cannot silently outrank
    Ronin's catalog if the two ever diverge, and Ronin servers do not phone home to upstream's
    repository. The module and `docs/internals/providers.md` say "this repository's `main`" rather
    than naming a repo. Until this change is on the fork's `main`, the fetch 404s and the service
    falls back to the bundled copy — the failure path the commit already handles, so classification
    is correct either way.
  - The upstream tests that asserted `isLegacyClaudeModel` / `isLegacyCodexModel` are deleted with
    their functions and replaced by `ModelManifest.test.ts`, which makes the same assertions against
    the bundled manifest. Ronin's own Codex test file keeps its skill-roots case; only the legacy
    block and its import were removed.
  - `docs/internals/glossary.md` needed placement, not rewording: upstream drops **Model manifest**
    after **Snapshot**, which in this fork is immediately followed by Ronin's **Scheduled work**
    section. The entry goes in the provider section where upstream put it, ahead of that.
  - No decision needed for the other seven drivers. Antigravity, Cursor, Droid, Grok, Kilo,
    OpenCode and Pi never set `isLegacy`, and a driver kind absent from `currentModels` is left
    unflagged — exactly their behavior before this commit.

### Already in the tree (0)

None.

### Skipped (3)

| Upstream    | Title                                                        | Reason                                                        |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `504177797` | chore(deps): bump @clerk/electron to 0.0.37 (#8240)          | Clerk is a cut surface; no `@clerk/*` dependency in this fork |
| `860caaa60` | chore(release): prepare v0.0.34                              | upstream release bookkeeping; Ronin versions independently    |
| `b0a028126` | fix(desktop): let Clerk UI receive stable auth fixes (#8248) | removes a Clerk UI pin this fork never had                    |

- **`504177797` and `b0a028126` are the same cut surface.** `grep -ri clerk` over the tree outside
  `pnpm-lock.yaml` returns nothing, and `apps/web/src/main.tsx` renders `AppRoot` directly with no
  provider wrapper — there is no `__internal_clerkUIVersion` pin to remove and no
  `@clerk/electron` to bump.
- **`860caaa60`** sets four `package.json` versions to `0.0.34`. Ronin's four are at `0.6.9` on its
  own release line.

### Considered and not changed

- The Settings copy for **provider update checks** still reads "Check installed provider CLIs for
  newer available versions", while the switch now also gates the manifest fetch. Upstream left the
  string alone and rewording it would be an out-of-scope UI divergence that conflicts on every
  future sync. Recorded here rather than silently changed.

### Verification

- Focused tests:
  - `apps/server/src/provider` + `apps/server/src/server.test.ts` — 58 files, 784 tests,
    777 pass / 6 skipped / **1 pre-existing failure**.
  - Narrower confirmation runs, all green: `ModelManifest.test.ts` + `CodexProvider.test.ts` +
    `ClaudeCapabilitiesProbe.test.ts` + `ProviderInstanceRegistryLive.test.ts` (4 files, 20 tests),
    and `ProviderRegistry.test.ts` + `ProviderService.test.ts` (2 files, 77 tests).
- **One pre-existing failure, verified.** `ProviderRegistry.test.ts` › "re-probes when settings
  change the codex binaryPath" fails in the full 58-file selection and passes when its file runs
  alone. Batch 14 recorded the same test as a load-sensitive flake. Confirmed not caused by this
  port: the entire batch was stashed and the identical selection re-run on the clean tree, which
  failed the same single test.
- Typecheck: `tsgo --noEmit` in `apps/server` — 0 errors (the four pre-existing
  `unnecessaryFailYieldableError` _suggestions_ in `ClaudeAdapter.ts` and `ProviderService.ts`
  remain; neither file is in a hunk this batch touched).
- `vp lint --report-unused-disable-directives` over the 11 changed `.ts` files — 0 findings.
- `vp fmt --check` over all 14 changed files — all correct.
- `git diff --check` and `git diff --cached --check` clean.

**Hit every surface (for this batch):**

- **Contracts** — none. `ServerProviderModel.isLegacy` already exists and is unchanged; only who
  sets it moved.
- **Server** — new `ModelManifest` service (`apps/server/src/provider/ModelManifest.ts`) plus its
  bundled data, wired into `RuntimeCoreDependenciesLive` alongside `ProviderEventLoggers`. Both
  model-producing paths on each affected driver — `initialSnapshot` and `checkProvider`, the latter
  covering probe and error fallbacks — run `applyModelManifest`, so no snapshot escapes
  classification. The disk cache lands in the state directory next to the rest of the runtime state,
  so a worktree dev server and the real install never share it.
- **Providers** — Codex and Claude are the only kinds with a `currentModels` entry; the other seven
  drivers are unflagged as before. Custom (user-defined) models are never reclassified.
- **Clients (desktop/web)** — no change. Classification is server-side and reaches every client over
  the existing snapshot, so desktop and the renderer agree by construction.
- **Connection modes** — the fetch is the server's, not the client's, so local, LAN, Tailscale and
  SSH clients all see whatever classification the server resolved. An offline server keeps its disk
  cache, then the bundle; a failed fetch never fails a provider check, and the retry floor keeps an
  offline server from paying a timeout on every probe.
- **Reverse states** — `classifyModels` clears a stale `isLegacy` as readily as it sets one, so a
  model returning to the current list leaves the legacy section on the next probe without a restart.
  Turning **provider update checks** off stops future fetches but keeps data already on disk: the
  setting is about phoning home, not about discarding what the server holds.
- **Entry points** — the legacy section of the model picker is the only surface; it reads the same
  `isLegacy` flag it always did.
- **Docs** — `docs/internals/providers.md` gains a **Model manifest** section and
  `docs/internals/glossary.md` the matching term, both phrased as "this repository's `main`". No
  `docs/user/` change: nothing a user sees behaves differently.

### Not tested

- The live fetch against `raw.githubusercontent.com` is not exercised — `ModelManifest.test.ts`
  stubs `HttpClient` for the success, malformed-payload and opt-out paths, matching upstream. The
  real URL cannot resolve until this change reaches the fork's `main`.

## Batch 16 — reviewed through `ead4ce52a` (6 commits)

Reviewed `b0a028126..ead4ce52a`, snapshotted at `ead4ce52a` for the whole run. Six commits: one
sidebar-ordering fix, two CI, one generated-schema refresh, one release bump, and one very large
Grok PR that is really five changes in a trench coat.

The worktree was clean at the start of the run.

Two product decisions were put to the developer before the Grok commit was implemented, because
Ronin's Grok integration has diverged from upstream's on both points:

- **Reasoning effort stays a spawn-line flag.** Upstream moves it to `session/set_model` with
  `_meta.reasoningEffort`. Ronin keeps `--reasoning-effort` on the spawn line and
  `sessionModelOptionsSwitch: "unsupported"`, so an effort change still restarts the session.
- **The permission-mode mapping is ported.** Ronin's arg builder hardcoded `--permission-mode
default` for everything except Full access, so Auto-accept edits and Auto prompted exactly like
  Supervised. It now maps each mode the way upstream does.

### Ported (4)

| Upstream    | Title                                                                 | Notes                                                      |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `3b86ef941` | fix(app): un-settled threads return to the top of the list (#8231)    | clean apart from the migration number and the mobile hunks |
| `a3a8cbd60` | perf(ci): cut about a minute from every release (#8250)               | partial — the two parallelised jobs are cut surfaces       |
| `f925d6394` | fix(codex): accept Codex 0.150 multi-agent events (#8346)             | verbatim; only the new test file needed a lint fix         |
| `ead4ce52a` | fix(grok): improve skills, plans, usage, and turn reliability (#8358) | heavily adapted — see below                                |

- **`3b86ef941` (un-settle returns a thread to the top), one renumber.** The whole feature ports:
  an `unsettled_at` column on `projection_threads`, optional `unsettledAt` on
  `OrchestrationThread` / `OrchestrationThreadShell`, the stamp written by the projector, the
  projection pipeline and the client-runtime thread reducer, `activeThreadAnchorTimestampMs` in
  `packages/client-runtime/src/state/threadSort.ts`, and `sortThreadsForSidebar` reading the anchor
  instead of raw creation time. Every non-mobile hunk applied with `git apply --3way` cleanly.
  - The migration is `051_ProjectionThreadsUnsettledAt`, not upstream's `043`. Ronin is already at
    50 migrations, so the file and its manifest entry were renumbered. Upstream ships no test for
    this migration and neither does Ronin.
  - `apps/mobile/src/features/threads/threadListV2*` hunks dropped — cut surface. The shared half
    of that change lives in `packages/client-runtime`, which is ported in full, so web gets the
    same ordering upstream gives both clients.
  - A thread already pinned active keeps its existing stamp, so the activity reset that clears the
    pin does not reorder the list. That rule is enforced in three places — decider-adjacent
    projector, projection pipeline, and client reducer — exactly as upstream has it.

- **`a3a8cbd60` (release CI), three hunks of five.** Ported: the `7 */3` cron minute, the
  `concurrency` block that serialises nightlies without ever cancelling a running publisher
  (`queue: max`, separate group for stable tags), and the removal of the redundant
  `vp run --filter @t3tools/web build` step — confirmed unnecessary because
  `apps/server/vite.config.ts` declares `dependsOn: ["@t3tools/web#build"]` on the `t3` build task.
  Dropped: the hunks that move `relay_public_config` and `build_wsl_node_pty` off `preflight`.
  Both jobs are cut surfaces (T3 Connect and WSL) and neither exists in this fork's
  `release.yml`. Ronin's two remaining `needs: [preflight]` jobs, `quality` and `build`, genuinely
  consume `preflight.outputs.version`, so there is nothing left to parallelise.

- **`f925d6394` (Codex 0.150 multi-agent events), verbatim.** All three files in
  `packages/effect-codex-app-server` were byte-identical to upstream's parent, so the commit
  applied as-is: the `Codex0150DefinitionSchemas` override in `scripts/generate.ts`, the
  regenerated `schema.gen.ts`, and the new `schema.test.ts`. One adaptation: `schema.test.ts`
  tripped Ronin's own `t3code(no-inline-schema-compile)` oxlint rule five times, so the
  `Schema.is(...)` calls are hoisted to module scope. The assertions are unchanged.

- **`ead4ce52a` (Grok), the large one.** Upstream's 33 files land as 30 here. What ported:
  - **Skills.** `GrokSkills.ts` and its test are new files taken verbatim: `grok inspect --json`
    reports the CLI's own catalog, including plugin skills three levels deep under
    `~/.grok/installed-plugins/` that a flat scan cannot see. `GrokDriver` now reads `cwd` off
    `ServerConfig` and threads it into `checkGrokProviderStatus`, which calls `discoverGrokSkills`
    once the version probe says the CLI is runnable. Upstream attaches `skills` to three provider
    drafts; Ronin's probe has a fourth return (the unauthenticated path), and it gets `skills` too
    — the catalog does not depend on being signed in.
  - **Plans.** `XAiAcpExtension.ts` and its test were at zero divergence, so the whole
    `x.ai/exit_plan_mode` gate applies verbatim: `isGrokPlanMarkdownPath`,
    `extractGrokPlanMarkdownFromToolCallData`, `makeXAiExitPlanModeCapturedResponse`, and the
    `rate_limit` / `error` stop reasons that now fail the pending prompt instead of resolving it.
    `GrokAdapter` grows the matching handler, `planModeActive` tracking, and
    `emitProposedPlanCompleted`, so a Grok plan lands on Ronin's proposed-plan card while it is
    still being written rather than only on exit.
  - **Turn reliability.** The whole liveness watchdog ports: `livenessSignals`,
    `beginTurnLiveness` / `clearTurnLiveness` / `recordTurnActivity`, the 10-minute idle and
    30-minute active-tool deadlines, `promptResponsesReady`, and `settleStalledTurn`. Approval and
    user-input waits pause the deadline and refresh it on resolution, so a human thinking for
    twenty minutes never trips it.
  - **Bounded tool output.** `AcpRuntimeModel.ts` was at zero divergence, so
    `boundToolCallContentEntries`, `distributeRetainedTailAcrossContent` and
    `toolCallProgressLength` apply verbatim, along with the `decideToolCallUpdateEmission` fix that
    measures `data.content` / `data.rawOutput` rather than only `detail`. This is shared ACP code:
    Cursor and Droid get it too, and their adapter suites were re-run to confirm it.
  - **Approval memory.** `selectGrokPermissionOptionId` falls back to `allow_once` when Grok omits
    `allow_always`, and the adapter remembers the approved operation in
    `sessionApprovedOperations` so **Always allow this session** works on builds that do not
    implement it natively.
  - **Usage.** `USAGE_MERGE_COMPATIBLE_SINCE = 4` in contracts and the
    `isCompatibleContractVersion` gate in `usageMerge.ts`, so an environment on an older usage
    contract keeps contributing its Claude/Codex totals instead of being dropped whole. Also the
    cost-allocation rule from `parseGrokLine`: when Grok reports the money once at the top level
    and only splits tokens per model, the remainder is now shared across the models that carry no
    ticks of their own, by token share among just those.

  Six adaptations were needed.

  - **`stableStringify` is local.** Upstream imports it from `@t3tools/shared/relaySigning`, which
    does not exist here — the relay is a cut surface. It is eleven lines and has exactly one caller,
    so it lives in `GrokAdapter.ts` next to the `isRecord` it uses, rather than becoming a new
    shared subpath export for one consumer.
  - **The permission-mode mapping folds into Ronin's arg builder, not upstream's.**
    `grokAcpSpawnArgs` returns a whole argv; Ronin's `buildGrokAcpSpawnInput` already builds a
    richer one (`--no-leader`, `--sandbox read-only`, `-m`, `--reasoning-effort`). Only the mode
    value moved, as `grokPermissionModeFor`. Full Access still gets `--always-approve` on top of
    `--permission-mode default`, because it is a flag and not a mode.
  - **Reasoning effort keeps its transport, but gains upstream's discovery hardening.** Dropped:
    `normalizeGrokReasoningEffort`, `currentGrokReasoningEffortFromSessionSetup`, the
    `currentReasoningEffort` / `requestedReasoningEffort` arguments to
    `applyGrokAcpModelSelection`, the `_meta` parameter on `AcpSessionRuntime.setSessionModel`, the
    `GrokTextGeneration` wiring, and the CLI-probe case asserting the CLI accepts the metadata.
    Kept: `isValidGrokReasoningEffortToken`, now guarding the values that reach the
    `--reasoning-effort` spawn flag, plus `supportsReasoningEffort === false` (a model with no
    effort dial gets no control, where a model that advertises nothing still falls back to Ronin's
    four static levels), the `id` fallback for `value`, `isDefault` alongside `default`, and
    per-option `description`. Upstream's `buildGrokModelCapabilities` is not introduced; Ronin's
    `grokCapabilitiesFromAdvertisedEfforts` absorbs the behaviour, and `currentValue` keeps coming
    off the advertised default via `buildSelectOptionDescriptor`.
  - **The mock ACP agent keeps Ronin's model list.** Upstream's hunk swaps it for
    `grok-build` / `grok-mock-alt` with a `reasoningEffort` meta driven by
    `T3_ACP_INITIAL_GROK_REASONING_EFFORT`. Ronin's `grok-4.6` / `grok-4.5` pair and its
    spawn-line `-m` reading are what let its tests tell a redundant `session/set_model` from a real
    one, so both stay and the unused env var was dropped. The rest of upstream's mock work — the
    plan-mode, rate-limit and hang scenarios the new tests need — is in.
  - **`makeMockGrokCli` now answers `inspect`.** Ronin's fake `grok` execs the stdio mock agent for
    anything that is not `--version`, so skill discovery was handing `inspect --json` to a process
    that never exits and two probe tests sat at 120 s. The stub now prints a catalog and exits, the
    way a real `grok inspect` does, and takes an `inspectSkills` option that two new end-to-end
    cases use. Those tests went from 242 s to 2.2 s.
  - **Two test files were reverted and hand-edited instead of merged.**
    `GrokAcpSupport.test.ts` and `GrokProvider.test.ts` have diverged far enough that `--3way`
    surfaced every Ronin-vs-upstream difference rather than this commit's. Both were restored and
    only the applicable cases added: the permission-mode mapping and
    `isValidGrokReasoningEffortToken` for the first; `supportsReasoningEffort: false`, the
    `id`-keyed effort with an unusable sibling token, and the two skill-catalog probes for the
    second. One upstream `GrokAdapter.test.ts` case asked for model `grok-build` and asserted it
    survived a usage-limit failure; it asks for `grok-4.6` here, which is what Ronin's mock agent
    advertises. The claim under test is unchanged.

### Already in the tree (0 commits, several hunks)

No commit was wholly already present, but a large share of `ead4ce52a` was:

- **Grok usage, end to end.** Ronin added it independently in `d4be33cba` and extended the same
  machinery for Antigravity in `d443c89b2`. `UsageProviderKind` already lists `grok`, the contract
  is at version 6 rather than upstream's 5, `usageScanCache` already accepts the provider (through
  a `CACHEABLE_PROVIDERS` set rather than a literal chain), `usageTranscriptReader` already takes a
  `fileName` filter and dispatches to `parseGrokLine`, `UsageService` already walks
  `~/.grok/sessions` for `updates.jsonl`, and the web `usageProviders.ts` already carries Grok's
  colour token and brand mark. Only the cost-allocation rule was missing.
- **Grok spawn-time permission modes.** Ronin already passed `runtimeMode` into
  `buildGrokAcpSpawnInput`; only the per-mode value was missing.
- **`docs/user/usage.md`** already names Grok and already says its cost is used as measured.

### Skipped (2)

| Upstream    | Title                                                            | Reason                                                             |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `33b650a5b` | feat(ci): download macOS preview DMGs without signing in (#8243) | edits `desktop-macos-preview.yml`, a workflow this fork never took |
| `d3c24a14b` | chore(release): prepare v0.0.35                                  | upstream release bookkeeping; Ronin versions independently         |

- **`33b650a5b`** is 209 added lines in `.github/workflows/desktop-macos-preview.yml`. Batch 15
  skipped `c6b8bb825`, the commit that created that workflow, because it is keyed to pingdotgg's PR
  label and signing secrets and nothing in Ronin produces a `-pr.` version. This commit only makes
  that workflow's artifacts downloadable anonymously, so it has nothing to attach to here.
- **`d3c24a14b`** sets four `package.json` versions to `0.0.35`. Ronin's four are at `0.6.9`.

### Considered and not changed

- **`GROK_HOME` means different things in the two trees.** Upstream reads `$GROK_HOME` as the
  `.grok` directory itself (`$GROK_HOME/sessions/...`), which is also what the new
  `isGrokPlanMarkdownPath` assumes. Ronin's `resolveGrokHome` in
  `apps/server/src/rateLimits/providerRateLimitSources.ts` reads it as the _parent_ and appends
  `.grok`, and both the rate-limit reader and the usage scanner already depend on that reading.
  The plan-path helper is ported verbatim, so it honours upstream's convention; the two other
  call sites keep Ronin's. Nothing regresses either way — the plan helper also matches
  `~/.grok/sessions/`, which is the layout on any machine with no `GROK_HOME` set — but the
  inconsistency is real, and reconciling it means touching rate limits, which is outside this
  sync's scope.
- **`docs/user/install.md`** gains nothing. Upstream adds a paragraph about the Grok **Reasoning**
  control; `docs/user/providers-grok.md` already documents it in more detail, and install.md is a
  setup page.

### Verification

- Focused tests:
  - `apps/server`: `src/provider` + `src/usage` + `src/orchestration` + `src/persistence` —
    118 files, 1,180 tests, 1,173 pass / 7 skipped. Plus `src/server.test.ts` — 103 tests.
    Plus `CursorAdapter` + `DroidAdapter` + `CursorProvider` (the other consumers of the shared ACP
    tool-output change) — 42 tests.
  - `apps/web`: the full `src` suite — 297 files, 3,116 tests, 3,115 pass.
  - `packages/contracts` 21 files / 297 tests, `packages/shared` 37 files / 353 tests,
    `packages/client-runtime` 45 files / 590 tests,
    `packages/effect-codex-app-server` 5 files / 21 tests. All green.
- **One pre-existing failure, verified.** `apps/web` ›
  `MessagesTimeline.test.tsx` › "keeps the copy button for collapsed long user messages" expects
  `aria-label="Copy link"`, which the rendered footer does not emit. Recorded in batches 9, 13 and
  14; nothing in this batch touches that component.
- **One flake, verified not a regression.** The first run of the 118-file server selection failed
  `ProviderRegistry.test.ts` › "re-probes when settings change the codex binaryPath", the same
  load-sensitive test batches 14 and 15 recorded. It passes alone, and a re-run of the identical
  selection with the whole batch applied passed all 1,173. The clean tree was also re-run with the
  batch stashed and passed, so the flake is not deterministic in either direction.
- Typecheck: `tsgo --noEmit` in `apps/server`, `apps/web`, `apps/desktop`, `packages/contracts`,
  `packages/shared`, `packages/client-runtime`, `packages/effect-codex-app-server` — 0 errors. The
  four pre-existing `unnecessaryFailYieldableError` _suggestions_ in `ClaudeAdapter.ts` and
  `ProviderService.ts` remain; neither file is in a hunk this batch touched.
- `vp lint --report-unused-disable-directives` over the 44 changed `.ts`/`.tsx` files — 0 findings.
- `vp fmt --check` over all 49 changed files — all correct.
- `git diff --check` and `git diff --cached --check` clean.

**Hit every surface (for this batch):**

- **Contracts** — additive and backward-compatible on decode. `OrchestrationThread` and
  `OrchestrationThreadShell` gain optional `unsettledAt`, so a payload from a pre-stamp server
  still decodes and simply sorts by creation time. `USAGE_MERGE_COMPATIBLE_SINCE` is a new
  constant, not a schema change.
- **Server** — projector, projection pipeline, projection snapshot query, thread repositories and
  migration 051 for the un-settle stamp; the Grok driver, provider probe, ACP support and adapter;
  the shared ACP runtime model and session runtime; the Grok usage parser.
- **Desktop (Electron/IPC)** — no change. The un-settle stamp travels on the existing thread
  snapshot and the Grok work is entirely server-side. Typechecked.
- **Web renderer** — `sortThreadsForSidebar` reads the new anchor, and `apps/web/src/lib/threadSort.ts`
  re-exports `activeThreadAnchorTimestampMs`. The Stats page needed no change: Grok has been a
  first-class provider there since `d4be33cba`.
- **Providers** — Grok gets skills, plans, the liveness watchdog, approval memory and the finer
  permission-mode mapping. Cursor and Droid share `AcpRuntimeModel`/`AcpSessionRuntime`, so they
  get the bounded tool output and the emission fix; both suites were re-run. Claude, Codex,
  OpenCode, Antigravity, Kilo and Pi need no decision — none of them route through the ACP session
  runtime, and skill discovery is per-driver.
- **Reverse states** — un-settling a thread stamps `unsettledAt`; settling it clears the stamp, so
  the thread returns to its creation-order slot if it is ever un-settled again. Plan mode is
  cleared on turn completion and on a fresh turn, so a later empty `exit_plan_mode` cannot
  resurrect an earlier turn's markdown. The liveness watchdog's deadline is paused by an approval
  and resumed when it resolves. **Always allow this session** is session-scoped and dies with the
  session; there is no persisted grant to revoke.
- **Connection modes** — every change is server-side or in shared client logic, so local, LAN,
  Tailscale and SSH clients see the same result. `unsettledAt` is optional on the wire, so a new
  client against an old server degrades to creation-order sorting rather than failing to decode.
- **Entry points** — un-settle is reachable from the thread menu, the chat header, the command
  palette and `mod+shift+s`; all four go through the same `thread.unsettled` event, so all four
  re-anchor. Grok skills appear in the `$` picker, and the reasoning menu in the model picker.
- **Docs** — `docs/user/thread-sidebar.md` (un-settle returns a thread to the top),
  `docs/user/providers-grok.md` (skills now come from the CLI's own catalog; a new **Permission
  modes** section covering the mapping and **Always allow this session**; the persisted-record
  caveat on usage), `docs/user/permission-modes.md` (Grok's mapping and approval memory),
  `docs/user/usage.md` (the same caveat). No new vocabulary, so `docs/internals/glossary.md` is
  untouched. No new files, so `docs/README.md` needs no index entry.

### Not tested

- **`grok inspect --json` against a real Grok Build.** `GrokSkills.test.ts` drives a stubbed
  spawner and the two new probe cases drive a shell script that prints a catalog. Whether the
  installed CLI's `skills[]` shape matches is upstream's claim, taken on trust.
- **`session/set_model` with reasoning metadata.** Deliberately not adopted, so upstream's live
  CLI-probe case for it was dropped rather than ported and skipped.
- **A `grok` binary whose `inspect` hangs.** Worth recording because it was measured rather than
  assumed: `discoverGrokSkills` wraps `spawnAndCollect` in `Effect.timeoutOption(4_000)`, and that
  timeout does **not** release a child that never exits — a scratch test against a `sleep 300`
  stub sat until vitest killed it at 120 s. This is a property of `spawnAndCollect` itself, not of
  this port: `runGrokVersionCommand` has had the identical shape since before this batch, and
  `providerSnapshot.ts` is untouched here. It was confirmed by calling `spawnAndCollect` directly
  under a 2 s `timeoutOption`, which also hung. Left alone — fixing it means changing the spawn
  helper every provider probe shares, which is outside this sync's scope.

## Batch 17 — reviewed through `b654911f8` (36 commits)

Reviewed `ead4ce52a..b654911f8`, snapshotted at `b654911f8` for the whole run. The largest batch
since batch 8, and the one with the most fork-versus-upstream friction: three of the ported commits
land on surfaces Ronin has deliberately generalised (the Providers settings panel, the OpenCode
runtime that Kilo also drives, and the `runWorkspaceCommand` keybinding path the command palette
shares).

The worktree was clean at the start of the run.

No commit needed a product decision put to the developer. The one that looked like it — upstream
moving OpenCode's version floor from a per-CLI `--version` probe to a hardcoded server health check
— was already answered by a rule this fork wrote down: `OpenCodeCompatibleCliSpec.minimumVersion` is
`null` for Kilo precisely because "measuring a fork against OpenCode's floor rejects perfectly good
installs". The health check was made spec-aware rather than hardcoded, and Ronin's existing
`KiloProvider.test.ts` case pins it.

### Ported (25)

| Upstream    | Title                                                                          | Notes                                                     |
| ----------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `230c5d4a5` | fix(server): recover stale Codex approval callbacks (#5195)                    | clean                                                     |
| `64ca3b650` | test(server): remove duplicate missing worktree test (#8252)                   | clean                                                     |
| `a6797b3b9` | fix(server): replay all un-applied events during projection bootstrap (#7538)  | clean                                                     |
| `73f8cfc02` | test: remove low-signal test files (#8397)                                     | partial — mobile file dropped, two already absent here    |
| `f6f2be32d` | test: prune trivial error and layout tests (#8400)                             | adapted — one file kept for a Ronin-only regression guard |
| `e2d4d12a8` | feat(web): split provider settings into list and editor (#8380)                | adapted — design tokens and button variants               |
| `94401d01b` | fix(codex): accept Codex 0.150 account plans (#8447)                           | adapted — `Schema.is` stays hoisted                       |
| `b0ae3f3a8` | fix(tooling): allow ignored-only staged changes (#8468)                        | clean                                                     |
| `f1e6f0c9b` | fix(web): stop showing red x summaries for ordinary tool failures (#8395)      | partial — most of it was already the shape here           |
| `2fbe31309` | fix(desktop): allow preview automation in agent-created threads (#8483)        | clean                                                     |
| `c8aba2587` | test(web): remove redundant cache key test (#8484)                             | clean                                                     |
| `5766dfbf5` | fix(release): move nightly schedule to minute 38                               | clean                                                     |
| `f276e632c` | fix(web): stabilize the provider settings editor (#8472)                       | adapted — one token in the grid header                    |
| `7068e86f7` | fix(web): open GitHub pull requests in browser when loading fails (#8507)      | adapted — Ronin's per-tab loading ghost kept              |
| `49f6241dd` | fix(codex): show sub-agent models (#8502)                                      | adapted — docs only                                       |
| `8f4913221` | feat(server): accept PDF, ZIP, and other file uploads up to 50MB (#8235)       | adapted — analytics hunk dropped                          |
| `4c51b4c9b` | feat(web): toggle thread pin from the keyboard                                 | adapted — folds into `runWorkspaceCommand`                |
| `84b9d9bc2` | fix(clients): honor project default models in new threads (#6011)              | partial — web half, mobile dropped                        |
| `48c176b3c` | feat(web): make the sidebar project filter a searchable combobox (#5931)       | adapted — Ronin's board button preserved                  |
| `a40aef4cc` | fix(server): a draft can retry its first send after a failed bootstrap (#8226) | adapted — analytics and client-origin plumbing dropped    |
| `ff1761012` | fix(desktop): stop hidden previews draining battery (#8567)                    | clean                                                     |
| `0e2905eb7` | fix(desktop): oauth popups open from the browser preview (#8435)               | adapted — Ronin's URL normalization kept                  |
| `cb49e5d72` | fix(opencode): handle child approvals, stops, and model catalogs (#8480)       | heavily adapted — see below                               |
| `0bbecfabf` | fix: make thread auto-settling opt-in (#8321)                                  | adapted — Ronin's Board migrated to the new mode          |
| `b654911f8` | fix(web): stop session activity timing test from blocking releases (#8585)     | adapted — insertion collision with a Ronin case           |

- **`a6797b3b9` (projection bootstrap replay), a one-argument fix that matters.**
  `readFromSequence` pages, and omitting its `limit` capped bootstrap replay at one page. Ronin's
  signature and its `readAll` helper were byte-identical to upstream's, so the fix applied as-is.

- **`f6f2be32d` (prune trivial tests), one file kept.** Eleven of the twelve deletions applied:
  every one of those files was identical to upstream's pre-deletion copy, and the three
  un-exported symbols (`THREAD_SIDEBAR_DEFAULT_WIDTH`, `initialConfigOption`,
  `CatalogDependencyResolutionError`) have no consumer here beyond their own module.
  `apps/web/src/components/threadSidebarWidth.test.ts` was **not** deleted: the fork added a
  Ronin-only case that reads `styles/chrome.css` and pins the sidebar wordmark's container query
  against `THREAD_SIDEBAR_MIN_WIDTH` — a real regression guard, not layout trivia. The five trivial
  cases upstream targeted were removed from it and that one kept, which is why
  `THREAD_SIDEBAR_DEFAULT_WIDTH` could still be un-exported.

- **`e2d4d12a8` + `f276e632c` (Providers becomes list + editor), a design-system translation.**
  The master-detail rewrite ports whole — `ProviderInstanceCard` gains `mode: "list" | "editor"`,
  the panel grows a bounded-height two-column grid, and the account email moves into a redacted
  **Configuration** field. Four conflict hunks, all from Ronin's own design system:
  - Raw pixel sizes map onto Ronin's tokens exactly: `text-[10px]` → `text-3xs` (`0.625rem`),
    `text-[11px]` → `text-2xs` (`0.6875rem`), `text-[13px]` → `text-sm` (`0.8125rem`). Same
    rendered size, named instead of hardcoded.
  - Ronin's `Button` has no `compact`, `icon-micro` or `ghost-muted` variant. `icon-micro` +
    `ghost-muted` becomes `icon-xs` + `ghost` with the `size-5 rounded-sm p-0` class the rest of
    this panel already uses; `compact` + `outline` becomes `xs` + `outline`.
  - `SettingsPageContainer` takes no `width` prop here, so `width="expanded"` becomes
    `className="max-w-6xl"` — the same value (`expanded` is `max-w-6xl` upstream) expressed the way
    `DiagnosticsSettings.tsx` and `KeybindingsSettings.tsx` already widen a settings page.
  - The disabled status dot becomes `bg-muted-foreground/50`, taking upstream's neutral over
    Ronin's `bg-status-attention`. That is the behavioural half of the change: a locally disabled
    provider is not an attention state. The `"Ronin"` string in `getProviderSummary` and the
    Cursor-panel visibility fix both sit outside the conflicts and survived untouched.

- **`f1e6f0c9b` (no red x for ordinary tool failures), mostly already true.** The collapsed
  group-summary hunk and the `LiveActivityContent` hunk have nothing to attach to: Ronin's
  `WorkGroupToggleTimelineRow` already renders a plain muted chevron with no `hasFailure` concept,
  and there is no `LiveActivityContent`/`toolGroupSummaryIconName` in this tree. What ported is the
  `PlainWorkEntryRow` change: `workEntrySignalsSevereFailure` (new in `session-logic.ts`) widens the
  red treatment from `runtime.error` to every `*.failed` activity kind, and warnings move from
  `text-destructive` to `text-warning` — which also settles an inconsistency here, since Ronin's
  `headingClass` was already amber for warnings while its icon wrapper was red.
  `isNoContentRuntimeWarning` applied clean.
  - Two of upstream's three new test cases were taken. The group-summary case tests a surface this
    fork does not have. The other two were rewritten around `"font-medium text-destructive"` (the
    heading class `showDestructiveRowStyle` drives) instead of upstream's blanket
    `not.toContain("text-destructive")`: Ronin's row carries a trailing red-X marker that upstream's
    does not, so the blanket assertion is false here for reasons this commit is not about.

- **`8f4913221` (50 MB file uploads), analytics excised.** `ChatFileAttachment` and the open-ended
  `ChatUnknownAttachment` member, `PROVIDER_SEND_TURN_MAX_FILE_BYTES`, the
  `fileAttachments.maxUploadBytes` capability, the signed-URL filename/mime, the attachment-path
  line for every attachment, and OpenCode's native file parts all land. The one conflict is
  upstream's `analytics.record("provider.turn.sent", ...)` block, which only had `attachmentCount`
  retargeted — dropped whole, since Ronin has no `AnalyticsService`. The web half is type plumbing
  (`isImageAttachment` guard); no file picker ships yet, so `docs/user/` needs nothing.

- **`4c51b4c9b` (keyboard pin toggle), a better home than upstream's.** Upstream adds the handler to
  the raw keydown switch. Ronin routes workspace commands through `runWorkspaceCommand`, which
  returns `boolean` and does not touch the event (the caller owns it), so `event.preventDefault()` /
  `event.stopPropagation()` were dropped and `return` became `return true`. The payoff is free:
  that function is also the command palette's way in, so `thread.pin` is reachable from the palette
  here, not only from `mod+shift+p`.

- **`48c176b3c` (searchable project filter), Ronin's second row action preserved.** The combobox
  rewrite ports whole, including `filterSidebarProjectScopeItems` and
  `reduceSidebarProjectScopeMenuState`. Ronin's rows carry an **Open board** button upstream's do
  not, and use plain `<button>` elements because `ghost-muted` does not exist here; both survive
  inside upstream's `project ? … : null` guard. `handleOpenProjectBoard` closes the popup through
  `dispatchProjectScopeMenu({ type: "open-changed", open: false })` rather than reusing upstream's
  `"project-settings-opened"` action, which would have been a lie about what happened.

- **`a40aef4cc` (draft retry after a failed bootstrap), the whole fence.** Every projector now drops
  its own rows on `thread.created` so a re-created thread id rebuilds cleanly from any per-projector
  cursor; `hasEventAfter` keeps replay from deleting attachments that belong to a later incarnation;
  `requireThreadAbsent` admits a soft-deleted id; and `ThreadDeletionReactor.drainThrough(sequence)`
  fences both the bootstrap path and a bare `thread.create` before anything can own terminals or
  provider sessions under the reused id. Dropped: `dispatchFromClient`, `clientOrigin` and
  `recordClientCommandAnalytics`, none of which exist here — the fence calls
  `orchestrationEngine.dispatch` directly.
  - Upstream's new invariant test was rewritten as `effectIt.effect` rather than this file's
    `Effect.runPromise` idiom. `oxlint-plugin-t3code`'s `no-manual-effect-runtime-in-tests` caps
    `commandInvariants.test.ts` at six manual runners as tracked debt; adding a seventh would have
    meant raising the baseline, which is the one thing that rule exists to prevent.

- **`cb49e5d72` (OpenCode child approvals, stops, and catalogs), the large one.** Upstream's 42
  files land as 36 here. The adapter work — `relatedSessionIds` parent-chain traversal, the
  request-relation retry, prompt admission, interrupted-output suppression, child request routing —
  applies essentially whole, as does the whole web half (model picker **Unavailable** rows, traits,
  `modelSelection.ts`, catalog refresh). Nine conflicts, in four groups:
  - **The version floor stays per-CLI.** Upstream replaces the CLI `--version` probe with
    `verifyOpenCodeServerVersion`, hardcoded to `MINIMUM_OPENCODE_VERSION`. Ronin's Kilo provider
    shares this exact code path through `KILO_CLI_SPEC`, whose `minimumVersion` is `null` and whose
    comment already explains why. `verifyOpenCodeServerVersion` therefore takes a `cliSpec`, names
    the CLI in its errors, and returns the reported version without a floor comparison when there is
    no floor. `KiloProvider.test.ts` › "does not judge the Kilo CLI against OpenCode's version
    floor" passes unchanged.
  - **`OpenCodeServerOwner` is CLI-spec aware.** The new lazily-started, 30-second-idle shared
    server is a real improvement and it ports; it just could not spawn `opencode` for Kilo. `make`
    and `layer` take an optional `cliSpec` and forward it to `startOpenCodeServerProcess`, and
    `KiloDriver` builds its own owner with `KILO_CLI_SPEC` exactly as `OpenCodeDriver` does.
    `makeOpenCodeTextGeneration` takes the spec too, so `makeKiloTextGeneration` keeps Kilo's
    Basic-auth username and config env var.
  - **`createOpenCodeSdkClient` moved, not rewritten.** Upstream hoists it and hardcodes
    `opencode:` as the Basic-auth user; the hoisted copy here keeps Ronin's
    `(input.cliSpec ?? OPENCODE_CLI_SPEC).serverAuthUsername`.
  - **`checkOpenCodeProviderStatus` keeps its `cliSpec` parameter** while gaining the
    `OpenCodeServerOwner` requirement, the `withServer` inventory path and the phase-aware failure
    label — which is now built from `cliSpec.displayName`, so a Kilo probe failure says "Kilo", not
    "OpenCode". `loadInventoryFromCli` is no longer called from the provider (it stays on the
    runtime shape).
  - Two test adaptations followed: `OpenCodeProvider.test.ts` strips the fork-only `cliSpec` field
    before recording SDK-client inputs (its assertions are about server auth;
    `KiloProvider.test.ts` owns spec routing), and Kilo's "reads its CLI inventory with Kilo's own
    spec" case now asserts on the SDK client the server path builds rather than on the retired
    `loadInventoryFromCli` call.
  - `docs/user/providers-opencode.md` already existed here with Ronin-specific Install / Upstream
    providers / Permission modes / Updates / Skills sections, so upstream's file-creation was merged
    in as three new sections (**Server authentication**, **Refresh the model list**, **Continue an
    existing thread**), rebranded and with the mobile paragraph dropped. `docs/README.md` keeps
    Ronin's nine-provider index line.

- **`0bbecfabf` (auto-settling opt-in), Board included.** `sidebarAutoSettleOnMerge: boolean`
  becomes `sidebarAutoSettleMode: "never" | "change-request" | "inactivity"`, defaulting to
  `"never"` — three independent toggles become one policy. Beyond upstream's files, Ronin's Board is
  a fourth caller of `effectiveSettled`: `board.logic.ts`, `useBoard.ts` and `board.logic.test.ts`
  were migrated to the mode, and the Board's pinned-thread settling case now passes
  `autoSettleMode: "inactivity"` explicitly because its assertion is about the inactivity window.
  `SettingsPanels.tsx` keeps Ronin's `AgentNotificationsRow` / `AgentSoundsRow`, which sit between
  the two rows upstream's hunk spans.

### Already in the tree (0 commits, several hunks)

No commit was wholly present, but parts of three were:

- **`f1e6f0c9b`** — the collapsed group-summary row and the live-activity icon are already neutral
  here; Ronin never had the red-x summary this commit removes.
- **`cb49e5d72`** — `writeNativeEventBestEffort` on `handleSubscribedEvent` is upstream's too, not a
  fork addition; a 3-way anchoring artifact made it look like a conflict.
- **`8f4913221`** — `docs/internals/providers.md` needed only the new **Attachment access** section;
  nothing above it had diverged.

### Skipped (11)

| Upstream    | Title                                                            | Reason                                                           |
| ----------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `348367dcc` | Fix Android adaptive launcher icon (#4332)                       | mobile app is a cut surface                                      |
| `b982847ab` | fix(mobile): keep iOS home header stable (#8467)                 | patches `react-native-screens`; no mobile app here               |
| `850e4582e` | fix(mobile): refine Git action toast glass styling (#8399)       | mobile only                                                      |
| `88be5631f` | feat(analytics): report connected client platforms (#8481)       | feeds an analytics service this fork does not have               |
| `9257bd860` | fix(web): add back button to project settings (#8168)            | Ronin's sidebar footer has no Back-button mode to add a route to |
| `018d7f277` | refactor(mobile): compile semantic themes for Uniwind (#7327)    | mobile only, including its oxlint rule and `vite.config.ts` hunk |
| `f94a0d646` | fix(desktop): Cache Runtime locally on WSL Filesystem (#5769)    | WSL is a cut surface                                             |
| `acb599d2d` | fix(mobile): show OpenCode model sources in picker (#8573)       | mobile only                                                      |
| `45c0dff8e` | fix(mobile): show file actions on Android (#8215)                | mobile only                                                      |
| `94f194816` | fix(connect): explain DPoP connection failures (#8351)           | T3 Connect, the relay and DPoP are all cut surfaces              |
| `0009aacdf` | fix(web): keep long task drawers usable on small screens (#8313) | depends on `792a1404f` (#7150), skipped in batch 8               |

- **`88be5631f`** is 27 files of client-platform telemetry with one consumer: `AnalyticsService`.
  `apps/server/src/telemetry/` does not exist here, `apps/server/src/ws.ts` reads no `clientSurface`
  / `clientOs` params, `appendClientConnectionParams` is absent from
  `packages/client-runtime/src/authorization/remote.ts`, and this fork's
  `AuthClientPresentationMetadata` carries only `label` / `deviceType` / `os`. With nothing reading
  it, porting the plumbing would mean putting more client fingerprinting on the wire for no
  consumer. The `verify-preload-bundle.mjs` CI script exists to guard the analytics preload.
- **`9257bd860`** adds a `project-settings` case so upstream's footer collapses to a single **Back**
  button on `/projects/$projectKey`. Ronin's `SidebarChromeFooter` has no such mode — the icon row
  stays up on every route and `leaveOrOpen` makes re-clicking the current page's own icon go back.
  There is no member of `SidebarFooterPage` a `project-settings` value could map to. The underlying
  complaint is also already answered here: `ProjectSettingsPage` binds Escape to
  `navigateBackWithinApp` and keeps a breadcrumb in the topbar.
- **`f94a0d646`** touches four non-`wsl/` files, but every hunk in them is WSL runtime caching.
  `docs/user/install.md` says outright that Ronin "runs natively on Windows. There is no WSL step".
- **`94f194816`** spans `infra/relay/`, `apps/server/src/auth/dpop.ts`, `packages/shared/src/dpop.ts`
  and `packages/client-runtime/src/relay/` — none of which exist here.

### Considered and not changed

- **The `MessagesTimeline` trailing failure marker stays red.** Ronin's `PlainWorkEntryRow` carries
  an `XIcon` with `text-destructive` at the end of the row, which upstream's does not have; by this
  commit's logic ("ordinary tool failures should not be red") it arguably should mute too. It is a
  Ronin design decision made after the fork, and muting it is a UI change wider than the commit
  being ported. Recorded rather than silently done.
- **`loadInventoryFromCli` is left on `OpenCodeRuntimeShape`.** `checkOpenCodeProviderStatus` no
  longer calls it, but removing it is dead-code cleanup outside this sync's scope, and Kilo's test
  double still implements it.

### Verification

- Focused tests, full suite over every changed package:
  `apps/server` + `apps/web` + `apps/desktop` + `packages/contracts` + `packages/client-runtime` +
  `packages/shared` + `packages/effect-codex-app-server` — 720 files, 8,351 tests,
  **8,340 pass / 9 skipped / 2 failures, both pre-existing** (plus one file that fails to load, also
  pre-existing).
- **Three pre-existing failures, each verified by stashing the entire batch and re-running on the
  clean tree:**
  - `apps/web` › `MessagesTimeline.test.tsx` › "keeps the copy button for collapsed long user
    messages" expects `aria-label="Copy link"`, which the footer does not emit. Recorded in batches
    9, 13, 14 and 16.
  - `apps/server` › `orchestrationEngine.integration.test.ts` › "appends checkpoint.revert.failed
    activity when revert is requested without an active session". Fails identically with the batch
    stashed.
  - `apps/web/src/terminal/ghostty/runtimeAbi.test.ts` fails to load at all — Vite cannot parse a
    `.wasm?inline` import. Also identical on the clean tree.
- **One flake, verified not a regression.** `ProviderRegistry.test.ts` › "re-probes when settings
  change the codex binaryPath" failed in one 67-file selection and passed both alone and in the
  final full run. Batches 14, 15 and 16 record the same load-sensitive test.
- Typecheck: `tsgo --noEmit` in `apps/server`, `apps/web`, `apps/desktop`, `packages/contracts`,
  `packages/shared`, `packages/client-runtime`, `packages/effect-codex-app-server` — 0 errors. The
  pre-existing `unnecessaryFailYieldableError` and `runEffectInsideEffect` _suggestions_ remain in
  files this batch did not touch.
- `vp lint --report-unused-disable-directives` over the 154 changed `.ts`/`.tsx`/`.mjs` files — 0
  findings.
- `vp fmt --check` over all 161 changed files — all correct.
- `git diff --check` and `git diff --cached --check` clean.

**Hit every surface (for this batch):**

- **Contracts** — `ChatFileAttachment` + `ChatUnknownAttachment` (open member, so a newer peer can
  introduce an attachment type without breaking older decoders), `PROVIDER_SEND_TURN_MAX_FILE_BYTES`,
  `fileAttachments` capability, `AssetResource.attachment` filename/mime,
  `DesktopPreviewAutomationStatusSchema` (tab ids longer than the public 128-char limit),
  `thread.pin` in `THREAD_KEYBINDING_COMMANDS`, and `sidebarAutoSettleMode` replacing
  `sidebarAutoSettleOnMerge`. The settings change is the only non-additive one; it ships with its
  own default and the settings decoder covers it.
- **Server** — projection bootstrap replay, the per-projector `thread.created` reset and deletion
  fence, Codex stale-approval recovery, Codex sub-agent model metadata, the attachment/upload path
  across `AttachmentUpload`, `AssetAccess`, `attachmentStore`, `http.ts` and `Normalizer`, and the
  OpenCode server owner, health gate and child-session routing.
- **Providers** — Codex (0.150 plans, sub-agent models, stale approvals), OpenCode (the whole
  `cb49e5d72` body), Kilo (rides the same runtime; its spec now reaches the server owner, the SDK
  client, the health gate and text generation), Claude/Cursor/Grok/OpenCode adapters (attachment
  handling). Antigravity, Droid and Pi need no decision — none of them take attachments through the
  changed path or share the OpenCode runtime.
- **Desktop (Electron/IPC)** — preview automation status schema, OAuth popups from the browser
  preview (with a `did-create-window` handler that denies a second-level popup), and the hidden-
  preview visibility change that stops offscreen guests repainting.
- **Web renderer** — Providers settings list/editor, the searchable project filter, the PR
  browser fallback, model picker **Unavailable** rows, the composer draft `modelSelectionExplicit`
  marker, and the Board's migration to `sidebarAutoSettleMode`.
- **Reverse states** — every new one-way door has its exit. `thread.pin` unpins as readily as it
  pins, from the same shortcut and the same palette entry. Auto-settle's `"never"` mode is reachable
  from the same Select that leaves it, and the Restore-defaults path resets mode and window
  together through `hasChangedThreadSettlingSettings`. A hidden preview becomes visible again when
  it is shown or an automation borrows it (`acquireBrowserSurfaceActivity` is refcounted, so the
  last release re-hides it rather than the first).
- **Connection modes** — the upload limit and attachment classification are the server's, so local,
  LAN, Tailscale and SSH clients all see the environment's own answer through the existing
  `fileAttachments` capability; a client against an older server simply does not offer files. The
  OpenCode server owner is per-provider-instance and server-side, so a remote environment's
  OpenCode login is the one that applies.
- **Entry points** — pinning is reachable from the thread menu, the sidebar row, `mod+shift+p` and
  the command palette, all through the same `pinThread`/`unpinThread` pair. The project filter is
  reachable from the sidebar; project settings from that filter's row action and from the board
  button beside it.
- **Docs** — `docs/user/providers-opencode.md` (server auth, catalog refresh, unavailable models),
  `docs/user/providers-codex.md` (sub-agent models), `docs/user/source-control.md` (**Open on
  GitHub** on a failed PR load), `docs/user/keybindings.md` and `docs/user/thread-sidebar.md`
  (`thread.pin`, and the single auto-settle policy), `docs/internals/providers.md` (attachment
  access, and the server-owner link). No new vocabulary, so `docs/internals/glossary.md` is
  untouched; no new doc files, so `docs/README.md` needs no index entry.

### Not tested

- **A real OpenCode or Kilo server.** The version gate, server owner and child-session routing are
  driven entirely by test doubles. That the CLIs' `global.health` payload matches
  `{ healthy: true, version }`, and that a child session's `parentID` chain resolves the way
  `isRelatedOpenCodeSession` walks it, are upstream's claims taken on trust.
- **The 50 MB upload end to end.** `AttachmentUpload.test.ts` and `http.test.ts` cover the signed
  URL, the size ceiling and the mime handling, but no client can pick a non-image file yet — the web
  half of `8f4913221` is type plumbing, as upstream's own note says.
- **The Providers list/editor in a real client.** Typecheck and the 21 settings test files pass; no
  browser pass was run, per `AGENTS.md`.

## Batch 18 — reviewed through `053affbed` (21 commits)

Reviewed `b654911f8..053affbed`, snapshotted at `053affbed` for the whole run. Two of these commits
land directly on work batch 17 had just taken: `38154388d` reverts the auto-settle mode outright,
and `5e63aea2d` reworks the Providers list/editor that batch 17 introduced. A third, `bcb855a63`,
finally ships the composer half of the file-attachment feature whose server half landed last batch.

The worktree was clean at the start of the run (batch 17 is committed as `b5b57c3eb`).

One commit needed a product decision. `c1c2d5401` publishes environment themes from a
`packages/shared/src/themePalettes.ts` that does not exist here, and the ids it needs live in a
2,200-line fork-owned web module the server cannot import. The developer chose to extract Ronin's
theme ids into a shared module rather than duplicate them server-side.

### Ported (10)

| Upstream    | Title                                                                    | Notes                                                         |
| ----------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `ac3b2adf9` | fix(web): show the configured stash shortcut (#8437)                     | adapted — new test file, Ronin's component has no drawer ref  |
| `22c311dde` | feat(web): add toggleable confirmation before unpinning a thread (#7313) | adapted — folds into `runWorkspaceCommand`                    |
| `38154388d` | fix: restore automatic thread settling defaults (#8596)                  | adapted — reverts batch 17's port, Board included             |
| `702a6ade3` | fix(codex): avoid quadratic app-server input buffering (#8605)           | verbatim                                                      |
| `c131f2892` | fix(server): stop querying Claude context usage after turns (#8610)      | adapted — one import upstream could drop and this fork cannot |
| `bcb855a63` | feat(web): attach PDFs, ZIPs, and other files to a turn (#8236)          | adapted — legacy sidebar and tasks drawer hunks dropped       |
| `d22709f75` | fix(web): pass stashShortcutLabel in the mixed-attachments stash test    | folded into the adapted test from `ac3b2adf9`                 |
| `c1c2d5401` | feat: let an environment publish themes as a file (#8569)                | heavily adapted — see below                                   |
| `5e63aea2d` | fix(web): clean up provider settings list and editor (#8504)             | adapted — Ronin's design tokens re-applied                    |
| `074bcd6dc` | fix(web): keep project picker popup inside the sidebar (#8627)           | verbatim                                                      |

- **`c131f2892` (stop querying Claude context usage), one import this fork still needs.** The
  commit is a real fix — `getContextUsage`'s token-count fallback can issue extra model requests
  after every turn, so the adapter now tracks the latest assistant frame's usage instead. It also
  deletes `import * as Option from "effect/Option"`, because removing `queryCurrentContextUsage`
  left upstream's `ClaudeAdapter.ts` with no `Option` consumer. This fork has one:
  `stopLiveTask`, which backs the Ronin-only per-subagent stop control on the Agents surface and
  uses `Option.isNone` on its acknowledgement. Applied verbatim, the import removal made
  `stopAgent` throw a `ReferenceError` that `Effect.catchCause` swallowed into "Claude did not stop
  task", so the failure surfaced as a wrong-looking product error rather than a crash. The import is
  kept with a comment saying why.

- **`38154388d` (restore automatic settling defaults), a revert of a batch 17 port.** Upstream
  reversed `0bbecfabf` in full: `sidebarAutoSettleMode` goes back to `sidebarAutoSettleOnMerge:
boolean`, `changeRequestAutoSettles` returns to settling on unknown timestamps, and the exclusive
  policy Select goes back to two switches. Everything batch 17 recorded for that commit is undone
  here, including the Board migration: `board.logic.ts`, `useBoard.ts` and `board.logic.test.ts`
  return to `autoSettleOnMerge`, and the pinned-thread lane case drops the explicit
  `autoSettleMode: "inactivity"` it needed while the mode existed. `SettingsPanels.tsx` keeps
  Ronin's `AgentNotificationsRow` / `AgentSoundsRow`, which sit between the two rows the hunk spans.

- **`bcb855a63` (attach PDFs, ZIPs and other files), the composer half.** Batch 17 took the server
  side of #8235 and recorded that no client could pick a non-image file yet; this is that client.
  The whole staging pipeline ports: `composerAttachmentFiles.ts` (classification, capability gating,
  size limits), `packages/client-runtime/src/state/attachments.ts`, the upload queue and state, the
  paperclip control, file rows in the timeline, and files in the prompt stash. Three adaptations:
  - **`LegacySidebar.tsx` dropped.** It is a cut surface; the hunk only threads the new
    `releaseProjectDraftUploads` thread list, and `Sidebar.tsx` gets the same change.
  - **`ComposerTasksBadge` imports and the two inline badges dropped.** They belong to the composer
    state drawers (`792a1404f`, #7150), skipped in batch 8. Ronin renders its own
    `ComposerStashBadge` higher in the tree, so only `inlineTasksBadge` / `inlineStashBadge` went.
  - **`isHeicImageFile` moved rather than lost.** Ronin's HEIC/HEIF-to-JPEG conversion used to be
    detected in `ChatComposer.tsx`; the new `composerAttachmentFiles.ts` imports the same helper
    from this fork's `lib/imageCompression`, so the behaviour survives and the composer's import is
    now genuinely unused. Lint caught it, and it was removed only after confirming the classifier
    still calls it.
  - `docs/user/composer.md` merges upstream's new copy into Ronin's existing sections: "Image
    attachments" becomes "Attachments", a "Prompt stash" section is added, the mobile sentence is
    dropped, and the stash shortcut is documented as `mod+s` — Ronin's actual default for
    `composer.stash`, not upstream's `Cmd+S` prose.

- **`ac3b2adf9` + `d22709f75` (configured stash shortcut).** The old copy hardcoded `⌘S`, which was
  wrong on every rebind and on Windows and Linux. `ComposerStashMenu` is Ronin-authored (it came
  from this fork's workspace-shell redesign, not from upstream) and had no test file, so upstream's
  test changes could not apply. A focused `ComposerStashMenu.test.tsx` was written for the two cases
  the commit is about — the label is shown when bound, and nothing is advertised when it is not.
  Upstream's older thumbnail test was not adopted: it asserts classes from its own diverged
  component. `d22709f75` is a same-day fix for the required prop and is folded into that test.

- **`22c311dde` (unpin confirmation), same shape as batch 17's pin shortcut.** `confirmThreadUnpin`
  defaults off; the confirmation covers the sidebar controls, the thread menus and the shortcut.
  In `ChatView.tsx` the handler again folds into `runWorkspaceCommand`, which returns a boolean and
  does not own the event, so upstream's `event.preventDefault()` / bare `return` become `return
true` and `confirmAndUnpinThread` replaces `unpinThread` in that callback's deps.

- **`c1c2d5401` (environment themes), the decided one.** An environment publishes theme JSON under
  `themes/` in its state directory; the server watches the directory and streams the set over
  `subscribeServerConfig`, clients render each as a library card, and `t3 theme set <id>` names the
  environment's default. It is a good fit for a remote-ready fork: a remote client follows the
  machine it is connected to.
  - **Ronin's theme ids moved to `packages/shared/src/themePalettes.ts`.** Upstream's server and CLI
    import `UNPUBLISHABLE_THEME_IDS` / `BUILT_IN_THEME_IDS` from a shared module this fork does not
    have; Ronin's equivalent `RESERVED_THEME_IDS` lived in `apps/web/src/themePalette.ts`, which the
    server cannot import. The ids (not the palettes) now live in shared and the web module imports
    them, so the CLI, the publish path and the client library cannot drift. The new set was checked
    against `HEAD`'s: 34 ids, identical, nothing added or dropped.
  - **`BUILT_IN_THEME_IDS` is the eight themes this fork ships, not every reserved id.** The first
    cut listed all 34, which made `t3 theme list` offer ids that resolve to nothing. Ronin's
    `BUILT_IN_THEME_DEFINITIONS` has Paper, Tsukimi, Graphite, Aizome, Urushi, Obsidian, Carbon and
    OLED Void; the rest (`t3-chat`, `grove`, `ocean`, `ember`, `iris`, `midnight`, `nebula` and the
    other OLED variants, plus the `t3-*` aliases) are reserved-but-retired — held so a published or
    custom theme cannot capture a client whose stored preference still names one. They are
    `RETIRED_THEME_IDS`, and `RESERVED_THEME_IDS` is the union. Upstream's `useEnvironmentThemeSync`
    test caught this by selecting `ocean` and getting `system` back.
  - Upstream's palette exports (`BUILT_IN_THEMES`, `T3_CHAT_THEME`, `THEME_COLOR_ROLES`, the theme
    types) are not imported: those live in this fork's own `themePalette.ts`. Its `singleAppearanceOf`
    test uses `PAPER_THEME` in place of `T3_CHAT_THEME` — any built-in that ships both halves proves
    the pair case. The CLI tests move off `ocean` to `graphite` for the same reason, and the
    "rejects the mobile default theme id" case becomes "rejects a theme id this build does not
    ship", which is the property that actually holds here.
  - `apps/server/src/bin.ts` registers `themeCommand` only; upstream's hunk also adds `triageCommand`
    (already here) and the T3 Connect commands (a cut surface). `__root.tsx` gains
    `<EnvironmentThemeSync />` inside Ronin's own provider tree, without upstream's relay and connect
    onboarding hosts.
  - `docs/internals/glossary.md` needed renumbering: upstream's new section cites `[25]` and `[26]`,
    which this fork already uses for other targets, so they became `[48]` and `[49]`.

- **`5e63aea2d` (clean up provider settings), tokens re-applied.** Real behaviour, not just layout:
  a failed probe's message now shows in both the list row and the editor, the account email moves
  from a Configuration field back into the editor header status line, and `readOnly` is scoped so
  the email reveal stays clickable. Upstream's structure was taken wholesale and batch 17's
  substitutions re-applied on top — `text-[10px]/[11px]/[13px]` → `text-3xs/2xs/sm`,
  `icon-micro` + `ghost-muted` → `icon-xs` + `ghost` with the fork's class list. Upstream itself
  dropped `width="expanded"` in this commit, so the panel is back at the readable width and needs no
  `max-w-6xl`. The Ronin-only instanceId `<code>` line, the Cursor-panel visibility fix and the
  "Ronin" string in `getProviderSummary` all survive.

### Already in the tree (0)

None.

### Skipped (11)

| Upstream    | Title                                                                    | Reason                                                              |
| ----------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `e89800895` | fix(mobile): show composer menus when starting a task (#8587)            | mobile only, including its `docs/user/composer.md` paragraph        |
| `8fc7f2294` | fix(mobile): restore composer glass and rounded shadows (#8597)          | mobile only                                                         |
| `ac3a33191` | Remove Messages Glass Lab experiment (#8599)                             | deletes `experiments/`, a directory this fork never took            |
| `3251b7548` | chore(release): prepare v0.0.36                                          | upstream release bookkeeping; Ronin versions independently          |
| `2bc9e8ef6` | Require human review for pull requests changing product defaults (#8603) | edits `.macroscope/approvability.md`, which this fork does not have |
| `4669eab8e` | fix(mobile): stabilize iOS header item transitions (#8607)               | mobile only; its new doc is `docs/internals/mobile-navigation.md`   |
| `3e6ab36f6` | chore(mobile): upgrade to Expo SDK 57 (#8609)                            | mobile only                                                         |
| `38dcd7a40` | fix(mobile): harden native header toolbar items (#8611)                  | mobile only, a `react-native-screens` patch                         |
| `6a9d9f988` | chore: vouch ryanrhughes (#8613)                                         | upstream governance — that repo's contributor allowlist             |
| `be218ac76` | feat(web): keybinding settings as settings rows (#8532)                  | presentational rewrite of a page this fork already redesigned       |
| `053affbed` | fix(mobile): prevent header overflow and back-button artifacts (#8624)   | mobile only                                                         |

- **`2bc9e8ef6`** appends a rule to `.macroscope/approvability.md`. This fork has `.macroscope/`
  but only `check-run-agents/` inside it — the approvability file was never taken, so there is
  nothing to append to.
- **`6a9d9f988`** adds a GitHub handle to `.github/VOUCHED.td`. That file exists here and is wired
  to `pr-vouch.yml`, but it is Ronin's own 39-entry trust list, not upstream's. Batches 1, 2, 8 and
  13 skipped the same kind of commit for the same reason.
- **`be218ac76`** rewrites `KeybindingsSettings.tsx` (+550/-314) from a custom grid into
  `SettingsRow`s. No behaviour changes, and this fork already redesigned that page in
  `7f7f1e7cb`: a tooltipped command label, an inline **Edit** affordance, `text-3xs` tokens, and
  its own grid. Adopting upstream's layout would overwrite those choices for nothing. The one
  functional detail in the diff — deduping repeated shortcut parts so a literal `+` renders — is
  already handled better here by `keybindingDisplayParts` in `KeybindingsSettings.logic.ts`, whose
  tests cover `"mod++"` → `["mod", "+"]` and `"mod+shift++"`. Upstream's inline `seenParts` map
  produces `["mod", "", ""]` for the same input.

### Considered and not changed

- **The `ProviderRegistry` "re-probes when settings change the codex binaryPath" flake was
  misdiagnosed once and is recorded here so the next batch does not repeat it.** It failed a single
  run after `702a6ade3` landed, and a one-shot bisect appeared to pin it on that commit's removal of
  an empty-line guard at stream end. Running each variant five times showed both pass 5/5:
  `handleLine` already returns `Effect.void` for a blank line, so the guard was never load-bearing.
  `protocol.ts` is byte-identical to upstream's, with no fork divergence carried for a phantom fix.
  The test remains the load-sensitive flake batches 14 through 17 recorded.

### Verification

- Focused tests, full suite over every changed package:
  `apps/server` + `apps/web` + `apps/desktop` + `packages/contracts` + `packages/client-runtime` +
  `packages/shared` + `packages/effect-codex-app-server` — 729 files, 8,168 tests,
  **8,156 pass / 9 skipped / 3 failures and 1 unloadable file, all four pre-existing.**
- **Four pre-existing failures**, unchanged from batch 17, which verified each by stashing the
  batch and re-running on the clean tree:
  - `apps/web` › `MessagesTimeline.test.tsx` › "keeps the copy button for collapsed long user
    messages" (recorded in batches 9, 13, 14, 16, 17).
  - `apps/server` › `orchestrationEngine.integration.test.ts` › "appends checkpoint.revert.failed
    activity when revert is requested without an active session". Re-confirmed on the clean tree
    this batch.
  - `apps/web/src/terminal/ghostty/runtimeAbi.test.ts` fails to load — Vite cannot parse a
    `.wasm?inline` import.
  - `ProviderRegistry.test.ts` › "re-probes when settings change the codex binaryPath", the
    load-sensitive flake. Passes 8/8 when run alone this batch.
- Typecheck: `tsgo --noEmit` in all seven packages — 0 errors.
- `vp lint --report-unused-disable-directives` over the 84 changed `.ts`/`.tsx` files — 0 findings.
  Two were fixed rather than accepted: the stale `isHeicImageFile` import, and
  `no-inline-schema-compile` on upstream's new `rpc.test.ts`, whose decoder is now hoisted.
- `vp fmt --check` over all 89 changed files — all correct.
- `git diff --check` and `git diff --cached --check` clean.

**Hit every surface (for this batch):**

- **Contracts** — `confirmThreadUnpin` (defaulted off), the `sidebarAutoSettleMode` →
  `sidebarAutoSettleOnMerge` revert, `ChatFileAttachment` staging types, and the environment-theme
  additions to `server.ts`, `rpc.ts`, `environment.ts` and `settings.ts`. The
  `subscribeServerConfig` payload field is optional on both ends, and `rpc.test.ts` pins that an
  old server's empty-struct schema still accepts a client that sends it.
- **Server** — the environment theme watcher and its `t3 theme` CLI, the Codex app-server
  line-buffering fix, and the Claude post-turn usage change.
- **Providers** — Claude (post-turn context usage) and Codex (app-server input buffering). No other
  driver is touched; OpenCode, Cursor, Grok, Antigravity, Droid, Kilo and Pi need no decision here.
- **Desktop (Electron/IPC)** — no code change; `DesktopClientSettings.test.ts` follows the two
  settings-contract changes. Typechecked.
- **Web renderer** — file attachments end to end (picker, staging, upload state, timeline rows,
  stash), the unpin confirmation, the settling revert including the Board, the Providers
  list/editor cleanup, the stash shortcut label, and the project picker popup containment.
- **Reverse states** — every addition has its exit. Unpin confirmation is a setting that turns off,
  and declining it leaves the thread pinned. A failed or pending file upload can be retried or
  removed, and a draft that outlives its upload shows **Attach again** rather than silently
  dropping the file. `t3 theme clear` undoes `t3 theme set` without changing what clients already
  have, and a published theme that stops being published makes its card disappear with clients
  falling back to the stock look.
- **Connection modes** — environment themes are explicitly per-environment: a remote client follows
  the machine it is anchored to, not the device it runs on, and the theme set streams over the
  existing `subscribeServerConfig` subscription. File attachments upload to the environment that
  will run the turn, so a remote thread's files land where the agent can read them; the capability
  is advertised per environment, so a client against an older server simply does not offer files.
- **Entry points** — unpinning is guarded from the sidebar row, the thread menus and `mod+shift+p`,
  all through the same `confirmAndUnpinThread`. Files are attachable from the paperclip, drag and
  paste. The environment theme is reachable from `t3 theme` on the server and from the theme
  library in Settings.
- **Docs** — `docs/user/composer.md` (attachments and the prompt stash), `docs/user/thread-sidebar.md`
  (unpin confirmation, and the settling revert), `docs/user/environment-theme.md` (new, indexed in
  `docs/README.md`), and `docs/internals/glossary.md` (**Appearance** with **Environment theme** and
  **Default theme**).

### Not tested

- **A real published theme from a real desktop.** `environmentTheme.test.ts` and `theme.test.ts`
  drive a temp directory; that a desktop rewrites its theme file when the system theme changes is
  upstream's claim, taken on trust.
- **A real file upload over a remote connection.** The staging, queue and capability gating are
  covered by unit tests against fakes; no end-to-end upload to a live environment was run.
- **The reworked Providers list/editor and the new composer controls in a real client.** Typecheck
  and the focused suites pass; no browser pass was run, per `AGENTS.md`.

## Batch 19 — reviewed through `c0e09f323` (5 commits)

Reviewed `053affbed..c0e09f323`, snapshotted at `c0e09f323` for the whole run. A small batch: five
commits, all from one upstream day. The worktree was clean at the start of the run (batch 18 is
committed as `b17d45b76`).

### Ported (4, two of them partial)

| Upstream    | Title                                                             | Notes                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fc262f1a2` | fix(server): retry automatic thread title generation (#8087)      | verbatim — retry `times: 2`, exponential from 2s, plus the retry test                                                                                                 |
| `ebb9b9fda` | fix(client-runtime): refresh edited pull request comments (#8094) | verbatim — `activity` hoisted, `updateComment` gets `onSuccess` refresh; upstream's new `pullRequests.test.ts` taken whole, every import it needs already exists here |
| `72c44a847` | perf(desktop): skip duplicate browser updates (#8018)             | **partial** — web half only; the desktop half is picture-in-picture, a cut surface. See below                                                                         |
| `c0e09f323` | fix(web): render nested markdown images correctly (#8501)         | **partial, adapted** — the headline fix reimplemented in Ronin's own image pipeline. See below                                                                        |

- **`fc262f1a2` (title retry).** Ronin's `maybeGenerateThreadTitleForFirstTurn` matched upstream's
  pre-patch shape exactly, so the retry applied verbatim. The adapted test keeps Ronin's `waitFor`
  polling structure (upstream awaits directly) and adds the `attempts === 2` assertion; the 2-second
  first backoff fits comfortably inside `waitFor`'s 10-second deadline.

- **`72c44a847` (skip duplicate browser updates), the web half.** `applyPreviewDesktopState` now
  returns the current state unchanged when the incoming `DesktopPreviewOverlay` is field-for-field
  identical, so per-frame IPC state pushes stop re-rendering subscribers. Ronin's overlay has
  exactly upstream's fields (including the always-false `pictureInPicture` flag), so
  `isPreviewStateEqual` and the store test ported as-is. Dropped: everything in
  `apps/desktop/src/preview/Manager.ts` — it dedupes and replays **picture-in-picture** frames, and
  this fork has no PiP (recorded in batch 8's `fe281c540` note; `FrameCaptureConsumer` here is
  `"recording"` only). The two upstream `Manager.test.ts` recording-cadence tests exist to pin that
  the PiP dedupe does not leak into recording delivery; with no dedupe ported there is nothing to
  pin, so they went with it.

- **`c0e09f323` (nested markdown images).** Upstream's commit is built on its
  `classifyMarkdownImageSource` classifier (`packages/client-runtime/src/markdownImages.ts`) and its
  workspace-image surface, both deliberately not taken (batch 10's `77c9d1eb5` note: Ronin's
  `MarkdownImage` / `WorkspaceMarkdownImage` pipeline solved this independently, and a second
  classifier would be a competing source of truth). The headline defect is real here too: the file
  preview rendered markdown with `cwd` only, so previewing `docs/README.md` containing
  `![](images/diagram.png)` asked the workspace asset endpoint for `<root>/images/diagram.png` —
  the server resolves relative paths against the workspace root (`AssetAccess.ts`). Reimplemented
  in Ronin's shape:
  - New `FileMarkdownPreview.tsx` wraps `ChatMarkdown` for the file preview panel and computes
    `imageBaseDir` from the previewed file's own directory via the fork's existing
    `resolvePathLinkTarget` (exported helper `fileMarkdownImageBaseDir`, with a focused test
    covering upstream's three cases: posix nested, Windows nested, root-level file).
  - `ChatMarkdown` gains an `imageBaseDir` prop; `MarkdownImage` resolves a local image path
    against it (only when provided — chat rendering is byte-identical to before). The extension
    gate in `isWorkspaceImagePreviewPath` runs before the resolve, so `resolvePathLinkTarget`'s
    `:line:col` splitting can never fire on a path that already ends in an image extension.
  - Dropped hunks, all tied to upstream's replaced image surface: `rehypePreserveImageSourceMeta`
    (successor to the `rehypeNormalizeWindowsImageSrc` this fork declined in batch 14's
    `a09f92171` note), `data-markdown-copy` on images, authored width/height sizing,
    `inline-block!` layout, SVG `#fragment` re-appending (`markdownImageSourceFragment`), the
    `isWindowsDrivePathHref` export in `markdown-links.ts` and its test, and the
    `ChatMarkdown.workspace-images.test.tsx` additions (that file does not exist here).

### Already in the tree (0)

None.

### Skipped (1)

| Upstream    | Title                                           | Reason                                                                                     |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `660cddd3b` | fix(web): four composer spacing defects (#8090) | every hunk serves the composer shoulder-tab design (`792a1404f`, #7150) skipped in batch 8 |

- **`660cddd3b`.** All four defects live in the shoulder-tab composer: `shoulderTabReserve` measures
  the tab band above the composer surface, the stash/tasks tab offsets move from `right-4` to
  `right-5.5`, `ComposerTasksBadge` (a file this fork does not have) caps its step segments, and the
  draft-hero padding keys off `group-has-[.chat-composer-shoulder-tab]`. This fork renders
  `ComposerStashBadge` as its own floating pill, has no `.chat-composer-shoulder-tab` class anywhere,
  and skipped the drawer redesign that introduced all of it — batch 13's `68966c1e6` was skipped on
  identical grounds. The relocated `useLayoutEffect` + `MutationObserver` in `ChatView.tsx` exists
  only to subtract the tab reserve from the scroll-to-end clearance; with no tabs the reserve is
  always zero and the observer would be pure churn.

### Verification

- Focused tests: `ProviderCommandReactor.test.ts` (58 pass, includes the new retry case),
  `pullRequests.test.ts` (1 pass, new file), `previewStateStore.test.ts` +
  `FileMarkdownPreview.test.ts` + `chatMarkdownImage.test.ts` (36 pass),
  `ChatMarkdown.test.tsx` + `markdown-clipboard.test.ts` (33 pass). No failures, none pre-existing
  in these files.
- Typecheck: `tsgo --noEmit` in `apps/server`, `apps/web`, `packages/client-runtime` — 0 errors.
  The four `apps/server` suggestions (`ClaudeAdapter.ts`, `OpenCodeAdapter.ts`,
  `ProviderService.ts`) are pre-existing and in files this batch does not touch.
- `vp lint` over all ten touched files — 0 findings. `vp fmt --check` — all correct.
- `git diff --check` clean.

**Hit every surface (for this batch):**

- **Clients** — web renderer only; the desktop shell needs no change (the overlay dedupe lives in
  the shared store the desktop bridge writes into, and the PiP producer side does not exist here).
- **Providers / contracts** — untouched; nothing in the batch crosses the wire in a new shape.
- **Entry points** — the image base-dir fix covers the one place markdown files render with a known
  file path (the file preview panel, reachable from the file browser, file links and file chips —
  all of which land in `FilePreviewPanel`). Chat markdown has no file identity and is deliberately
  unchanged.
- **Reverse states / connection modes** — no new state was added; the comment-edit refresh and the
  overlay dedupe are both idempotent read-side behaviors.
- **Docs** — no user-visible behavior changed in a way any existing doc describes; nothing added.

### Not tested

- **The file preview image fix in a real client.** The base-dir computation and path resolution are
  unit-tested; no browser pass was run, per `AGENTS.md`.
- **A real edited PR comment refresh against GitHub.** The new test drives a fake RPC client.

## Carried failures cleared (2026-08-30)

Not an upstream batch. Every batch since 9 re-recorded the same failures as "pre-existing" and moved
on; this is the pass that actually fixed them. **The next sync should expect a clean baseline** —
if any of these reappear, it is a regression, not the known list.

### Fixed (4 failures + 13 diagnostics)

| Symptom                                                                                | Cause                                                                                                   | Fix                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `MessagesTimeline.test.tsx` › "keeps the copy button for collapsed long user messages" | `25ce442f7` renamed the button's label from `Copy link` to `Copy to clipboard` and missed the assertion | assertion updated to the shipped label                                |
| `orchestrationEngine.integration.test.ts` › revert "without an active session"         | `25ce442f7` also removed the active-session requirement for revert; the scenario can no longer fail     | retargeted at a turn the thread never reached; suite drops 65s → 5.3s |
| `runtimeAbi.test.ts` fails to load                                                     | Vite's `.wasm` handling rejects the `?inline` suffix, so the whole file was unloadable                  | reads the vendored bytes off disk; **9 tests recovered**              |
| `ProviderRegistry.test.ts` › "re-probes when settings change the codex binaryPath"     | real subprocess probes raced fixed `attempts < 50/60` caps, so load decided pass/fail                   | shared `waitForProviders` helper budgeted in virtual time             |

- **The copy-button and revert failures were the same commit.** `25ce442f7` is a local squash whose
  message ("feat(desktop): add deep link handling…") mentions neither change. Both are genuine
  product improvements — a button that copies message text should not say "Copy link", and a revert
  should not require a live agent — and in both cases only the test was left behind. The revert test
  had been _timing out_ for 60s a batch, which is why the file looked slow rather than broken.

- **`waitForProviders` replaces three attempt-capped loops** (the boot-probe test and both loops in
  the re-probe test). These tests spawn real binaries, so results land on the host event loop while
  the test runs on `TestClock`; each turn now advances the virtual clock _and_ yields the fiber, and
  the 30s budget is spent in virtual time, which only moves when the loop moves it. A loaded machine
  therefore takes longer to spend the same budget instead of running out of attempts. Verified with
  six concurrent whole-file runs on a 12-core host: 46/46 every time. The old flake was never
  reproducible on demand, which is exactly why it survived nine batches — the fix is structural.

- **13 Effect diagnostics cleared, not suppressed-by-default.** Batch logs recorded "four
  pre-existing suggestions"; that count came from a truncated `tail`, and the real number was 13
  (11 of them in `cli/theme.ts`, landed by batch 18's environment-theme port). Twelve were the
  mechanical `unnecessaryFailYieldableError` — `yield* Effect.fail(err)` on an already-yieldable
  error — plus one `effectSucceedWithVoid`. The only judgement call was
  `DesktopAutoUpdate.ts`'s `runEffectInsideEffect`: `publish` is a `Ref` write plus a sync callback
  and needs no services, and the call runs on electron-updater's EventEmitter outside any fiber, so
  the code is correct as written and carries a justified `@effect-diagnostics-next-line` instead.

### Verification

- 9 suites over every touched file — 324 pass / 1 skipped, 0 failures.
- `tsgo --noEmit` in `apps/server`, `apps/web`, `apps/desktop` — **0 errors and 0 suggestions each**,
  down from 13 suggestions.
- `vp lint` and `vp fmt --check` over the 9 changed files — clean. `git diff --check` clean.

### Not fixed

- Nothing outstanding from the carried list. The `ProviderRegistry` flake is the one entry that
  cannot be _proven_ gone (it never reproduced on demand); the attempt caps it depended on are gone,
  which is the strongest available claim.

## Batch 20 — reviewed through `2daff8c25` (4 commits)

Reviewed `c0e09f323..2daff8c25`, snapshotted at `2daff8c25` for the whole run. The smallest batch
yet, and two of the four cancel each other out: `3d32797f6` rewrites the composer banner stack and
`8dcb96314` reverts it wholesale the same day. `git diff 3d32797f6^ 8dcb96314` is empty, so upstream
ended the range with the banner surface exactly as it started. The worktree was clean at the start of
the run (batch 19 and the carried-failure pass are committed as `31fc04b6b`).

### Ported (2, both partial)

| Upstream    | Title                                                                | Notes                                                                                                                         |
| ----------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `1f8ed54ad` | fix(mobile): reduce dev-client reload and Metro startup cost (#8694) | **partial** — the `client-runtime` registry-scope fix and the `AGENTS.md` testing line only; the mobile bulk is a cut surface |
| `2daff8c25` | test(web): remove tests for unreachable helpers (#8738)              | **partial** — every removal except `formatRelativeTimeUntil*`, which Ronin's Board still calls                                |

- **`1f8ed54ad` (registry scope), the client-runtime half.** Buried in a mobile dev-loop commit is a
  real leak in shared code: `createServiceScope` built each environment supervisor in a bare
  `Scope.make()`, a scope with no parent. Nothing tied it to the registry's own lifetime, so a
  supervisor acquired after the registry layer's scope had closed stayed open forever — the session
  it opened was never released. `make` now takes `const registryScope = yield* Scope.Scope` (the
  layer build scope; `Layer.effect` runs its effect in that scope and erases the requirement) and
  forks from it, so a closed registry scope closes the child immediately. Ronin's `registry.ts` was
  byte-identical to upstream's pre-fix shape apart from the removed relay surface, so the two hunks
  applied verbatim. Upstream's new test came whole: it builds the layer in a scope it owns, closes
  that scope, then runs `registry.start` under a synchronous scheduler and flushes, asserting zero
  sessions acquired and zero released. Confirmed meaningful by reverting the one-line fix — the test
  fails, and passes again with it. Dropped: everything under `apps/mobile`, `patches/`,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml` (a `uniwind` patch entry), `.agents/skills/test-t3-mobile`,
  and `docs/internals/mobile-development.md`. This fork has no mobile app.

- **`1f8ed54ad` (the `AGENTS.md` line).** "Test meaningful logic or observable behavior. Do not
  render components to static markup to assert props or attributes, or add tests that merely assert
  callback wiring or mirror the implementation." Fork-agnostic authoring guidance, and it is the
  rationale the very next upstream commit acts on. Taken into Ronin's `AGENTS.md` verbatim, in the
  same position under **Verifying**.

- **`2daff8c25` (unreachable helpers).** Upstream deletes seven helpers that only their own tests
  called. Each was re-checked against this fork rather than assumed, because Ronin's call sites
  diverge. Six are unreachable here too and went with their tests: `appearanceFontStack`,
  `resolveSidebarStageBadgeLabel` (and the now-unused `resolveServerBackedAppStageLabel` import —
  `SidebarStageBackdrop.tsx` still calls it directly, so `branding.logic.ts` keeps the export),
  `findFirstUnansweredPendingUserInputQuestionIndex`, the module-level
  `providerUpdateDismissal` read/write/dismiss quartet (`useDismissedProviderUpdateNotificationKeys`
  is the only live entry point, and the storage key goes back to module-private), `formatTimestamp`,
  and `appendVersionMismatchHint`. The `threadSyncLabel` hunk is test-only upstream and here too:
  the function stays (`ThreadSyncStatusPill.tsx` calls it), and only the assertion mirroring its two
  string literals goes. Dropped hunk: `formatRelativeTimeUntil` /
  `formatRelativeTimeUntilLabel` in `timestampFormat.ts`. Upstream can delete them; this fork
  cannot — `BoardCard.tsx:213` renders `formatRelativeTimeUntilLabel(thread.snoozedUntil)` as the
  snooze countdown on Board cards, a Ronin-owned surface. Their tests stay for the same reason.

### Already in the tree (0)

None.

### Skipped (2)

| Upstream    | Title                                                      | Reason                                                             |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `3d32797f6` | fix(web): unify activity logs and composer banners (#8693) | reverted upstream by `8dcb96314` inside this same range; net no-op |
| `8dcb96314` | revert(web): restore previous composer banners (#8733)     | the revert half of that pair; nothing to port                      |

- **The banner pair.** `3d32797f6` is a 33-file rewrite of the composer: a new `ComposerBanner.tsx`,
  `ComposerSurface.tsx`, `ComposerActivityStatus.tsx` and `ComposerServerUpdateStatus.tsx`, with
  `ComposerBannerStack` reduced to a shell and ~520 lines pulled out of `index.css`. `8dcb96314`
  restores every one of those files a day later. `git diff --stat 3d32797f6^ 8dcb96314` is empty
  across the whole tree, so upstream's considered position at the snapshot tip is the pre-`8693`
  design — which is what this fork already renders. Porting the pair would be two large, opposing
  refactors of `ChatComposer`, `ChatView` and `MessagesTimeline` for a guaranteed zero net change,
  on top of a composer this fork has already diverged on (batch 8's `792a1404f`, batch 13's
  `68966c1e6`, batch 19's `660cddd3b` — the shoulder-tab line was all declined). If upstream lands
  the redesign again, it will arrive as a fresh commit in a later batch and gets judged then.

### Verification

- Focused tests: `registry.test.ts` (17 pass, includes the new scope case), plus
  `appearanceFonts.test.ts`, `Sidebar.logic.test.ts`, `pendingUserInput.test.ts`,
  `threadSync.test.ts`, `timestampFormat.test.ts`, `versionSkew.test.ts` — 7 files, 205 pass, 0
  failures. Baseline stayed clean, as batch 19's carried-failure pass predicted.
- Negative control: with `Scope.fork(registryScope)` reverted to `Scope.make()`, the new registry
  test fails (1 failed / 16 passed); restored, 17 pass.
- Typecheck: `tsgo --noEmit` in `apps/web` and `packages/client-runtime` — 0 errors, 0 suggestions.
- `vp lint` over the 14 changed `.ts` files — 0 findings. `vp fmt --check` over all 15 changed files
  (including `AGENTS.md`) — all correct. `git diff --check` clean.

**Hit every surface (for this batch):**

- **Clients** — the registry fix is in `packages/client-runtime`, so desktop and web both get it
  from the shared layer; neither shell needed a change. The web removals are dead code with no
  render path.
- **Providers / contracts** — untouched. Nothing here crosses the wire.
- **Entry points / reverse states** — no behavior was added or removed from any user-facing path.
  The scope fix only changes what happens after the registry has already been torn down.
- **Connection modes** — this is the connection layer, and the fix applies to every target kind
  (primary, bearer, SSH) because it sits in the one place service scopes are created.
- **Docs** — `AGENTS.md` gained the testing-guidance line. No `docs/` change: nothing a user would
  notice changed.

### Not tested

- **A real teardown race in a running client.** The leak is unit-tested against the registry layer;
  no app run was made to reproduce the original stranded-session case, per `AGENTS.md`.

## Batch 21 — reviewed through `e3dcc1615` (20 commits)

Reviewed `2daff8c25..e3dcc1615`, snapshotted at `e3dcc1615` for the whole run. The worktree was
clean at the start (batch 20 is committed as `a3b390ed5`). The batch is dominated by one large web
feature — video attachments — plus a Codex markdown-directive renderer that needs new dependencies,
and five mobile/release commits that are pure cut surface.

### Ported (13)

| Upstream    | Title                                                                     | Notes                                                                                  |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `ac4aae101` | feat(web): play video attachments in chat (#8688)                         | **adapted** — grafted onto Ronin's portal `Dialog`; dropped upstream's new dialog test |
| `7980dfddb` | fix(web,mobile): snooze menu no longer offers the same wake time twice    | clean — shared `client-runtime` state, no mobile surface involved                      |
| `6e324b9bb` | fix(web): reduce title bar scroll fade height (#8799)                     | **adapted** — Ronin uses named fade classes in `chrome.css`, not a Tailwind utility    |
| `12fe2d6d0` | fix(windows): strip quotes from repaired PATH (#8746)                     | clean                                                                                  |
| `8f525af5a` | fix(web): open agent images in expanded preview (#8807)                   | **adapted** — Ronin owns a different markdown-image component tree                     |
| `60f2ce027` | fix(git): follow repository instructions in generated source control text | clean — docs line reworded for the Ronin name                                          |
| `9072aa1fd` | fix(server): stop overpricing cached Claude tokens (#8806)                | **adapted** — kept Ronin's `aliasModelNames` lookup on top of the new keying           |
| `e09b88b6a` | fix(web): keep right panel synced with agent edits (#8803)                | clean but for Ronin's `MissingMediaBlock` error state                                  |
| `c1e70b5f8` | fix(web,mobile): render Codex citations and artifact templates (#8584)    | **partial** — web + `client-runtime` halves; the mobile half is a cut surface          |
| `e4f7b14fa` | chore: add Windows setup script to t3.json (#8814)                        | **adapted** — Ronin's `t3.json` has no relay `.env` to symlink                         |
| `17c48f7fc` | fix(web): fold interim turn responses (#8828)                             | clean — test row order adapted to Ronin's expanded work rows                           |
| `8b817cbca` | fix(web): use circle alert for failed tool calls (#8840)                  | **adapted** — Ronin renders the failure marker as a separate badge                     |
| `cefec32d6` | fix(web): prevent pull request metadata overlap (#8790)                   | **adapted** — Ronin has no condensed-topbar refresh control                            |

- **`ac4aae101` (video attachments).** The largest change in the batch and a genuine capability, not
  polish: a video attachment now plays in the expanded preview instead of downloading. Ronin's
  generic-file attachment surface (`b5b57c3eb`) turned out to be byte-compatible with upstream's
  pre-fix shape, so 20 of the 22 files applied verbatim — `AssetAccess` claims (`download` is now
  suppressed for `video/*`), `http.ts` inline video `Content-Type`, the desktop CSP's new
  `media-src`, `videoMimeType`/`isVideoAttachment` in `types.ts`, the composer's video tiles and
  thumbnail element, `composerDraftStore`'s reattach-marker matching, and the timeline's play
  buttons. Two files needed hand work. `ExpandedImageDialog.tsx` is a real divergence: upstream
  renders a bare `fixed inset-0` div, Ronin renders a Base UI `Dialog`/`DialogPopup` with
  `FallbackImage` and `MissingMediaBlock`. The video branch (player, unplayable-format fallback,
  download button, `mediaLabel` aria strings) was grafted into Ronin's dialog, keeping Ronin's
  radius/border tokens and its bounds-normalising `index`. `MessagesTimeline.tsx` conflicted only
  on the lucide import block, where Ronin has `MinusIcon` and no `SearchIcon`.
  Dropped: upstream's new `ExpandedImageDialog.test.tsx`. It asserts on `renderToStaticMarkup`
  output, which Ronin's portalled dialog renders as the empty string — confirmed by running it — and
  it is the exact shape `AGENTS.md` tells us not to write. The video render path is still covered by
  the `MessagesTimeline` play-button test and `ExpandedImagePreview.test.ts`, both of which came
  across whole and pass.
  `docs/user/composer.md` took the playback paragraph, and its attachment-type list gained "videos"
  (that half-sentence is upstream's, from `e3dcc1615`, but it is true of Ronin the moment this lands).

- **`6e324b9bb` (scroll fade height).** Upstream collapses three different fade heights
  (2.5rem, 3rem at `sm`, 1.5rem on the pull-request list) into one 1.5rem token. Ronin reaches the
  same place by a different route: it has no `topbar-scroll-fade` Tailwind utility, it has
  `.chat-timeline-scroll-fade` / `.settings-page-scroll-fade` / `.pull-requests-scroll-fade` in
  `styles/chrome.css`, each carrying its own `--topbar-scroll-fade-height`. Added
  `--workspace-titlebar-scroll-fade-height: 1.5rem` to `styles/tokens.css` next to the other
  `--workspace-titlebar-*` tokens, pointed the three classes at it, and deleted both the
  pull-request override and the `min-width: 40rem` bump. `MessagesTimeline`'s two spacers
  (`h-10 sm:h-12`, `pt-10 sm:pt-12`) now read the token, exactly as upstream.

- **`8f525af5a` (expandable agent images).** Behaviourally a clean win — an image an agent renders
  in its message opens in the same preview a user attachment does — but not portable as a patch.
  Upstream's `ChatMarkdown` has `ChatMarkdownWorkspaceImage`, `ChatMarkdownImageFallback` and a
  `markdown-images` client-runtime subpath; Ronin has `MarkdownImage` → `WorkspaceMarkdownImage` →
  `LoadableMarkdownImage` with `MissingMediaChip`, and no such subpath. Reimplemented on Ronin's
  tree: `MarkdownLinkContext` and `expandableMarkdownImageProps` came over verbatim, the
  `onImageExpand` prop threads down the three components, and the context is read once in
  `LoadableMarkdownImage` — the single place Ronin renders an `<img>` for markdown, and already a
  component, so upstream's `img: function MarkdownImage(...)` rename was unnecessary here. An image
  inside a link still belongs to the link, by the context and by upstream's `closest("a")` guard.

- **`9072aa1fd` (cached-token overpricing).** A real cost bug. LiteLLM publishes the same model
  under several keys (`claude-fable-5`, `deepinfra/anthropic/claude-fable-5`), the old
  `parseRateTable` normalised every key to its bare name, and whichever entry was parsed last won —
  including entries with no `cache_read_input_token_cost`, which then fall back to the full input
  rate and overcharge every cached token. Upstream keeps the qualified key and adds a bare alias
  only when no canonical entry exists and all qualified entries agree. Ronin's `lookupRate` had
  diverged with `aliasModelNames` (Grok's `-build` variants, Antigravity's `-preview` ids), so the
  adaptation is: look up the full key first, then run Ronin's aliases against the bare name. The
  Grok and Antigravity transcript suites confirm that path still resolves.

- **`c1e70b5f8` (Codex citations and artifact templates).** Codex is a first-class Ronin provider,
  and this is the renderer for the `:::codex-file-citation` and `:::artifact-template` directives it
  emits — without it those come through as raw directive text. Took the three new `client-runtime`
  modules whole (`codexFileCitations`, `codexArtifactTemplates`, `codexMarkdownDirectives`) with
  their tests, the three package exports, and the web wiring: `remarkCodexDirectives` in both remark
  plugin arrays, the `div` component renderer plus its sanitiser allowance, `CodexArtifactTemplateCard`,
  `onUseArtifactTemplate` down through `MessagesTimeline` to `ChatMarkdown`, and
  `renderCodexDirectivesForCopy` on the assistant copy path. This is the one port in the batch that
  needed `pnpm-lock.yaml` movement: `mdast-util-directive` and `micromark-extension-directive` are
  genuinely new (`micromark-util-character`, `remark-parse` and `unified` were already in the store
  as transitive react-markdown deps). Conflicts were all additive — Ronin's `onAskOnTheSide`,
  `shoulderTabReserve`, `dataHtmlPreview` sanitiser entry and `MessageSourceBlock` branch all sit
  alongside the new members. Dropped: the mobile `ThreadFeed`/`ThreadDetailScreen` halves, the
  `markdown-images` import (upstream's image module, which Ronin does not have), and the
  `img: [..."dataLocalSrc", "dataMarkdownTitle"]` sanitiser entry that belongs to it.

- **`8b817cbca` (circle alert).** Upstream folds warning and failure into one `circle-alert` icon
  name inside `LiveActivityContent` and `PlainWorkEntryRow`. Ronin has no live-activity work rows at
  all — no `LiveActivityRow`, `LiveActivityContent`, `LiveWorkEntryTimelineRow` or
  `toolGroupSummaryIconName` — so that whole hunk was dropped rather than reintroducing an upstream
  surface as a side effect. The two places Ronin does draw the glyph took the change: the warning
  icon name in `PlainWorkEntryRow`, and the trailing failure badge, which swapped `XIcon` for
  `CircleAlertIcon` behind its "Failed" tooltip. Both timeline assertions moved from `lucide-x` to
  `lucide-circle-alert`; Ronin's `font-medium text-destructive` assertion stays.

- **`cefec32d6` (pull request row overlap).** The row grid change, the `@container` meta line, the
  search chip, `PullRequestActorLabel`'s `labelClassName`, `CompactFilterMenu`'s truncation and the
  condensed-breadcrumb `searchExpanded` behaviour all came over. Two adaptations: the search chip
  uses Ronin's `text-3xs` token rather than a raw `text-[10px]`, and the `shrink-0` → `shrink`
  change on the condensed topbar wrapper does not apply — Ronin renders `ExpandableSearch` directly
  there, with no `PullRequestRefreshControl` beside it, and `ExpandableSearch` now carries
  `w-56 min-w-24 shrink` itself.

- **`e4f7b14fa` (Windows worktree script).** Kept because Ronin ships a Windows desktop build and
  this batch also carries a Windows PATH fix, so a contributor on Windows is a real case. Adapted:
  Ronin's `t3.json` symlinks only `.env`, never `infra/relay/.env`.

### Already in the tree (2)

| Upstream    | Title                                                      | Confirmation                                                            |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `7880a6e58` | fix(grok): allow model changes in existing threads (#8392) | `d31c6d5f7` removed `requiresNewThreadForModelChange` from Grok already |
| `5885a68ad` | fix(web): keep image preview above sidebar control (#8811) | Ronin's preview is a portalled dialog, so it already paints on top      |

- **`7880a6e58`.** Ronin dropped `requiresNewThreadForModelChange` from `GROK_PRESENTATION` in
  `d31c6d5f7` ("switch Grok models in-session and detect real auth state"), months before upstream
  landed #8392, and `GrokProvider.test.ts:247` already asserts the flag is `undefined`. Nothing to do.

- **`5885a68ad`.** Upstream's expanded preview is a plain `fixed inset-0 z-50` div rendered inline in
  `ChatView`, so at an equal z-index the later-in-DOM workspace titlebar control painted over it;
  their fix bumps the preview to `z-[60]`. Ronin's preview goes through `DialogPopup`, which portals
  to `document.body` — after every in-tree `z-50` fixed element — so the tie already resolves in the
  preview's favour. The literal port would mean bumping the shared `DialogViewport` used by every
  dialog in the app to fix a bug this fork does not have.

### Skipped (5)

| Upstream    | Title                                                            | Reason                                                                |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `f15680bd3` | feat(mobile): update tool summaries and chat transitions (#8793) | mobile feature; its web hunk is a byte-identical move for mobile only |
| `86c9a9288` | feat(mobile): pick, share, and receive files in threads (#8237)  | entirely `apps/mobile`, patches, and mobile-only docs                 |
| `352710d49` | feat(mobile): add offline iPhone voice input (#8614)             | iOS speech + expo-audio; the shared controller has no web consumer    |
| `7963ac740` | chore(release): prepare v0.0.37                                  | Ronin versions independently (`0.6.9`)                                |
| `e3dcc1615` | Add mobile composer attachment menu with video support (#8843)   | mobile composer menu and mobile navigation docs                       |

- **`f15680bd3`.** Buried in a mobile commit is a web change worth looking at, and it turns out to be
  nothing: `tokenizeShellCommand` and `commandProgramName` move out of `MessagesTimeline.tsx` into a
  new `client-runtime/work-log/commandLabel.ts`. Diffed the extracted file against the deleted block
  — identical apart from the added `export`. The sibling `work-log/presentation.ts` has no web
  importer at all. In a fork with no mobile app the move buys nothing and costs a package export, so
  Ronin keeps the helper inline. (This is why `c1e70b5f8`'s `commandProgramName` import line was
  dropped when that commit's `MessagesTimeline` conflict was resolved.)

- **`352710d49`.** The `client-runtime/voice-input` controller looks fork-agnostic but is not
  reachable without a mobile transcription backend: it is driven by `expo-audio` recorder events and
  an Apple on-device `VoiceTranscriber`, and no web or desktop surface calls it. Porting it would add
  ~1,000 lines of dead code plus two patched native dependencies. Dictation on desktop would be a new
  Ronin feature, not a sync.

### Verification

- Focused tests, 24 files over every changed module — 603 pass, 0 failures:
  `ElectronProtocol`, `DesktopShellEnvironment`, `AssetAccess`, `GitManager`, `http`, `usagePricing`,
  `usageScanCache`, `usageTranscripts`, `usageAggregation`, `ChatMarkdown`, `ChatView.logic`,
  `ExpandedImagePreview`, `MessagesTimeline`, `MessagesTimeline.logic`, `composerAttachmentFiles`,
  `projectFilesQueryState`, `composerDraftStore`, `useWorkspaceMutationRefresh`, `markdown-clipboard`,
  `codexArtifactTemplates`, `codexFileCitations`, `codexMarkdownDirectives`, `threadSnoozed`, `shell`.
- Neighbouring suites for the surfaces that were adapted rather than applied — pull-request list and
  filters, `pullRequestMarkdown.logic`, `threadSettled`, the whole `textGeneration` directory:
  12 files, 386 pass, 0 failures.
- Negative control: upstream's `ExpandedImageDialog.test.tsx` was run before being dropped and fails
  against Ronin's portalled dialog (`expected '' to contain '<video'`), which is why it is gone
  rather than merely inconvenient.
- Typecheck: `tsgo --noEmit` in `apps/web`, `apps/server`, `apps/desktop`, `packages/client-runtime`,
  `packages/shared`, `packages/contracts` — 0 errors, 0 suggestions each.
- `vp fmt --check` over all 61 changed files — clean. `git diff --check` — clean.
- `vp i` after the `client-runtime` dependency additions; the `pnpm-lock.yaml` diff is confined to
  the five new specifiers and the two genuinely new packages.

**Hit every surface (for this batch):**

- **Entry points** — video playback is reachable from both places a video attachment appears: the
  composer tile before sending and the timeline play button after. Markdown image expansion is
  reachable from any agent message. The right-panel refresh covers the diff panel, the file browser
  and the file preview, all three wired from `ChatView`'s single `workspaceMutationId`.
- **Clients** — desktop gets the CSP `media-src` it needs for `blob:` playback; the shared logic all
  lives in `packages/client-runtime` or `apps/web`, which the desktop shell renders.
- **Providers** — the Codex directive renderer is provider-shaped and Codex-only by construction:
  other providers never emit those directives, so their markdown is untouched. The Grok verdict was
  a no-op. No adapter needed a decision.
- **Contracts** — unchanged. Video rides on the existing attachment asset claims; the new
  `mimeType` handling is server-side policy on an already-typed field.
- **Reverse states** — a video that cannot be decoded offers a download; a download that fails says
  so; an in-flight preview is cancellable and cancels itself on thread switch and unmount. The
  artifact-template card renders without its "Use template" action when no handler is supplied.
- **Connection modes** — the video preview fetches through the environment's signed asset URL and
  resolves against `connection.httpBaseUrl`, so remote and Tailscale environments take the same path
  as local; `blob:` playback means no cross-origin media load.
- **Docs** — `docs/user/composer.md` gained video playback and the attachment-type mention;
  `docs/user/source-control.md` gained the `AGENTS.md`/`CLAUDE.md` line. Mobile-only doc edits from
  the skipped commits were left behind, and `docs/internals/mobile-*.md` does not exist here.

### Not tested

- **A running client.** No dev server or browser was started, per `AGENTS.md`. The video player, the
  expandable markdown images, the pull-request row layout and the scroll-fade height are all
  visual/interaction changes verified by tests and typecheck only.

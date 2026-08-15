# Upstream (T3 Code) sync log

Ronin is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) with a deliberate cut:
desktop only, no mobile app, no T3 Connect / Clerk / hosted relay, no WSL, no legacy sidebar, no
Playwright preview automation. Upstream commits are therefore **triaged, not merged**.

This file is the watermark. On the next sync, only look at commits _after_ the SHA below — every
commit at or before it has already been judged, and the verdict is recorded here.

## Watermark

|                               |                                                                          |
| ----------------------------- | ------------------------------------------------------------------------ |
| **Upstream reviewed through** | `e9ae134c5` — `docs: route feature requests to Discussions` (2026-08-15) |
| **Fork merge base**           | `083fa4ab2` — `feat(web): use OKLCH for theme palettes (#6036)`          |
| **Ported on**                 | 2026-08-15                                                               |

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

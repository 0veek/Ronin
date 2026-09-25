# Upstream (T3 Code) sync log

Ronin is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) with a deliberate cut:
desktop only, no mobile app, no T3 Connect / Clerk / hosted relay, no WSL, no legacy sidebar, no
Playwright preview automation. Upstream commits are therefore **triaged, not merged**.

This file is the watermark. On the next sync, only look at commits _after_ the SHA below — every
commit at or before it has already been judged, and the verdict is recorded here.

## Watermark

|                               |                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Upstream reviewed through** | `4293433ec` — `perf(server): avoid rereading unchanged files in review previews (#13395)` (2026-09-26) |
| **Fork merge base**           | `083fa4ab2` — `feat(web): use OKLCH for theme palettes (#6036)`                                        |
| **Ported on**                 | 2026-09-26                                                                                             |

> We cherry-pick rather than merge, so `git rev-list --count upstream/main...HEAD` will keep
> reporting the fork as "behind" even for commits already taken. Trust the watermark, not the count.

## How to triage the next batch

```bash
git fetch upstream
git log --oneline 4293433ec..upstream/main          # the new commits

# For each commit: which files does it touch that this fork still has,
# and have we already diverged on them?
MB=$(git merge-base HEAD upstream/main)
git log --reverse --format='%h|%s' 4293433ec..upstream/main | while IFS='|' read -r h s; do
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

## Batch 22 — reviewed through `31c1c5996` (19 commits)

Reviewed `e3dcc1615..31c1c5996`, snapshotted at `31c1c5996` for the whole run. The worktree was
clean at the start. The batch is dominated by two large web changes — a native rewrite of browser
recording, and an upstream redesign of the composer surface — plus seven mobile/governance commits
that are pure cut surface.

The composer redesign (`30175a8af` and its two follow-ups) was an **Ask**, resolved by the
maintainer as _skip the visual rewrite, take the fixes inside it_. That decision shapes four
entries below and is spelled out under **The composer trilogy**.

### Ported (8)

| Upstream    | Title                                                        | Notes                                                                                   |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `30175a8af` | fix(web): restore unified activity logs and composer banners | **partial** — the touch/keyboard-reachable banner stack and the failed-update dismissal |
| `9842518c9` | fix(web): address composer banner review follow-ups (#8850)  | **partial** — the focus-management refinement of the same banner stack                  |
| `395811105` | fix(preview): improve browser recording quality (#8839)      | **adapted** — Ronin has no picture-in-picture, so the JPEG frame pipeline goes with it  |
| `e9c4775e8` | fix(web): mark pull request links as external (#8856)        | clean                                                                                   |
| `f86c5e8c8` | fix(server): skip IDE detection in Claude probes (#8634)     | clean                                                                                   |
| `038bf3739` | Delete app.json (#8934)                                      | clean — an inert `{"expo": {}}` stub with no reference anywhere in the tree             |
| `35da58133` | fix(web): show scrollbar for wide markdown tables (#8868)    | clean                                                                                   |
| `ef84bc987` | fix(chat): smooth worktree setup status (#8922)              | **partial** — the draft-promotion fix and the anchor offset, not the timeline shimmer   |

- **`395811105` (browser recording quality).** The batch's largest real change and a genuine
  capability, not polish: recording stops re-encoding a 12 fps `capturePage` JPEG stream through a
  canvas and instead captures the guest natively. `startRecording` now measures the guest's
  viewport with `executeJavaScript`, forces a warm-up frame, and returns
  `{ sourceId, width, height }` from `webContents.getMediaSourceId`; the renderer feeds that into
  `getUserMedia`'s `chromeMediaSource: "tab"` constraints and hands the resulting `MediaStream`
  straight to `MediaRecorder`. A new client-local `browserRecordingFrameRate` setting (30 or 60 fps,
  default 30) rides along in Settings → Integrations, with its search entry and reset button.
  The adaptation is forced by a Ronin divergence upstream does not have. Upstream keeps the
  `capturePage` loop because picture-in-picture still consumes it; Ronin removed
  picture-in-picture entirely (`openPictureInPicture` is a no-op stub), so `"recording"` was that
  loop's only consumer. Leaving it running would have meant a 12 fps GPU capture feeding nothing
  for the length of every recording. So the loop, `capturePreviewFrame`, the recording-frame
  listener set, the `Page.screencastFrame` forwarding block, `PREVIEW_RECORDING_FRAME_CHANNEL`,
  the preload `onFrame` bridge and the `DesktopPreviewRecordingFrame` contract all came out with
  it; `FrameCaptureSession` keeps only the background-throttling lease. Ronin's own 128 MB
  auto-stop (`encodedBytes`, `autoStoppedRecordings`, `subscribeBrowserRecordingAutoStopped`)
  survives unchanged on top of the new stream.
  Upstream's `Manager.test.ts` rewrite came across for the recording cases — warm-up failure,
  invalid dimensions, the two start races — and its ~570 lines of picture-in-picture and
  element-picking cases were dropped, matching surfaces this fork does not have.

- **`ef84bc987` (worktree setup).** The real defect is in `resolveDraftPromotionNavigationTarget`:
  it promoted the draft route to the canonical thread route as soon as the thread existed, which
  during worktree setup unmounts the local preparation feedback before the server has a running
  turn to render. It now waits for `latestTurn.startedAt`, or for a session that ended as
  `error`/`stopped`/`interrupted` so a startup failure still lands on the thread. `threadHasStarted`
  stays — four other call sites still use it. `CHAT_TIMELINE_ANCHOR_OFFSET` (24) came over as its
  own constant in `timelineScrollAnchoring.ts`, replacing the shared `CHAT_LIST_ANCHOR_OFFSET` (16)
  at the four web call sites: upstream sizes it to the titlebar fade inset so promotion preserves
  the first row's position, and Ronin's fade is the `1.5rem` `--workspace-titlebar-scroll-fade-height`
  token taken in batch 21, so 24 is the matching number here too. `packages/shared/chatList.ts`
  keeps its 16 default for any other consumer.
  Dropped: the presentation half. Upstream moves the status out of the composer and into the
  timeline's working row as a shimmering "Setting up worktree…", which needs `LiveActivityRow`,
  `LiveActivityContent` and the `live-activity-focus` classes — none of which exist here (batch 21
  recorded the same absence for `8b817cbca`). Ronin keeps its composer-side "Preparing worktree..."
  indicator, which the promotion fix now keeps mounted for the whole setup, so the feedback the
  commit is about is present either way. The `isWorktreeSetupActivity` filter on
  `deriveWorkLogEntries` went with it: it exists to stop `setup-script.requested`/`.started` rows
  duplicating upstream's new timeline status, and without that status it would only delete Ronin's
  one in-timeline signal that setup is running.

### The composer trilogy — `30175a8af`, `9842518c9`, `3f62e6fa6`

`30175a8af` "restore unified activity logs and composer banners" (#8734) is 1410/2235 lines over 33
files. It introduces `ComposerSurface` and `ComposerBanner` primitives, deletes
`ThreadSyncStatusPill.tsx`, deletes `deriveTurnPlans` and the `turn-plan` timeline row (moving plan
progress into a composer tasks badge), rewrites work-log grouping, and removes 524 lines from
`index.css`. `9842518c9` and `3f62e6fa6` are follow-ups that only compile against those primitives.

This is exactly where Ronin has diverged most. `ChatView.tsx` is +1224/−483 against this commit's
parent, `index.css` was split into `styles/*.css` long ago, there is no `ComposerTasksBadge.tsx`
here, and `turnReplay.ts:73` depends on the `turn-plan` entry kind. Taking the trilogy whole would
have meant replacing Ronin's composer with upstream's and rebuilding a tasks surface to hold the
plan progress the inline chips currently show. The maintainer chose to keep Ronin's composer and
take only the behavior. What that came to:

**Taken.**

- The banner stack is reachable without a pointer. Both forks previously revealed the stacked
  notices with `group-hover:`/`group-focus-within:` only, behind a non-interactive peek `div` — on a
  touchscreen there was no way to open it at all. The peek is now a real `button` ("Show other
  notices") with `aria-expanded`/`aria-controls`, the reveal is driven by `stackExpanded` state
  (pointer enter for mice, click for touch), `Escape` closes it and returns focus to the peek, the
  expanded region is a labelled `role="group"`, and pressing anything on the front banner collapses
  it. `9842518c9`'s refinement came with it: focus moves into the first control of the region on
  open, the peek is `aria-hidden` and untabbable while expanded, and the focus handoffs run through
  a `pendingFocusRef` in a layout effect rather than an imperative `focus()` at the call site.
  Ronin's own surface treatment (`surface-alert`, `rounded-[22px]`, `--duration-fast`,
  `--shadow-raised`, the variant-coloured peek border) is untouched.
- A failed server update can be dismissed. `versionSkew.ts` gains the `WeakSet`-keyed
  `dismissServerUpdateFailure`/`isServerUpdateFailureDismissed` pair, so dismissing a failure hides
  that attempt across chat remounts without clearing the error in Settings and without hiding the
  next attempt. `ChatView`'s banner condition and dismiss spread follow.
- `docs/user/composer.md` gained a "Notices above the composer" section describing the peek,
  reworded for Ronin's floating stack (upstream's says "attached banner").

**Not taken, and why.**

- `ComposerSurface`, `ComposerBanner`, `ComposerActivityStatus`, `ComposerServerUpdateStatus` — the
  visual system the maintainer chose to skip. Ronin keeps `Alert`/`AlertTitle`/`AlertAction` and
  `ThreadSyncStatusPill`.
- The removal of `deriveTurnPlans` and the `turn-plan` row. It is only safe upstream because the
  plan moved into a composer tasks badge Ronin does not have, and `turnReplay.ts` reads that entry
  kind here.
- The in-stack `bannerPriority` sort. Upstream sorts items into three buckets
  (`activity` / urgent / rest) inside `ComposerBannerStack`. Ronin's `composerBannerItems` assembler
  already orders seven categories deliberately — quota resume ahead of background liveness because
  its Cancel is the only way to stop a self-starting turn, parked-thread last because it must never
  cover another — and a three-bucket sort would flatten that. Ronin's `urgent` flag stays.
- `3f62e6fa6` **entirely**. Its banner-width changes are the skipped visual layer, and its one
  behavior change — deleting `workingStepLabel` from the timeline's working row — is only correct
  upstream because that commit's sibling puts the plan step in the composer instead. In Ronin the
  working row is where the current plan step is shown, so the deletion would strand users.

### Already in the tree (1)

| Upstream    | Title                                | Confirmation                                       |
| ----------- | ------------------------------------ | -------------------------------------------------- |
| `4a9d2d0ce` | chore(deps): bump Electron to 43.4.1 | `apps/desktop/package.json:22` is already `43.4.1` |

- **`4a9d2d0ce`.** Ronin moved to Electron 43 independently and `BrowserSession.ts:160` already
  clears `["cookies", "localstorage", "indexdb", "serviceworkers"]` with no `"websql"` — the exact
  storage-key change the bump required. Nothing to do.

### Skipped (10)

| Upstream    | Title                                                          | Reason                                                                   |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `f9137a0c8` | fix(mobile): map native menu icon colors explicitly            | `apps/mobile` only                                                       |
| `9b2d04317` | fix(mobile): replace Callstack glass with Expo glass (#8862)   | `apps/mobile` only, plus a mobile-only doc                               |
| `746c932e1` | fix(mobile): defer draft navigation until submission completes | `apps/mobile` only                                                       |
| `5ce92c2f1` | fix(mobile): shimmer active tool rows (#8932)                  | `apps/mobile` only                                                       |
| `31c1c5996` | feat(mobile): add video playback with native iOS controls      | mobile; its three non-mobile hunks are mobile plumbing — see below       |
| `3f62e6fa6` | fix(web): widen sync banners and simplify the working timer    | composer redesign follow-up; see **The composer trilogy**                |
| `ad38700ac` | chore(macroscope): review diagnostic overrides (#8917)         | upstream review-bot governance                                           |
| `4e8e64fc0` | chore: disable CodeRabbit review status (#8933)                | upstream review-bot config; Ronin runs neither bot                       |
| `2921050c6` | fix(contracts): accept CLI event origins (#8905)               | the `ClientSurface` schema and `metadata.origin` field do not exist here |
| `bba79cc25` | fix(web): hide invalid slash skill completions (#8904)         | fixes an inline slash typeahead this fork does not render                |

- **`31c1c5996`.** Three hunks land outside `apps/mobile` and all three are mobile plumbing.
  `apps/server/src/http.ts` gains HTTP Range support (`assetByteRange`, `assetFileResponse`) so iOS
  can stream a video as it plays; Ronin's web player fetches the whole asset and plays a `blob:`
  URL built in `ExpandedImagePreview.tsx`, so it never issues a range request. `packages/shared/src/video.ts`
  extracts `videoMimeType` out of `apps/web/src/types.ts` purely so mobile can import it — the same
  shape as `f15680bd3`'s `commandLabel` extraction that batch 21 declined, so the helper stays
  inline. The `docs/user/composer.md` hunk is mobile share-sheet and iOS-player copy.
  Worth writing down: streaming rather than buffering a whole video before playback would be a real
  improvement for remote and Tailscale environments. That is a Ronin feature on top of the server
  change, not a port of it.
- **`ad38700ac`.** Half of it edits `.macroscope/approvability.md`, which this fork does not have
  (batch 18 skipped `2bc9e8ef6` for the same reason). The other half edits
  `.macroscope/check-run-agents/effect-service-conventions.md`, which does exist here — but only as
  an artifact inherited from before the fork (last touched by upstream's `c3e8fb67d`), with no
  Macroscope wiring in `.github/workflows`. Batch 11 skipped `2433f4c1c` on the same grounds.
- **`2921050c6`.** Adds `"cli"` to `ClientSurface` and asserts a `metadata.origin` round-trip.
  Ronin has no `ClientSurface` schema at all, and `OrchestrationEventMetadata`
  (`packages/contracts/src/orchestration.ts:1598`) carries only `providerTurnId`, `providerItemId`,
  `adapterKey`, `requestId` and `ingestedAt` — no `origin`. The event store test patch applies
  cleanly on context alone and then fails, which is why it was reverted rather than kept.
- **`bba79cc25`.** Filters skills out of slash completions once the caret is past the start of the
  prompt. It lands in `ChatComposer`'s `ComposerCommandItem` menu — and Ronin does not render one.
  `ComposerCommandMenu.tsx` and `composerSlashCommandSearch.ts` are orphans here with no importer
  outside their own test; Ronin's slash surface is `ComposerSlashStatusDialog` and
  `ComposerSlashTargetPicker` in `ChatView`, and skills are inline Lexical chips
  (`ComposerSkillDecorator` in `ComposerPromptEditor.tsx`), not typeahead rows.

### Verification

- Focused tests over every changed module — 13 files, 435 pass, 0 failures: `Manager`,
  `DesktopClientSettings`, `browserRecording`, `ChatView.logic`, `ComposerBannerStack`,
  `MessagesTimeline`, `MessagesTimeline.logic`, `SettingsPanels.logic`, `settingsSearch`,
  `versionSkew`, `session-logic`, `contracts/settings`, `turnReplay`.
- Neighbouring suites for the adapted surfaces — the whole `apps/web/src/components/preview`,
  `apps/web/src/browser` and `apps/desktop/src/preview` directories plus `ComposerPrimaryActions`,
  `ComposerStashMenu` and `composerSlashCommandSearch`: 47 files, 411 pass, 0 failures.
- Claude probe and pull-request suites: 17 files, 331 pass, 0 failures.
- Typecheck: `tsgo --noEmit` in `apps/web`, `apps/desktop`, `apps/server`, `packages/contracts`,
  `packages/client-runtime`, `packages/shared` — 0 errors each.
- `vp lint` over all 33 changed files — clean. `vp fmt --check` — clean. `git diff --check` — clean.
- No pre-existing failures were observed in any suite that was run.

**Hit every surface (for this batch):**

- **Entry points** — browser recording is reachable from both places it starts: the user's record
  button in `PreviewView.tsx` and the agent's `preview_recording_start` through
  `PreviewAutomationHosts.tsx`. Both go through `startBrowserRecording`, so both get the native
  stream and the frame-rate setting. The new setting is reachable from Settings → Integrations and
  from settings search. The banner peek is reachable by pointer, touch and keyboard.
- **Clients** — the recording rewrite spans desktop (Manager, IPC, preload) and web (renderer);
  the frame-rate setting is client-local by design, so it lives in `ClientSettings`, not server
  settings.
- **Providers** — only the Claude adapter changed, and only its capability probe environment.
  No other adapter needed a decision.
- **Contracts** — `DesktopPreviewRecordingSource` added, `DesktopPreviewRecordingFrame` removed,
  `DesktopPreviewBridge.recording.startScreencast` now returns the source, and
  `ClientSettings`/`ClientSettingsPatch` carry `browserRecordingFrameRate`. Desktop, web and the
  preload bridge all follow.
- **Reverse states** — a failed update can now be dismissed and comes back on the next attempt; a
  media capture that never settles fails with `BrowserRecordingCaptureTimeoutError` after 5s and
  releases the surface lease and the tab's recording lease; a recorder that reports no output
  format fails with `BrowserRecordingFormatUnavailableError` instead of writing an untyped blob; a
  `startRecording` that fails anywhere after taking the lease releases it via `Effect.onError`.
- **Connection modes** — recording is desktop-local by construction: the media source id names a
  Chromium guest in this process, so nothing crosses the wire differently for remote or Tailscale.
  The draft-promotion fix reads thread state the server already sends everywhere.
- **Docs** — `docs/user/composer.md` gained the notice-peek section. The frame-rate setting carries
  its own description in Settings and, like upstream, has no separate doc page; Ronin has no user
  documentation of browser recording to extend.

### Not tested

- **A running client.** No dev server or browser was started, per `AGENTS.md`. The native recording
  path in particular is verified by tests and typecheck only — `getMediaSourceId`, `getUserMedia`
  with `chromeMediaSource: "tab"`, and `MediaRecorder` codec selection are all mocked in the suite,
  so the first real capture is worth watching before this ships.

## Batch 23 — reviewed through `b21d87243` (51 commits)

The largest batch so far, and the one with the most load-bearing server work: automatic thread
settlement moved into the server, the Claude model catalog moved into the manifest, and the
Electron 43 recording path was rebuilt. Two commits needed a maintainer decision before they could
be resolved; both are recorded below with the answer that settled them.

### Ported (36)

| Upstream    | Title                                                                         | Notes                                                                                  |
| ----------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `f47e74004` | fix(web): prevent chat metadata overlap (#8851)                               | **adapted** — same four hunks against Ronin's own breadcrumb classes                   |
| `6d15c5bbc` | fix(server): preserve usage cache outside walked roots (#8540)                | clean                                                                                  |
| `41adccc83` | fix(server): allow long thread IDs in HTTP routes (#8898)                     | clean                                                                                  |
| `929f7e647` | fix(shared): preserve Windows shell PATH priority (#8748)                     | **adapted** — Ronin's extra known CLI dirs reordered in all three expectations         |
| `17f00f602` | feat(web): add expand/collapse all control to the files surface (#8889)       | clean                                                                                  |
| `c78ae50a5` | fix(server): isolate remote web session cookies (#8085)                       | **adapted** — see below                                                                |
| `42a8fd510` | feat(pull-requests): link GitHub references in markdown (#8812)               | **adapted** — Ronin's detail panel had no `repositoryUrl`; added one                   |
| `b17cc3d1b` | perf(server): reduce frequency of full tool call output being loaded (#8988)  | clean                                                                                  |
| `d35c71d1b` | feat(web): add pull request list filters (#8809)                              | **adapted** — see below                                                                |
| `ff93aba61` | feat(web): search individual settings by detail (#8831)                       | **adapted** — see below                                                                |
| `73776d4e5` | test: remove static presentation snapshots (#9008)                            | web half only; `menu.test.tsx` deleted, mobile file absent                             |
| `a9ffb8279` | perf(server): bound snapshot activity payload memory (#9000)                  | **adapted** — Ronin already had the `new Set` id refactor; fixture + assertions took   |
| `0bfb6df34` | perf(server): cut idle CPU use and stop provider event leaks (#8187)          | 15 of 19 files clean; four hand-applied                                                |
| `8f1ef8b9e` | perf(server): scan only appended transcript bytes for usage summaries (#9024) | **adapted** — see below                                                                |
| `7e4ce3bbb` | perf(server): cut chatty tool-update frames by 90% (#8368)                    | **adapted** — see below                                                                |
| `f32f9a2f4` | fix(server): settle threads server-side (#8600)                               | **adapted** — see below                                                                |
| `8b033de48` | fix(clients): dedupe skills in composer menus (#8043)                         | **adapted** — dedupe lives in Ronin's `providerSkillSearch`, its only skill-menu entry |
| `62d39bf00` | fix(server): stop OpenCode child sessions (#9005)                             | clean; doc rewritten in Ronin's voice                                                  |
| `3c73fa7ce` | perf(web): defer pull request line stats until visible (#6471)                | **adapted** — `diffStatKey` renamed to `pullRequestDiffStatKey` first                  |
| `e86604d33` | perf(server): skip full-message reads while streaming (#9032)                 | clean but one hunk                                                                     |
| `b883fc066` | perf(client-runtime): halve server config bootstrap traffic (#8367)           | **adapted** — `layerWithOptions` without upstream's relay layer                        |
| `b5b6abb11` | fix(web): block type-to-focus behind open dialogs (#8139)                     | clean — all five slot selectors resolve here                                           |
| `2d156a83b` | feat(shortcuts): copy active thread reference (#8994)                         | **adapted** — see below                                                                |
| `643b21eda` | fix(server): cache project favicon resolution (#9080)                         | clean                                                                                  |
| `c17d02cff` | feat(claude): add Claude Fable 5.1 model (#9078)                              | **adapted** — 200k context default, matching Ronin's other Claude entries              |
| `ef7014d85` | fix(preview): restore recording and macOS rendering after Electron 43 (#9001) | **adapted** — see below. The most important commit in the batch.                       |
| `9d1879b14` | feat(desktop): add configurable quit shortcut confirmation (#9076)            | **adapted** — Ronin's settings row and search entry renamed to "Quit shortcut"         |
| `cb0074691` | feat(web): open project settings from thread menus (#8925)                    | **adapted** — placed before Ronin's Export submenu                                     |
| `035428368` | feat(models): discover Claude models from remote manifest (#9084)             | **adapted** — see below. Maintainer-decided.                                           |
| `692eb1a57` | fix(web): sync sidebar PR state from open panel (#9092)                       | clean                                                                                  |
| `3b3465f2a` | fix(web): changing projects no longer creates a draft (#9097)                 | clean                                                                                  |
| `d0b4acbd1` | fix(web): keep theme placeholder text dimmer than entered text (#9104)        | clean                                                                                  |
| `c0995d2ea` | fix(web): keep the selected environment when changing projects (#9102)        | clean; doc in Ronin's voice                                                            |
| `0222aa255` | fix(web): preserve theme when toggling advanced colors (#8500)                | clean                                                                                  |
| `04efa7907` | feat(cli): open projects in the running desktop app (#8824)                   | **adapted** — see below                                                                |
| `ce71c04f0` | feat(client): render viewed images in work logs (#8936)                       | **adapted** — rebuilt on Ronin's own image plumbing; see below                         |

**`c78ae50a5` (remote web session cookies).** Remote web cookie names are now keyed by the persisted
environment id rather than the state directory, so a moved state dir or a changed public port keeps
the session, and two environments on one hostname stop clobbering each other. `ServerEnvironment`
splits into a `ServerEnvironmentIdentity` service so `SessionStore` and `EnvironmentAuthPolicy` can
read the id without pulling the whole descriptor, and ID initialization is now atomic with a
`.recovery` file. Two Ronin adaptations: `cli/connect.ts` does not exist here (T3 Connect is cut),
and `selectRequestCredential` keeps **Ronin's** credential order — bearer before cookie, with the
written rationale that an ambient cookie must never override an explicit bearer — where upstream
checks cookie first. The unscoped `t3_session` legacy cookie is accepted last and re-issued under
the new name on the next `/api/auth/session` call, so existing remote sessions survive the rename.
Ronin has no DPoP path, so that branch was dropped.

**`d35c71d1b` + `3c73fa7ce` (pull request list).** Taken together because the stats work builds on
the filters. Author and label facets, label chips on rows, and update/creation/size sorts all
landed; line-count reads now happen per visible row through an IntersectionObserver instead of for
the whole loaded list, with size sorts falling back to an eager read because their order needs every
count. Adaptations: Ronin renamed `diffStatKey`, so the stats helpers were retargeted; Ronin's
`Input` has no `compact` size, so the author search field uses `sm`; Ronin's project radio group is
inline rather than in a labelled submenu, so the two filter tests keep their unscoped walk; and the
author/label submenus had to be wired into `PullRequestFiltersMenu` by hand, along with a
multi-key `updateFilters` writer, because Ronin's menu body diverged from upstream's.

**`ff93aba61` (settings search by detail).** The valuable half is per-item `searchTerms`, so "dark
mode" finds Color scheme instead of every Appearance row. Ported with upstream's terms for the 36
catalog entries Ronin shares, a `macOnly` flag for the macOS-only font-smoothing row, and a
`filterAvailableSettingsSearchItems` seam plus a `useAvailableSettingsSearchItems` hook that both
the settings sidebar and the command palette now read. Upstream's other availability dimensions
(`cloudOnly`, `primaryOnly`, `providerSettingsOnly`, `localBackendManagementOnly`,
`wslAvailableOnly`) gate rows Ronin does not have — T3 Connect, publish agent activity, WSL backend,
network access, Tailscale HTTPS — so the seam ships with only the dimension Ronin uses. Settings are
now searchable from the command palette too; Ronin's scoring (title exact/prefix/contains, then item
terms, then page terms) was kept and extended rather than replaced with upstream's flat rank.

**`8f1ef8b9e` (incremental transcript scans).** A grown transcript now re-parses only its appended
bytes: the reader streams buffers rather than `readline` so it can report a byte-exact resume
position, guards the resume with an FNV-1a fingerprint of the 64 bytes before it, and carries the
Codex reducer state across the boundary. Cache entries gained `tailRecords` and `position`, so the
version bumped **3 → 4** (Ronin was already on 3 for its tokenless-Claude change; upstream went
2 → 3). Antigravity reads a SQLite conversation store whole rather than an append-only log, so it
returns `WHOLE_FILE_POSITION` and always cold-parses. `UsageService` also gained upstream's
in-flight scan dedupe and concurrent rate fetch. The new `UsageService` suite asserts **deltas**
rather than absolute token totals: Grok and Antigravity read fixed homes the suite cannot redirect,
so a developer's own transcripts can land in the window.

**`7e4ce3bbb` (tool-update coalescing).** Only the newest in-flight update per stable tool-call id
is sent, cutting the frames a live tool run puts on the wire by ~90%. Ronin does **not** take
upstream's `makeThreadLiveEventCoalescer`, which replaces the live buffer with an unbounded queue:
Ronin's thread stream uses a bounded dropping buffer that fails the stream on overflow so the client
reconnects and resynchronizes, and that protection is deliberate. Instead the pure reducer
(`coalesceLiveToolUpdatedEvents`) moved into `ThreadLiveEventCoalescer.ts` and `ws.ts` runs it
through `Stream.groupedWithin` after the bounded buffer — exactly the shape Ronin already uses for
the shell stream, marker splitting included. All three of upstream's server-level coalescing tests
pass against this implementation; the module's own tests keep the four pure cases and drop the two
that exercised the discarded runtime.

**`f32f9a2f4` (server-side settlement).** The biggest behavior change in the batch. Merge and
inactivity settlement now run in a `ThreadSettlementReactor` on the server against a
`ThreadSettlementPolicy`, so a thread settles with no client attached; `sidebarAutoSettleAfterDays`
and `sidebarAutoSettleOnMerge` moved from client settings to **server** settings, the decider gained
a `thread.auto-settle` command and an `OrchestrationThreadSettleBlockedError`, and the environment
descriptor advertises `threadAutoSettlement`. Adaptations: Ronin's engine keeps its
`SESSION_STOP_SKIPPED_DETAIL` guard, so the rejection check widened to
`isOrchestrationCommandRejection(error) && !isOrchestrationCommandSkippedError(error)` rather than
replacing it; Ronin's **board** (`components/board/`, which upstream has no equivalent of) derived
its Done lane from the deleted client-side `effectiveSettled`, so it now reads
`thread.settledOverride` exactly as the sidebar does; and `canSettle` was **kept** in
`client-runtime`, against upstream deleting it, because the board uses it to grey out a Settle the
server would reject — everything else upstream removed (`effectiveSettled`,
`changeRequestAutoSettles`, `ChangeRequestSettleSource`) went. The auto-settle settings rows are now
gated on the capability, and the `days-before-auto-settle` catalog entry was added so the row that
was previously anchor-less is reachable from search.

**`ef7014d85` (Electron 43 recording).** The commit this batch most needed. Batch 22's uncommitted
recording rewrite runs on `getMediaSourceId` + `chromeMediaSource: "tab"`, which Electron removed in
43 (electron#44618) and which now always rejects with `NotAllowedError` — and Ronin is on Electron
43.4.1, so that work was broken as landed. Recording now arms a tab through
`setDisplayMediaRequestHandler` and the renderer redeems it with `getDisplayMedia()` behind an
`executeJavaScript(..., true)` user gesture, with a 10s arm grace, an exclusive arm slot, and a
`BrowserRecordingStartCancelledError` for a contended start the user stopped. The macOS half came
too: a backgrounded guest keeps its own throttle and hands the capture stream frozen frames, so
`FrameCaptureSession` now tracks `unthrottledWebContentsIds` and un-throttles each guest, restoring
it when capture stops — adapted to Ronin's simpler session shape, which has no picture-in-picture.
`DesktopPreviewRecordingSource` is gone from the contract and `startScreencast` returns `void`.

**`2d156a83b` (copy thread reference).** `mod+shift+c` copies the active thread's PR link, or its
thread id when there is none. Ronin routes it through `runWorkspaceCommand`, which the command
palette also dispatches through, so the action is reachable from the keyboard _and_ the palette
without a second implementation — upstream wires the keydown handler and the palette separately.

**`04efa7907` (`t3 app`).** Opens a directory in the already-running desktop app over a local
socket, adding the project and starting a thread. Two adaptations: `packages/shared` has no
`@noble/hashes` dependency here and adding one would mean a lockfile change, so `shortHash` uses
`node:crypto` (byte-identical output — the first 12 bytes of the same SHA-256); and the CLI test
fixture points at Ronin's default home `~/.ronin`, not `~/.t3`. All user-facing strings say Ronin.

**`035428368` (remote model manifest) — maintainer-decided.** The Claude catalog (names,
capabilities, minimum CLI versions, aliases) moves out of `ClaudeProvider.ts` and into
`model-manifest.json`, fetched at runtime from this fork's `main`. The bundled manifest upstream
ships defaults Fable 5, Fable 5.1 and Opus 5 to the **1M** context window, which reverses Ronin's
deliberate 200k default and its written rationale that 1M requests are usage-weighted at long-context
premium past 200k. The maintainer chose **port, keep Ronin's 200k defaults**: the bundled manifest's
`fable-5`, `opus-5` and `opus-4-6` profiles were edited to make `200k` the default, so all five
context-window profiles now agree with Ronin's existing Sonnet entries. Ronin's manifest therefore
diverges from upstream's permanently, and the remote fetch only serves it once this file reaches the
fork's `main`; until then the bundled copy is the fallback, which is the designed behavior. Claude
slug aliases moved from `MODEL_SLUG_ALIASES_BY_PROVIDER` into per-model `aliases`, so the shared
alias test keeps only its custom-slug and Grok cases. The two Claude transport tests that asserted
against real slugs were replaced with upstream's synthetic-catalog versions, with `argsMustContain`
trimmed to match Ronin's CLI argument order (Ronin inserts `--system-prompt`, `--setting-sources=`,
`--strict-mcp-config` and `--no-session-persistence` before `--dangerously-skip-permissions`).

**`ce71c04f0` (viewed images in work logs).** An image the agent read renders inline in its work-log
row. Upstream builds this on `client-runtime`'s `work-log/presentation.ts` and `markdownImages.ts`,
neither of which exists here — Ronin has no `toolGroupAction`, `summarizeToolGroup`,
`classifyMarkdownImageSource` or `markdownImageSourceFragment`. Rather than import that layer (which
batches 21 and 22 both declined), the feature was rebuilt on Ronin's own plumbing: a new
`workLogViewedImage.ts` detects a read whose detail is a previewable image path and resolves it to
an asset resource using Ronin's `isLocalImageSource` / `localImagePathFromSource` /
`resolvePathLinkTarget`, and Ronin's `WorkspaceMarkdownImage` was generalized into an exported
`ChatMarkdownAssetImage` that takes an `AssetResource`. That generalization is what makes the
attachment case work: an image the user attached and the agent then read back off disk lives under
the T3 home, not the project, so signing it as a workspace file would fail. `PlainWorkEntryRow` now
expands for an image even when it has no text body. `0947c30e6`, the follow-up that fixes upstream's
import path for those helpers, is moot here for the same reason.

### Skipped (15)

| Upstream    | Title                                                              | Reason                                                            |
| ----------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `f8e4accf2` | feat(mobile): add native image and PDF previews (#8959)            | `apps/mobile` only; its two doc hunks are mobile share-sheet copy |
| `9bc7a5684` | feat(mobile): upload attachments while composing (#8978)           | `apps/mobile` only                                                |
| `261380f91` | fix(mobile): keep thread scroll bounds current after animations    | `apps/mobile`, a Legend List patch, and the lockfile              |
| `0df043fd4` | Add auto_review configuration to coderabbit.yaml                   | upstream review-bot config; Ronin has no `.coderabbit.yaml`       |
| `85b656ff3` | style: format CodeRabbit configuration                             | same file                                                         |
| `b21d87243` | chore: vouch six repeat contributors (#9131)                       | upstream contributor governance (`.github/VOUCHED.td`)            |
| `60cef47ec` | chore(release): prepare v0.0.38                                    | Ronin versions independently (0.6.9)                              |
| `c50b0b4ef` | fix(web): make WSL settings searchable (#8881)                     | WSL is a cut surface; see below                                   |
| `9ecfc07a8` | fix(chat): keep agent activity visible between actions (#8984)     | live-activity timeline rows are a cut surface; see below          |
| `a924fbe08` | fix(chat): reuse one row for live activity (#9062)                 | same surface, and reverted upstream by `163d50846`                |
| `163d50846` | Revert "fix(chat): reuse one row for live activity" (#9096)        | the revert of a commit Ronin never took                           |
| `590a579f2` | fix(chat): keep latest command live between messages (#9098)       | same cut surface as `9ecfc07a8`                                   |
| `9dbdcece5` | fix(web): align un-settle banner action (#9033)                    | composer-banner visual layer; see below                           |
| `0947c30e6` | fix(client): use package import for markdown image helpers (#9010) | fixes an import path in a module Ronin does not have; moot here   |
| `beae2147a` | fix(media): preview host files and stream videos (#9023)           | maintainer-decided; see below                                     |

- **`c50b0b4ef`.** Every hunk serves the WSL backend settings row, which Ronin does not render:
  there is no `wslOnly` in `apps/web`, no `desktopWslStateAtom`, no `applyWslEnableSelection`. The
  one generally-useful piece — an effect clamping `activeResultIndex` when the result list shrinks —
  is only needed because upstream's item list changes independently of the query. Ronin resets the
  index to 0 on every keystroke and its results depend on the query alone, so there is no stale-index
  path to fix.

- **`9ecfc07a8` / `a924fbe08` / `163d50846` / `590a579f2`.** All four operate on the `work-live`
  row model — `LiveActivityRow`, `LiveActivityContent`, `LiveWorkEntryTimelineRow` — which Ronin has
  never had (batches 21 and 22 both recorded the absence). Ronin's `MessagesTimeline.logic.ts` has
  no `work-live` row kind at all, and its `working` row already carries no `showThinking`, which is
  the shape `9ecfc07a8` is moving toward. `a924fbe08` was reverted upstream three commits later, so
  the net upstream state is `9ecfc07a8` + `590a579f2`, and neither has a surface here.

- **`9dbdcece5`.** Fixes the alignment of a description rendered as a second `ComposerBanner.Row`
  under the title. Ronin keeps `Alert`/`AlertTitle`/`AlertDescription`/`AlertAction` (batch 22
  recorded the choice), where the description already sits in the same grid as the title with the
  action aligned to the first row — the misalignment being fixed does not exist here.

- **`beae2147a` — maintainer-decided.** Adds HTTP Range streaming for video plus host-file previews
  across clients. Batch 22 skipped upstream's Range support and wrote that streaming rather than
  buffering a whole video "would be a real improvement for remote and Tailscale environments. That
  is a Ronin feature on top of the server change, not a port of it." The maintainer chose **skip**,
  keeping that position: the 33 files present here include `ChatMarkdown`, `ChatView` and
  `MessagesTimeline`, all of which batch 22 also edits, and a straight apply produces 34 reject
  hunks. The server half (`assetByteRange`, `assetFileResponse`, `MediaFile.ts`) remains the natural
  starting point whenever Ronin designs its own streaming.

### Verification

- Whole repository, twice: `vp test run apps/server/src apps/server/integration apps/web/src
apps/desktop/src packages` — **754 files, 8301 pass, 9 skipped, 0 failures.**
- Typecheck: `tsgo --noEmit` in `apps/server`, `apps/web`, `apps/desktop`, `packages/contracts`,
  `packages/shared`, `packages/client-runtime` — 0 errors each.
- `vp lint` over all 259 changed `.ts`/`.tsx` files — clean. `vp fmt --check` over all 263 changed
  files — clean. `git diff --check` — clean.
- One non-reproducing flake was observed: a single unnamed failure in one full-suite run, whose
  stack bottomed out in Effect's `Scheduler.afterScheduled`. Three subsequent full runs of the same
  set passed. It is recorded here rather than attributed, because it was not reproduced and so was
  not tied to a specific test.

**Hit every surface (for this batch):**

- **Entry points** — settlement is reachable from the sidebar row, the thread menu, the chat
  banner and `mod+shift+s`, and all four now read the same server-projected `settledOverride`.
  Copy-thread-reference is reachable from `mod+shift+c` and the command palette because Ronin
  routes both through `runWorkspaceCommand`. Project settings is reachable from the sidebar project
  row and now from the thread action menu. Settings search is reachable from the settings sidebar
  and the command palette.
- **Clients** — the recording rewrite spans desktop (Manager, IPC, preload) and web (renderer);
  `t3 app` spans the CLI, the Electron main process, the preload bridge and the renderer
  coordinator; auto-settle moved from client settings to server settings, so desktop and web both
  read it from the server rather than from their own store.
- **Providers** — only the Claude adapter changed. Its catalog now comes from the manifest, which
  keeps Ronin's 200k context default; every other adapter's models are untouched, and
  `applyModelManifest` still classifies legacy models for all of them.
- **Contracts** — `threadAutoSettlement` capability added; `sidebarAutoSettleAfterDays` /
  `sidebarAutoSettleOnMerge` moved from `ClientSettings` to `ServerSettings`;
  `DesktopPreviewRecordingSource` removed and `startScreencast` returns `void`;
  `QuitConfirmationMode` replaces the boolean `confirmQuit` with a lenient legacy decode;
  `DESKTOP_PREVIEW_RECORDING_CAPTURE_TRIGGER`, `desktopAppActivation.ts` and the `appActivation`
  bridge added. Server, web and desktop all follow.
- **Reverse states** — a settled thread still un-settles, and the server's
  `OrchestrationThreadSettleBlockedError` carries a user-facing message for the case the board's
  `canSettle` pre-check cannot anticipate; a contended recording start cancels cleanly instead of
  toasting; the legacy session cookie is re-issued rather than dropped, so a remote session is not
  logged out by the rename; `t3 app` fails with a named error rather than launching anything.
- **Connection modes** — the cookie change is specifically about remote-reachable hosts, and
  desktop/loopback naming is unchanged; `t3 app` refuses SSH sessions because a remote shell cannot
  focus a local window; the settlement reactor runs server-side, which is the point — a thread on a
  remote environment settles with no client attached.
- **Docs** — `docs/user/thread-sidebar.md` gained the server-settlement section,
  `docs/user/install.md` the `t3 app` section, `docs/user/source-control.md` the PR filter/sort
  line, `docs/user/composer.md` the project-change note, `docs/user/keybindings.md` the
  `thread.copyReference` entry, `docs/user/providers-opencode.md` the Stop-a-turn section,
  `docs/internals/remote.md` the atomic environment-id paragraph, and
  `docs/internals/resource-telemetry.md` the revised sampling cadence.

### Not tested

- **A running client.** No dev server or browser was started, per `AGENTS.md`. Two areas are
  verified by tests and typecheck only and are worth watching first:
  - **Recording on Electron 43.** `setDisplayMediaRequestHandler`, the `getDisplayMedia()` redemption
    and the per-guest throttling are all mocked in the suite. This path replaces work batch 22 has
    not shipped, and it is the batch's highest-value change, so a real capture is the thing to try.
  - **The remote model manifest.** The bundled copy is exercised; the fetch from the fork's `main`
    cannot resolve until this manifest is committed and pushed there. Until then the documented
    fallback order (remote → last on-disk copy → bundle) serves the bundle, which is correct but
    means the remote path itself is unverified.
- **`native/resource-monitor/src/main.rs`.** `0bfb6df34` patches it and it applied clean, but no
  Rust build was run.

## Batch 24 — reviewed through `ef6cc0b36` (97 commits)

The largest batch so far. Two decisions were escalated and are recorded under **Maintainer
decisions** below.

### Ported (66)

| Upstream    | Title                                                                              | Notes                                                                              |
| ----------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `9a7b1e21e` | perf(provider): bound persisted session lookups (#8909)                            | clean; the fake directory in the new test carries Ronin's ledger methods           |
| `ea71a19d4` | fix(claude): skills picked from the composer now run (#9128)                       | **adapted** — see below                                                            |
| `feb3ea7eb` | fix(web): use the Oniguruma WASM highlighter (#8360)                               | clean                                                                              |
| `c2283ce14` | perf: make streaming projection and activity appends incremental (#9152)           | **adapted** — Ronin's `queuedPrompt` clearing moved into the new message-sent case |
| `7e460f429` | fix(server): bound orchestration replay payloads (#8992)                           | clean                                                                              |
| `6866fd6b5` | perf(client-runtime): keep turn and checkpoint refs stable while streaming (#9145) | clean                                                                              |
| `fc53b2730` | perf(clients): lease sidebar status by visibility (#9052)                          | clean; `LegacySidebar` is a cut surface                                            |
| `8efd4e95f` | fix(settings): sync auto-settle and other shared preferences (#9147)               | **adapted** — Alert action uses Ronin's `size="xs"`                                |
| `0e77fbd3d` | fix(server): prevent accidental service downgrades (#5302)                         | clean; strings and docs in Ronin's voice                                           |
| `716069f40` | fix(server): keep attachments until the command commits (#7941)                    | clean; the relay harness test has no surface here                                  |
| `d0b19b32e` | fix(claude): preview images read from the workspace (#9119)                        | **adapted** — see below                                                            |
| `cdbf324aa` | fix(web): keep generated muted foreground dimmer than entered text (#9113)         | clean                                                                              |
| `083d4de5b` | fix(clients): stop repeating expanded commands (#9120)                             | **adapted** — see below                                                            |
| `80c708a1f` | perf(web): halve the cold-start bundle (#9058)                                     | **adapted** — see below                                                            |
| `c37fd136e` | test(server): measure shell, second client, and reconnect transfer (#9157)         | clean                                                                              |
| `0e1570bde` | fix(web): project default model works on the hosted app (#9142)                    | **adapted** — see below                                                            |
| `8401f4d85` | fix(web): darken neutral control surfaces (#9064)                                  | **adapted** — tokens live in Ronin's `styles/tokens.css`                           |
| `f2a914b85` | fix(web): preserve panel state across workspace refreshes (#8968)                  | clean                                                                              |
| `fea1af81f` | fix(web): compact project settings actions (#9160)                                 | **adapted** — Ronin's `SettingsPageContainer` has no `width` prop                  |
| `47a95332a` | fix(web): browse folders from file breadcrumbs (#8910)                             | **adapted** — `isAbsolutePath` exported from `terminal-links` for the new module   |
| `9fdafdf11` | feat(pull-requests): copy provider checkout commands (#9086)                       | **adapted** — `size="micro"` → `xs`                                                |
| `2ab7973fe` | fix(web): hide build pill in narrow sidebars (#9159)                               | **adapted** — kept Ronin's explicit grid column for the masthead                   |
| `e7deb2aaf` | feat(web): cite assistant responses with inline citations (#9146)                  | **adapted** — see below. The biggest port in the batch.                            |
| `941acb4f9` | fix(provider): drop removed custom models from the model picker (#9075)            | clean                                                                              |
| `a1a2bb1cd` | fix(web): label keybinding condition removal actions (#8664)                       | clean                                                                              |
| `cde12790d` | fix(contracts): accept legacy pull request checkout results (#8238)                | clean                                                                              |
| `b8262b412` | fix(desktop): hold-to-quit no longer gets stuck (#9141)                            | clean                                                                              |
| `133db22fa` | feat(web): copy the full error report from the error page (#9166)                  | clean                                                                              |
| `43bafd467` | fix(web): open PR toast actions in app (#9006)                                     | clean                                                                              |
| `082358f9e` | fix(desktop): check artifact build prerequisites (#8975)                           | **adapted** — see below                                                            |
| `0681d8549` | fix(pull-requests): expand code tab diffs by default (#9174)                       | clean                                                                              |
| `535c83dea` | fix(web): copying a code block no longer copies triple backticks (#8448)           | clean                                                                              |
| `5392c9bb9` | fix(models): restore sticky new-thread selections (#9164)                          | **adapted** — migration renumbered 044 → **052**                                   |
| `827345a07` | fix(web): model info button opens its details on click (#9177)                     | clean                                                                              |
| `7a8df3338` | fix(desktop): skip cached monitor compiler check (#9184)                           | **adapted** — its test hand-inserted after `082358f9e`                             |
| `d2042d288` | fix(web): avoid stale file writes on close (#8630)                                 | clean                                                                              |
| `4116db980` | fix(server): bound OpenCode version probes (#8750)                                 | clean; Kilo's `cliSpec` seam kept in the test mock                                 |
| `a56b0cd71` | fix(server): allow large Azure DevOps PR lists (#8572)                             | clean                                                                              |
| `a81a52afb` | fix(server): allow local-only worktree bases (#8751)                               | **adapted** — the fix lives in Ronin's `prepareThreadWorktree` helper              |
| `6ff537f03` | fix(web): remove projects with archived threads (#8798)                            | clean; `LegacySidebar` is a cut surface                                            |
| `a19f01fc1` | feat(web): make context window indicator opt-in (#9190)                            | **adapted** — one row added to Ronin's smaller Legacy features section             |
| `dd6879ffe` | fix(pull-requests): reuse github api reads (#9176)                                 | clean                                                                              |
| `14f15cfed` | fix(server): stop titling linked PR threads from local git history (#9191)         | clean                                                                              |
| `5b7d72aad` | feat(updates): continue active threads across server restarts (#9167)              | **adapted** — boot-service half only; see below                                    |
| `f14f41b89` | fix(web): preserve composer draft during worktree setup (#9197)                    | clean                                                                              |
| `70cd258d8` | fix(web): prevent two-digit list markers from being clipped (#9101)                | **adapted** — CSS lives in Ronin's `styles/markdown.css`                           |
| `6e3bac372` | fix(web): prevent connection rows from wrapping during removal (#8706)             | clean                                                                              |
| `57a66608b` | fix(pull-requests): align checkout control with author (#9196)                     | **adapted** — see below                                                            |
| `2a7a449cc` | fix(web): hide deleted providers with prototype keys (#8337)                       | clean                                                                              |
| `8d5b712de` | fix(desktop): exclude opposite macOS pty prebuilds (#9240)                         | **adapted** — only the `resolveMacFileExclusions` half; no WSL/asar sidecar here   |
| `b57726ca8` | feat(web): add copy path button to diff headers (#2403)                            | **adapted** — `size="icon-micro"` → `icon-xs`; wired into both diff views          |
| `f90e2f2bd` | fix(server): subscribe before provider settings watcher (#9271)                    | clean                                                                              |
| `5a9b56291` | fix(web): warn when shared settings have no target environment (#9207)             | clean                                                                              |
| `28ddaf759` | fix(web): confirm closing agent-controlled browsers (#9272)                        | clean                                                                              |
| `134d51096` | feat(desktop): browser profiles for the preview browser (#7254)                    | **adapted** — see below                                                            |
| `ca63d42d6` | refactor(shared): move the node:sqlite Effect SQL client into shared (#7272)       | **adapted** — Ronin has more migration tests; every import site rewritten          |
| `91c8d4771` | feat(web): add opt-in panel animations (#8830)                                     | **adapted** — see below                                                            |
| `ba3cb0773` | feat(projects): automatically pull clean default branches (#9277)                  | **adapted** — migration renumbered 045 → **054**                                   |
| `fb93902ee` | feat(web): add proactive panels (#9276)                                            | clean once the host was found (Ronin's `WorkspaceShell`)                           |
| `064392ffc` | fix(web): offer browser profiles from the empty-panel launcher (#9279)             | **adapted** — `variant="ghost-muted"` → `ghost`                                    |
| `c742edd46` | fix(web): show scroll-to-end as soon as the last message slips under the composer  | clean                                                                              |
| `994bd7373` | fix(cursor): honor auto and full access modes (#9283)                              | clean                                                                              |
| `4ba39a6f4` | fix(desktop): detect installed Spectre libs for Windows builds                     | clean, on top of `082358f9e`                                                       |
| `443b4ebfe` | fix(pull-requests): missing features & better behaviour (#9188)                    | **adapted** — see below                                                            |
| `2971ec320` | fix(server): preserve automatic settlement timestamps (#9254)                      | **adapted** — migration renumbered 046 → **053**                                   |
| `dbc7bfa3f` | fix(opencode): show Reasoning selector for OpenCode models (#9287)                 | clean                                                                              |

**`ea71a19d4` (Claude skills actually run).** A `$skill` chip anywhere in a Claude prompt is now
split into `[leading text, "/name trailing text"]` so the CLI expands it natively
(`ClaudeSkillDispatch.ts`), `.agents/skills` is no longer scanned because Claude Code answers it
with `Unknown command`, the user root now wins name collisions, and `skillOverrides` plus
`disable-model-invocation` / `user-invocable` are read. Adaptations: Ronin has no
`client-runtime/providerSkills`, so `isProviderSkillUserInvocable` lives in Ronin's
`providerSkillSearch.ts` — its only skill-menu entry, matching batch 23's decision. Ronin also had
no prompt-position gating at all: rather than porting upstream's
`slashCommandItemsForPromptPosition` (which lives in a dead `composerSlashCommandSearch.ts` here),
the gate went straight into `ChatComposer`'s menu builder, so provider commands such as `/compact`
are offered only when they open the message while built-ins and skills stay available anywhere.

**`d0b19b32e` (Claude image reads).** The server now classifies a Claude `Read` of an image as
`image_view` and projects the path as `data.imagePath`. Ronin's viewed-image plumbing is its own
(`workLogViewedImage.ts`, batch 23), so `WorkLogEntry.viewedImagePath` was threaded through
`session-logic.ts` and Ronin's `workEntryViewedImagePath` now prefers it over the row's detail —
which is what makes a truncated `Read: {"file_path":"…"}` summary still resolve to a picture.
Upstream's `toolGroupAction` change has no surface here.

**`083d4de5b` (expanded commands stop repeating themselves).** An expanded command row now reads
`Command` instead of echoing the command that is already the first line of its body, Claude Bash
results cross the wire as a bounded summary, and a synthetic echo is told apart from real output.
Upstream builds the last part on `client-runtime/work-log/presentation`, which Ronin does not have,
so `commandDetailRepeatsCommand` and `extractCommandOutputText` were inlined into Ronin's
`session-logic.ts`. Ronin's `MessagesTimeline` keeps its `heading - preview` collapsed label and
only swaps to `Command` when the row is expanded.

**`80c708a1f` (cold-start bundle).** Route components are split chunks
(`tanstackRouter({ autoCodeSplitting: true })`) prefetched on navigation intent, the settings nav
and theme editor load lazily, and `main.tsx` holds the index.html splash until `router.load()`
resolves so a cold open never flashes an empty window. A `vite:preloadError` listener reloads once
per failure streak behind a sessionStorage guard. Ronin has no Clerk, so the managed-auth split is
dropped and the boot only waits on the router; the build now emits 593 chunks with `ChatView` in
its own.

**`0e1570bde` (project settings on secondary environments).** Project provider instances and model
options now come from the project's **own** environment rather than the primary, which is a real
multi-environment fix here too. `SettingsRow` gained `serverScoped`, which makes a row inert with
an explanation where there is no primary to write to, and `useUpdateSettingsTarget` toasts instead
of dropping the write. Ronin's `AboutVersionSection` is GitHub-releases based and has no in-app
installer, so that hunk has no surface.

**`e7deb2aaf` (inline citations).** Select text in an assistant response, choose **Cite in
composer**, and an inline quote chip lands at the cursor with an optional comment bubble; selecting
a chip navigates back to the source passage and highlights it. Adaptations: Ronin's
`AssistantCitationSource` wrapper is nested **inside** its "Show markdown source" branch, so the
source toggle keeps working; `ComposerCitationNode` uses Ronin's inline-chip decorator class rather
than upstream's `COMPOSER_INLINE_CHIP_DECORATOR_CLASS_NAME`; `AssistantSelectionToolbar` uses
`variant="secondary"` because Ronin's Button has no `glass`; the `::highlight()` rules moved to
Ronin's `styles/base.css`; and `ComposerPromptEditor`'s citation context wraps Ronin's
`composer-editor-surface`, which carries the appearance font-size preference. `docs/internals/
assistant-citations.md` is indexed in `docs/README.md`.

**`082358f9e` (+ `7a8df3338`, `4ba39a6f4`, `8d5b712de`) (artifact build preflight).** The desktop
artifact script now checks its Linux/macOS/Windows prerequisites before starting a build and
reports every failure together with an install command. Ronin bundles no WSL runtime, so the
Windows check passes `bundlesWslRuntime: false` outright instead of upstream's `bundlesWslRuntime({
arch, prebuildPath })`; the three preflight tests were hand-inserted because Ronin's test file has
diverged, and `mockProcess` grew a stdout channel for the `rustc --print target-libdir` probe.

**`5392c9bb9` / `2971ec320` / `ba3cb0773` (migrations).** All three add a migration, and Ronin's
numbering has diverged well past upstream's. They were renumbered **052**
(`ClearAutomaticProjectModelDefaults`), **053** (`RepairAutomaticSettlementTimestamps`) and **054**
(`ProjectionProjectsAutoPull`), with their tests' `toMigrationInclusive` bounds moved to match.
`053`'s test also had its `@t3tools/shared/nodeSqliteClient` import pointed at Ronin's location
until `ca63d42d6` landed later in the batch.

**`5b7d72aad` (threads continue across a server restart).** A self-update now marks its running
provider turns at the `installing` stage and continues them once the replacement process is up, with
the markers cleared again if the update fails before the launcher accepts the handoff. Ronin took
the **boot-service** half: it has no `apps/server/src/desktopUpdate/DesktopAppUpdate.ts`, so
`withRunningThreadContinuation` drops `commitDesktopUpdate` and the desktop continuation-token set
entirely, and became a plain function returning the wrapped service (nothing left to `yield`). The
two desktop-only tests were removed and the two thread-continuation ones kept. `ServerUpdateAction`
gained `threadContinuation` but not `desktopAppUpdate`, and the client setting
`continueThreadsAfterServerUpdate` is off by default as upstream ships it.

**`57a66608b` (checkout control placement).** The checkout command moves off the branch row and onto
the author/updated meta line as a shared `PullRequestCopyableCode`. Ronin's branch pill markup is
its own (`bg-muted px-2 py-1`), so the pill was left alone and only the chip relocated.

**`134d51096` + `064392ffc` (browser profiles).** Named browser profiles with their own Electron
partitions, switchable per tab and offered from the tab bar and the empty-panel launcher.
Adaptations: `variant="ghost-muted"` → `ghost` in two places (Ronin never took upstream's
control-geometry pass — same note already in `IntegrationsSettings.tsx`), `RightPanelTabs` needed a
`Button` import, and Ronin's `PreviewChromeRow` gained upstream's `leadingActions` slot while
keeping its own address-bar markup and its optional picture-in-picture.

**`91c8d4771` (opt-in panel animations).** Panels open and close immediately by default; a
**Panel animations** slider (0–400 ms) opts in. The important adaptation is `ui/sidebar.tsx`:
upstream animates offcanvas on `left`/`right`, Ronin animates it on `translate` with a written
rationale that moving the largest subtree in the app by position relayouts and repaints it every
frame. Ronin keeps `translate` and its spring easing, and only the gating moved to
`[data-panel-animations=true]`. Since Ronin animated panels unconditionally before, the net effect
is strictly less repainting. The `data-panel-animations` host and `--panel-animation-duration` are
set on Ronin's `WorkspaceShell` (upstream uses `AppSidebarLayout`, which is cut here).

**`443b4ebfe` (pull request features).** Auto-merge, a stable merge-state slot, a checkout menu on
the pull-request page, and list preferences that persist. Adaptations: the `warning-outline` Button
variant was added without upstream's `secondary` hover retune, the filter-count pill keeps Ronin's
dot indicator, `action-required` checks use Ronin's `--status-attention` token instead of raw
`amber-*`, and the sidebar entry keeps Ronin's `leaveOrOpen` guard while reading the new stored
preferences.

### Maintainer decisions (2)

- **HTML and PDF in the file viewer — take the viewer, keep skipping the media foundation.**
  Batch 23 skipped `beae2147a` (host-file media serving + Range video streaming). Upstream then
  stacked `f46a709ee` (open markdown/HTML/PDF **outside** the workspace), `d937e3075` (render HTML
  and PDF in the viewer) and `775129984` (preview document attachments) on it. The maintainer chose
  the **viewer only**: `d937e3075` was rebuilt on Ronin's existing `workspace-file` asset, so an
  HTML or PDF file **inside** the workspace renders in place with a source toggle for HTML, and
  `f46a709ee`'s security half came with it — inline HTML now carries
  `sandbox allow-scripts allow-forms allow-popups allow-modals` (it previously had none) and `.pdf`
  is served as `application/pdf` so a framed preview renders under `nosniff`. Skipped from the
  group: the `media-file` asset resource, host files outside the workspace, video, `MediaVideoPlayer`
  / `MediaActions`, and inline document attachments. `beae2147a` remains the starting point whenever
  Ronin designs its own streaming.

- **`b2f25d390` (update the desktop app on remote Macs) — skip.** It is built on upstream's
  `apps/desktop/src/updates/` state machine and `apps/server/src/desktopUpdate/DesktopAppUpdate.ts`;
  Ronin replaced both with its own smaller `apps/desktop/src/app/DesktopAutoUpdate.ts`. Porting it
  is a 41-file re-implementation (prepare/commit handoff, lost-commit retry, backend and window
  recovery), not a port. The maintainer chose to leave it for a Ronin-native design. The
  boot-service restart continuity from `5b7d72aad` is in.

### Partially ported (4)

| Upstream    | Title                                                               | What was taken                                                                     |
| ----------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `08aad594f` | chore: delete dead code, unused deps, and duplicate helpers (#9129) | only the deletions proved dead here; see below                                     |
| `98725df00` | fix(web): mute routine notices and update actions (#9063)           | the `variant="outline"` button changes; see below                                  |
| `a434677ec` | fix(grok): health check, model selection, and stop (#9154)          | the adapter and ACP runtime fixes; Ronin's Grok probe is ahead of upstream's       |
| `db4bf9497` | chore: remove unused code and brittle tests (#9150)                 | the `ProviderAdapterRegistry` deprecated-API removal and one brittle-test deletion |

- **`08aad594f`.** An upstream-wide dead-code sweep whose dead set differs here: 45 of the 74 shared
  files had already diverged, 29 of the 103 are mobile, and several of the removed test helpers are
  still used by Ronin's larger suite. Ported only what was verified unreferenced in this tree:
  `historyBootstrap`, `orchestrationRecovery`, `orchestrationEventEffects`,
  `lib/terminalUiStateCleanup` (with their tests), the unused `ui/card`, `ui/fieldset` and
  `ui/form`, `SplashScreen`, `ui/button.test.tsx` (a render-to-static-markup test Ronin's own
  `AGENTS.md` forbids), the `msw` dependency and its worker, and the two dead probe scripts. The
  helper extractions (`expandHomePathWith`, `isProcessAlive`, `withInstanceIdentity`) were left for
  whenever a later port needs them; nothing in this batch did.

- **`98725df00`.** Upstream mutes routine update notices to neutral, which guts the `--update`
  palette entry. Ronin's `--update` / `--update-surface` / `--update-foreground` are theme-driven
  (`--app-theme-update-*`) and have other consumers (the model list's NEW badge), so the token
  muting was skipped and only the half that does not depend on them was taken: routine **Update**
  actions are now `variant="outline"` rather than `default`, in
  `ProviderUpdateEnvironmentRows`, `ServerUpdateAction`, `ProviderUpdatePrimaryNotification` and
  `ProviderInstanceCard`. Ronin has no `ComposerBanner`, `DesktopUpdateStatusIcon` or
  `SidebarUpdatePill`.

- **`a434677ec`.** The valuable half is the adapter: a `sendTurn` during an in-flight prompt now
  cancels that prompt and steers the same turn (epochs, an exclusive `promptLifecycle` semaphore,
  and a `dispatched` deferred so a later cancel targets the right RPC), plus the ACP runtime,
  `XAiAcpExtension` and `effect-acp/protocol` changes. Upstream's other half re-introduces
  `grok-build` as a product slug and replaces the health check with `grok models` + a bare ACP
  `initialize`. Ronin deliberately removed that slug (with a written rationale that the installed
  CLI ignores `-m grok-build`) and its `probeGrokViaAcp` already does a full authenticated ACP
  start that reports models **and** sign-in state — strictly more than upstream's new probe. Those
  files, and the `docs/internals/providers.md` section describing upstream's design, were left
  alone.

- **`db4bf9497`.** Another dead-code sweep. Taken: `listProviders` and `streamChanges` off
  `ProviderAdapterRegistry` (verified unused here — the `streamChanges` hits in this tree all belong
  to other services), the matching test-mock trim, and `ChangedFilesTree.test.tsx`. Ronin's
  `MessagesTimeline.test.tsx`, `ComposerPrimaryActions.test.tsx` and `-chatIndexTitlebar.test.ts`
  have diverged and their coverage is not upstream's, so those deletions were left.

### Already in the tree (1)

- **`1eb36b45e` (pull request state icons in tabs).** Ronin already colours the tab icon by pull
  request state; it reads `pullRequestStatuses` pushed from the open panel through
  `updatePullRequestTabStatus`. Upstream's change is a refactor to a self-fetching
  `PullRequestSurfaceIcon` that deletes that plumbing, and it collides with Ronin's `onStateChange`
  and `chromeVariant="collapse"` props. The user-visible behaviour is identical, so the refactor was
  reverted rather than adopted.

### Skipped (22)

| Upstream    | Title                                                                   | Reason                                                       |
| ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `5014e5fcd` | fix(desktop): show newest changes in nightly previews (#9138)           | 15 of 17 files are upstream's `updates/` module; cut surface |
| `e9db39ce0` | fix(web): align composer notices and stash (#8890)                      | composer-banner layout; see below                            |
| `b520120cf` | fix(chat): improve tool group summaries and scrolling (#9106)           | tool-group summary row model; see below                      |
| `c15735dd8` | fix(chat): replace failed tools with thinking (#9165)                   | same surface as `b520120cf`                                  |
| `8339508f5` | fix(chat): align failed task progress test (#9172)                      | asserts on `work-live` rows Ronin has never had              |
| `46b5c6640` | fix(chat): show single tool calls without summaries (#9267)             | same surface as `b520120cf`                                  |
| `80a14b658` | fix(server): discover project skills for Codex and OpenCode (#8778)     | superseded by Ronin's skills catalog; see below              |
| `bc918e74a` | fix(server): discover project skills for Claude (#9210)                 | same                                                         |
| `15fea6c5f` | fix(providers): discover workspace skills everywhere (#9180)            | same                                                         |
| `9e646ad84` | fix(connect): refresh relay credentials before expiry (#9178)           | Ronin has no DPoP variant in `PreparedHttpAuthorization`     |
| `6effe0a2f` | feat(web): redesign provider editor and models list (#8508)             | upstream control scale; see below                            |
| `b59b7d0af` | fix(web): unify control sizing across settings pages (#9281)            | same                                                         |
| `535557b3f` | feat(providers): add context compaction across harnesses (#8808)        | reverted upstream three commits later by `63f334baf`         |
| `63f334baf` | Revert "feat(providers): add context compaction across harnesses"       | the revert of a commit Ronin never took                      |
| `f9d1c65d4` | chore: bump vendored GhosttyKit and update terminal integration (#9155) | `apps/mobile/modules/t3-terminal` only; no shared file       |
| `7e9d5a7ef` | fix(mobile): prevent message and composer overlap (#9195)               | `apps/mobile` only                                           |
| `62c68dc41` | fix(mobile): show filled filter icon on Android (#9217)                 | `apps/mobile` only                                           |
| `9159b808d` | feat(mobile): long-press file references (#9258)                        | `apps/mobile` plus one mobile-only line in `composer.md`     |
| `b5a09e13f` | fix(release): pin patched expo-sharing version (#9250)                  | `apps/mobile` release pinning                                |
| `aab404964` | fix(ci): keep Expo Sharing patch applied (#9248)                        | same                                                         |
| `e94603adf` | chore(ci): narrow the UI consistency check-run agent (#9297)            | `.macroscope/` check-run agents; upstream CI governance      |
| `ef6cc0b36` | chore(ci): only run check-run agents on vouched contributors (#9298)    | same                                                         |

- **`e9db39ce0`.** Its substance is upstream's one-line "comfortable" `ComposerBanner` layout, with a
  hover popover for the description on narrow panels. Ronin replaced that component with
  `Alert`/`AlertTitle`/`AlertDescription`/`AlertAction` (batch 22), where title and description
  already stack. The shortened copy (`"It may be finishing an update. One moment."` →
  `"Finishing an update"`) and the ghost button variants only make sense inside the one-line
  layout, so the whole commit reads as noise here.

- **`b520120cf` / `c15735dd8` / `46b5c6640`.** All three operate on upstream's collapsed
  tool-group summary model — `summarizeToolGroup`, `toolGroupSummaryKind`,
  `resolveWorkEntryToolPresentation`, and the `work-live` row kind. Ronin's `work-toggle` row is a
  plain "show N more" control with no `summary` or `summaryKind`, and `MessagesTimeline.logic.ts`
  has never had `work-live` (batches 21–23 all recorded the absence). There is nothing here for the
  changes to land on.

- **`80a14b658` / `bc918e74a` / `15fea6c5f`.** These add a per-cwd `snapshotForCwd` to each driver
  so a provider CLI is probed for project skills — a 20-second Codex app-server spawn or an
  OpenCode server connect per workspace. Ronin already discovers project skills for **every**
  provider from the filesystem in `apps/server/src/provider/skillsCatalog.ts`: it walks every
  ancestor of the cwd for each provider's native skills folder (including Cursor's `skills-cursor`)
  plus `.ronin/skills` and the bundled packs, and the composer reads it through
  `useEnvironmentSkillsCatalog(environmentId, gitCwd)`. Upstream's mechanism is superseded, and
  `15fea6c5f`'s `ChatComposer` hunk only retries the `workspaceSnapshots` this design introduces.

- **`6effe0a2f` / `b59b7d0af`.** Both retune upstream's control-size scale across the settings
  pages — `size="compact"`, `size="micro"`, `variant="ghost-muted"`, `Badge size="control"` — none
  of which Ronin's `Button`, `Switch` or `Badge` have (Ronin uses `xs`/`sm`/`icon-xs`, and its
  `ghost` already sets `--control-icon-color: var(--muted-foreground)`; the note is already written
  in `IntegrationsSettings.tsx` from batch 4). `6effe0a2f` also rebuilds provider cards Ronin has
  diverged on. Taking either would mean inventing a control scale to match, which is a Ronin design
  decision rather than a port.

### Verification

- `vp test run apps/web/src apps/server/src apps/desktop/src packages` — **761 files, 8686 tests,
  8 skipped, 0 failures.** Run four times end to end.
- Typecheck: `tsgo --noEmit` in `apps/server`, `apps/web`, `apps/desktop`, `packages/contracts`,
  `packages/shared`, `packages/client-runtime`, `scripts` — 0 errors each.
- `vp lint` over all 373 changed files — clean. `vp fmt --check` over the same set — clean.
  `git diff --check` — clean.
- `vite build` in `apps/web` succeeds and emits 593 chunks with route-level code splitting, which
  is the thing `80c708a1f` is for.
- One non-reproducing failure was seen in two of six full-suite runs and did not repeat; its stack
  bottomed out in Effect's `Scheduler.afterScheduled`, the same shape batch 23 recorded. It is
  logged rather than attributed, because it was never tied to a named test.
- **Pre-existing, unrelated:** `vp test run scripts` also collects
  `.github/scripts/thread-transfer-report.test.cjs`, which is a `node:test` CJS suite vitest cannot
  read ("No test suite found in file"). It passes under `node --test`, the file is untouched by this
  batch, and the batch-23 command set did not include `scripts`.

**Hit every surface (for this batch):**

- **Entry points** — citations are reachable from the selection toolbar, the composer chip, and a
  sent message's chip, all routed through the same `AssistantCitationSource`. The HTML/PDF viewer
  toggle sits beside the existing rendered-Markdown toggle and next to "Open in preview browser".
  Browser profiles are reachable from the tab-bar `+` menu, the per-tab more-menu, the empty-panel
  launcher, and Settings → Integrations. Proactive panels, panel animations, the context-window
  indicator and "Continue threads after server updates" are all reachable from Settings and from
  the command palette's settings search.
- **Clients** — the restart-continuity work spans server (`serverRuntimeStartup`, `selfUpdate`,
  `ProviderService`) and web (`ServerUpdateAction`, `ChatView`, Connections); browser profiles span
  desktop (IPC, preload, `BrowserSession` partitions) and web; the sidebar visibility lease and the
  bundle split are renderer-only but apply to desktop, which embeds it.
- **Providers** — Claude gained skill dispatch, `skillOverrides`, and image-read classification;
  Grok gained steer-cancels-prompt; OpenCode gained a bounded version probe, process-group kill and
  the Reasoning selector; Cursor gained auto/full access modes. Codex is unchanged this batch.
  `promptlessTurnContinuation` was added to the adapter capability shape and set on Codex, so a
  resumed turn does not get a synthetic prompt.
- **Contracts** — `serverUpdateThreadContinuation` capability; `continueRunningThreads` on
  `ServerSelfUpdateInput`; `continuation` on `ProviderSendTurnInput`; `userInvocationOnly` and
  `userInvocable` on `ServerProviderSkill`; `headRepositoryNameWithOwner` on the PR contract;
  `AssistantCitation`; `BrowserProfile`; `contextWindowMeterEnabled`,
  `continueThreadsAfterServerUpdate`, `proactivePanelsEnabled` and `panelAnimationDurationMs` on
  client settings; `SHARED_SERVER_SETTING_KEYS` in client-runtime.
- **Reverse states** — a citation can be removed from the draft and its comment cleared; a browser
  profile can be removed and its storage cleared; panel animations return to 0 ms; the context
  window indicator and proactive panels are switchable back off and reachable from Restore
  defaults; a failed self-update clears its continuation markers; a shared-settings mismatch has an
  **Apply to all** action and a warning when there is no target environment; an inert
  `serverScoped` row explains itself rather than silently dropping the write.
- **Connection modes** — the shared-settings sync writes to every _connected_ environment and warns
  about the ones that drifted, which is the multi-environment case; the sidebar visibility lease and
  the `idleTtlMs` grace periods cut websocket traffic on remote and Tailscale links specifically;
  project settings now read providers from the project's own environment rather than the primary.
- **Docs** — `docs/user/composer.md` gained the commands-and-skills section (previously an empty
  heading), model defaults, quoting an assistant response, and the HTML/PDF viewer;
  `docs/user/providers-claude.md` the revised skill locations and `skillOverrides`;
  `docs/user/thread-sidebar.md` the shared-settings paragraph and panel motion;
  `docs/user/updating.md` the thread-continuation preference; `docs/user/background-service.md` the
  downgrade refusal; `docs/user/project-settings.md` automatic pulls; `docs/user/source-control.md`
  proactive panels; `docs/internals/overview.md` shared server settings and deferred attachment
  side-effects; `docs/internals/scripts.md` the build prerequisites; and
  `docs/internals/assistant-citations.md` is new and indexed in `docs/README.md`.

### Not tested

- **A running client.** No dev server or browser was started, per `AGENTS.md`. Worth trying first:
  - **Inline citations.** The selection toolbar, the highlight navigation across loaded history,
    and the comment bubble are covered by unit tests only.
  - **The HTML/PDF file viewer.** The sandbox CSP and `application/pdf` headers are asserted in
    `http.test.ts`, but no browser has actually framed a workspace HTML page or PDF.
  - **Browser profiles.** Partition isolation is unit-tested; opening two tabs in different profiles
    and confirming they do not share cookies needs the real Electron shell.
  - **Panel animations.** Ronin keeps `translate` for the offcanvas sidebar where upstream moved to
    `left`/`right`; the 0 ms default and the slider need a look on a high-refresh display.
- **A packaged desktop build.** `scripts/build-desktop-artifact.ts` gained ~380 lines of preflight
  and the macOS prebuild exclusion, all covered by unit tests against a mocked spawner. No real
  `dist:desktop:*` run was made, so the preflight has never actually gated a build.

## Batch 25 — reviewed through `c5ba51d62` (110 commits) — reconstructed

**This entry was written after the fact.** Commit `47efad150` ("sync upstream batch 25 through
c5ba51d62", 266 files, +12 628/-1 829) shipped the work but never touched this log, so the
watermark still read `ef6cc0b36` when batch 26 started. The verdicts below were derived from that
commit's contents plus a presence check against the tree — they are coarser than a live triage and
should be read as a record, not as a fresh review.

### Ported

The bulk of the range landed: SSH host resolve/suggest dropdown, preview CDP debugger pinning,
pairing credentials scrubbed from access read models, the desktop second-press quit fallback,
environment machine-kind detection and icons, project icons (migration `055 ProjectionProjectIcon`),
pull request label management, diff layout/whitespace and `a/`+`b/` prefix fixes, Google Antigravity
via the official ACP agent, Codex async questions, the settings-page reorganisation, PageUp/PageDown
chat navigation, and the provider context-compaction command (`c5ba51d62`).

### Skipped — cut surfaces

`apps/mobile`, `apps/marketing`, `apps/relay` and `.macroscope` commits, as always.

### Not ported, and not previously recorded

These three were silently absent from the tree. Batch 26 depends on all of them, so they are
written down here rather than left to be rediscovered. Each was confirmed by sampling the commit's
own added lines against the tree (2/57, 9/101 and 1/35 present respectively — the residue is
shared context, not the change):

| Upstream    | Title                                                          | Consequence                                                        |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `5b8445b7a` | fix(web): collapse the resting composer (#7855)                | Ronin has no resting/collapse-on-blur composer                     |
| `19d8ab2ae` | feat(usage): show Codex and Claude subscription limits (#9507) | Ronin shows rate limits only in the sidebar usage meter            |
| `39449e53e` | feat(desktop): import browser cookies into a profile (#7255)   | no cookie import at all; `ff5843410`, `498ab9c39`, `3653cb22f` too |

### Verification

Not re-run. `47efad150` is the implementation record; the batch-26 verification below covers the
tree as it stands with both batches applied.

## Batch 26 — reviewed through `761d4bac1` (306 commits)

Upstream's `#9539`–`#10100` window. Four decisions were put to the maintainer before any code was
written, because each gates a cluster and none has an obvious default; all four came back "skip and
record". They are the first four entries under **Skipped** below.

### Ported

Roughly 140 commits landed, most of them adapted rather than replayed. The ones worth naming:

**Server.** File Explorer reveals normalized paths (`617edab65`); newly opened pull requests are
found after an agent turn (`4e547318b`) and PR data refreshes after thread turns (`5cc369b7e`,
which adds a `pullRequests.subscribeRefreshes` streaming RPC — written by hand into Ronin's
`rpc.ts`, which has no `baseSchemas` import upstream relies on); inactive threads with open PRs
settle (`d536b0580`);
checkpoints detect nested Git workspaces (`0dd5c64bc`) and resume after `git init` (`c843c1929`);
turn checkpoints are captured after all edits finish (`7a089b2b2`); duplicate desktop clients are
replaced in one transaction after a restart (`eb77683e5`); copied
native update commands are shell-quoted (`d28077e58`); native provider executable paths survive
updates (`2d5464afb`); the integrated terminal advertises truecolor (`89ee69e44`); Claude safety
model fallback notices are surfaced instead of dropped (`a5bbad910`); retired Codex models are
dropped after a refresh (`bfef973d9`) and GPT-6-Astra is marked current (`bc03c3640`).

**Server performance.** Thread summaries no longer load message bodies (`8ac546292`); projector
cursor writes are batched (`2263e13fd`); OpenCode tool history and tool parts are no longer
retained (`f2e3764c2`, `c8f77e0d4`) and repeated progress logs are omitted (`ec8b2119c`); terminal
history stops being rebuilt per chunk (`3bbbc1d9f`) and is bounded by bytes (`cf9729d5e`);
buffered provider events use one query (`dffb4cd3b`); checkpoint summaries avoid full patches
(`c163d502d`); Linux process detail reads are
skipped when unused (`163d86a78`); static web assets are cached and streamed (`27e6cc27f`).

**Web.** The thread error banner no longer shifts the chat (`3e2c1a66f`); the snooze menu stops
overlapping thread details (`93c3ab4ff`); draft pull requests render in gray (`caab2fdba`); PR
authors link to their profiles (`a76b898b3`); the PR Code tab's worker chunk is deferred until a
reader approaches it (`110bbe6b5`); reselected diff files are revealed (`6b87ce3a0`); changed files
became a persistent folder tree (`dd7bc147f`); PR project filter choices are deduplicated
(`e5a87e8b9`); saved colors reload when the theme editor reopens (`caf4981e3`); text copies over
plain HTTP (`03c6cd8ba`); file comment focus is restored in editable preview (`13427ecd8`);
markdown widgets reset when the previewed file changes (`3e1333319`); retained runtime diagnostics
show in the work log (`1246146f5`); sidebar tooltip titles stop clipping (`485782b2a`); the
composer preserves original mention text (`761d4bac1`); automatic pull resets to its default
(`f6db42062`); threads can be unpinned from the sidebar multi-select menu (`c7bf3115f`).

**Cross-cutting.** Custom model names and option descriptors (`5a433244d`); POSIX file links respect
case (`8faf031c2`); the Windows test-portability series (`cc60753aa`, `4701041ee`, `30f128fab`,
`5c6c1d67d`, `c251e41b5`, `f083f520f`, `12b6d026b`, `1108be0fc`, `9af5139f5`, `9fa54eeb4`,
`b123cbb31`) plus the Windows fixes it guards (`5f4c7161f` media path
canonicalisation, `781f41ef1` symlinked theme files); SSH managed servers exec without npm wrappers
(`f33fdc992`) and remote install failures are reported accurately (`39802c061`); the CLI resolves
projects with missing workspace directories (`9cb40178a`); `tool.denied` is in the runtime event
types (`b7d6e6502`); PATH probing skips duplicate entries (`c3caceade`); preview automation waits
and screenshot captures are bounded (`de1b798c6`); warm thread resumes stay live instead of
flashing sync (`f87ecf0cc`).

#### Adaptations worth knowing about

- **`5a433244d` (custom model names).** Upstream changed six `customModels` schemas; Ronin has nine
  (Droid, Kilo and Pi as well), and all nine moved to `CustomModelSetting` in both the settings and
  the patch schemas. The inline `CustomModelEditor` was wired into Ronin's existing model row
  rather than upstream's rebuilt one, and its controls were remapped from upstream's
  `compact`/`icon-micro`/`ghost-muted` scale — which batch 24 deliberately declined — onto Ronin's
  `sm`/`icon-xs`/`ghost`.
- **`5a2f3ebf6` (segmented controls).** Ronin's `toggle.tsx` had no `segmented` variant, so one was
  written in Ronin's flattened idiom (no `before:` highlight, no shadow, colour-only transition,
  `--control-radius`) instead of copying upstream's. The `ProviderSettingsPanel` device-tab hunk was
  dropped: it belongs to the skipped Limits-tab layout work. `GitActionsControl` has no publish
  dialog here, so that hunk had nothing to land on.
- **`caab2fdba` (draft PRs in gray).** Upstream hard-codes `text-zinc-500 dark:text-zinc-400/80`.
  Ronin already had a `--vcs-draft-foreground` token, so the draft state uses
  `text-vcs-draft-foreground` and the tests assert that instead.
- **`dd7bc147f` (persistent folder tree).** Ronin's card carries a `durationLabel` upstream does not
  have; the collapse control went away as upstream intends, but the duration stayed and now renders
  in the new sticky header.
- **`0dd5c64bc` (nested Git workspaces).** Taken in `CheckpointReactor`, which now asks
  `checkpointStore.isGitRepository` instead of the synchronous `apps/server/src/git/Utils.ts` helper.
  The `ProviderRuntimeIngestion` call site kept the synchronous helper — routing it through the
  store made `consumes P1 runtime events into thread metadata, diff checkpoints, and activities`
  time out waiting for thread state — so `git/Utils.ts` stays rather than being deleted as upstream
  does.
- **`27e6cc27f` (static asset caching).** Upstream's `openStaticFile` streaming path was merged
  _around_ Ronin's `realPath` canonicalisation, so a symlink pointing out of the static root is
  still rejected rather than served with a year-long cache header.
- **`61a91b6ef` (grouped image views).** Its Grok hunk calls `normalizeGrokReasoningEffort` and a
  `requestedTurnReasoningEffort` that predate this range and do not exist here; the turn's reasoning
  effort is read the same way the session-start path already reads it.
- **`d7cf8aaa8` / `f87ecf0cc` (thread streams).** Applied together — the first landed only its
  supporting files on the first pass and left `threads.ts` behind, which is what made the warm
  resume flash sync.
- **`887ece307`'s test dependency.** `react-test-renderer@19.2.8` and its types were added to
  `apps/web` devDependencies. Ronin had dropped the package with batch 25's markup-only test
  removal, but three commits in this batch use it for real mount/unmount behaviour (Lexical
  serialisation, diff worker lifecycle, file-save coordination) rather than static-markup
  assertions, so the dependency is back and the tests came with it.

### Already in the tree

- **`d76b24dd1` (Codex async questions).** Listed as a batch-25 gap during triage and then
  disproved: every sampled line of the commit is present. Recorded here so it is not re-checked.
- **`108f295cc` (bound slow-client event buffers)** — in substance. Ronin already bounds live
  buffers with its own `makeBoundedLiveBuffer` and per-stream coalescers from batch 24. See
  **Skipped** for why upstream's rewrite was not taken on top.

### Skipped

**Asked, and decided by the maintainer.**

| Cluster                     | Commits                                                                                         | Reason                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Resting composer follow-ups | `54aef6fbe` `3c3e05ccf` `f239b77df` `9e1bc36a0` `f559fe0ba` `720e126b7` `c1d27e593`             | Ronin has no resting composer (batch 25's `5b8445b7a`)                     |
| Usage / Limits tab          | `1641b4aba` `394e8470c` `84b99f3fb` `7ee52b077` `f1e90e388` `98a29cbaa` `8357eef14` `764946502` | Ronin has no Limits tab (batch 25's `19d8ab2ae`)                           |
| First-run welcome wizard    | `09aac7156`                                                                                     | 122 files, +15 526; a new onboarding surface, deferred as its own decision |
| Safari cookie import        | `ed2bdbb27`                                                                                     | builds on the cookie-import stack Ronin never took                         |

**Cut surfaces (40 commits).** `apps/mobile`, `apps/marketing`, `apps/relay`, `.macroscope` and
`.github`-only changes, as every batch.

**T3 Connect (4 commits).** `39abb9d1d`, `99e3b721c`, `2dca7a1ed`, `363cde411`. DPoP credential
refresh, relay authorization and headless-setup diagnostics for a surface this fork removed. Their
test files applied on the first pass and were reverted along with the rest.

**Upstream's Knip sweep (71 commits).** `126ea5c3b` configures Knip, `d2c3e2e5d` and
`4631000f5`/`cd92a7e7a` gate CI on it, and the rest are the dead-code removals and
`export`-narrowings it found. Ronin has no Knip config and a different usage graph, so these are
upstream hygiene against upstream's own graph — and `AGENTS.md` asks a sync not to fold in
opportunistic cleanup. `4a42fc62e` ("prune unused UI and provider code") is in the same class.

**Structural conflicts with Ronin's own design.**

| Upstream                            | Title                                                                    | Why not                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `887ece307`                         | perf(web): keep Markdown mounted during streaming (#9677)                | Rewrites a 433-line block of `ChatMarkdown` into 507 lines around a new renderer context. Ronin's copy is 274 lines diverged; the merge was not something to land unverified in the hottest render path.                                                                                                                                                                                                        |
| `95103905f` `eced382b4`             | PR link previews; stable chat media size                                 | Both wire into `887ece307`'s structure. `PullRequestLinkPreview.tsx` and `ui/preview-card.tsx` were removed rather than left orphaned.                                                                                                                                                                                                                                                                          |
| `108f295cc` `50bfca43d` `ce4712d5b` | slow-client buffers; per-thread replay; restore UX                       | Replace Ronin's `makeBoundedLiveBuffer` + coalescer backpressure design wholesale. Applying `50bfca43d` alone deadlocked two `server.test.ts` overflow tests at the 120 s timeout.                                                                                                                                                                                                                              |
| `b906ce2d7`                         | fix(server): recover opted-in threads after machine restarts             | Ported, then reverted. The source landed and moves `continueThreadsAfterServerUpdate` from client to server settings, but its 641-line `serverRuntimeStartup.reconcile.test.ts` rewrite does not merge onto Ronin's, and minimal fixture edits left two tests hanging on a deferred at the 120 s timeout. Worth redoing with the test rewrite done deliberately.                                                |
| `fce850845`                         | fix(server): surface a missing workspace folder instead of a spawn error | Ported, then reverted. `startSession` now stats the workspace before dispatching, which is right, but it fails 18 existing tests that start sessions in synthetic cwds. Upstream's test rewrite creates real temp directories; Ronin's fixtures need the same treatment before this can land.                                                                                                                   |
| `d7fe47fd0`                         | fix(server): dismiss native questions when their turn ends               | Its `ProviderRuntimeIngestion` hunk reads a `ServerSettingsService` this file does not acquire here, and it arrived through the same conflicted merge as `fce850845`.                                                                                                                                                                                                                                           |
| `6365919f2`                         | perf(server): skip history reads for metadata commands                   | Swaps the metadata path's full-thread read for a shell read. Ronin's `ProviderCommandReactor` uses the full thread in 18 places downstream, so the swap does not stand alone here.                                                                                                                                                                                                                              |
| `0a590fa01`                         | test(scripts): keep Windows packaging checks host-portable               | Half of it targets `scripts/lib/cli-external-packages.test.ts`, which this fork does not have; the remainder did not merge onto Ronin's `build-desktop-artifact.test.ts`.                                                                                                                                                                                                                                       |
| `01f3e50ec`                         | fix(server): unblock OpenCode approvals and stop                         | Its `opencodeRuntime`/`OpenCodeAdapter` hunks do not merge onto Ronin's, which passes a `cliSpec.serverReadyPrefix` the upstream parser no longer takes; the approval option it adds needs a `warning` field this fork's contract lacks; and two of its ingestion tests assert an `enableLegacyTokenStreaming` server setting Ronin does not have. Its `ProjectionPipeline` and `session-logic` hunks did land. |
| `2fb99a7a6` `c7dc3cbd0` `2271a27da` | installer-owned provider updates; mise/Homebrew follow-ups               | Ronin already resolves maintenance per installer via `resolveProviderMaintenanceCapabilitiesEffect`; the rest is a restructure across an installer set (vite-plus, mise) the fork has diverged on.                                                                                                                                                                                                              |
| `560afffde`                         | fix(server): update Claude Agent SDK to 0.3.260 (#9135)                  | Needs the dependency bumped from 0.3.227 for `terminal_reason` / `api_error_status` to exist. Worth doing as its own change, with the SDK upgrade verified on its own.                                                                                                                                                                                                                                          |
| `940e8233c`                         | fix(claude): surface usage-limit pauses in the thread (#7165)            | Imports `claudeUsageLimits.ts`, a module from before this range that Ronin never took.                                                                                                                                                                                                                                                                                                                          |
| `1587f248d`                         | feat(server): measure provider turn token usage (#9132)                  | Reports into an `AnalyticsService` / `apps/server/src/telemetry` that does not exist here.                                                                                                                                                                                                                                                                                                                      |
| `2e688a53c` `9e1fb459a`             | docs: restructure internal and user guides                               | Rewrites 30 and 23 doc files against upstream's own doc set, including files for cut surfaces. Ronin's `docs/` split already follows the audience rule these commits introduce.                                                                                                                                                                                                                                 |

**Landed as a logic module with no wiring, so backed out.** `4d3907f63` (highlight visible settings
sections), `fd773172e` (recall sent prompts with the up arrow) and `ce4712d5b`'s `visibleAnimation`
helper each brought their pure module and tests but not the component edits that use them — those
hunks target `SettingsSidebarNav`/`routes/settings.tsx`, `ChatComposer`, and the panel-animation
callers, all of which Ronin has diverged on. An unimported module is worse than an absent feature,
so the modules were removed with the rest of each commit.

**Small UI commits that did not survive contact.** `d7884ce90` `2b10398cc` `2e61301b1`
(settings-sidebar chrome), `bf40fa786` (wordmark baseline), `c3b8825bf` (tool icons on failed
calls), `4cc800c75` `120fab18d` `8e056a0e5` (composer/palette layering), `14bf3f6d1` (Cmd+S stash
toggle), `c7c1dfe4d` (stop continuous chat status animations), `7d5dc66c1` (composer helper text),
`935917f50` (running tool label shine), `389bbcc8d` (toggle thumb inset), `7f8cf30ca` (sidebar
project action a11y), `bc8584bf8` (keybinding notice spacing), `be7796d86` (agent spawn row
scaling), `45bd3b631` (mute background working threads), `cfc9bf341` (fold single trailing
activity), `19c1710a8` (timeline row reuse), `15eda897d` (defer image URL requests), `b34ff8f56`
(dedupe CLI proxy accounts), `5f878d2a8` (fold context compaction), `087cfb8ae` (Cursor symlinked
skills), `2152d44de` (OpenCode workspace skills via SDK).
Each targets a component Ronin has rewritten, and each is small enough to be redone directly rather
than merged. `c7c1dfe4d` is the one to revisit first: `AGENTS.md` is explicit about continuously
repainting animations, and it is worth confirming by hand whether Ronin's chat status still has any.

### Verification

Run per workspace, because the repo-root vitest project does not carry `apps/web`'s
`assetsInclude: ["**/*.wasm"]` and the Ghostty terminal tests cannot resolve their wasm there.

| Scope                     | Result                                        |
| ------------------------- | --------------------------------------------- |
| `packages/contracts`      | 351 tests, 0 failures                         |
| `packages/shared`         | 442 tests, 0 failures                         |
| `packages/client-runtime` | 521 tests, 0 failures                         |
| `packages/ssh`            | 42 tests, 0 failures                          |
| `apps/desktop`            | 494 tests, 0 failures                         |
| `apps/web`                | 3 836 tests, 328 files, 0 failures            |
| `apps/server`             | 3 499 tests, 276 files, 8 skipped, 0 failures |
| `scripts` (packaging)     | 33 tests, 0 failures                          |

- Typecheck: `tsgo --noEmit` in `packages/contracts`, `packages/shared`, `packages/client-runtime`,
  `packages/ssh`, `apps/web`, `apps/desktop`, `apps/server` — 0 errors each.
- `vp lint` over every changed `.ts`/`.tsx` — clean. `vp fmt --check` over every changed source and
  doc — clean. `git diff --check` — clean outside `patches/`, whose vendored pnpm patch is
  byte-identical to upstream's (its `space before tab` warnings are upstream content, and the
  lockfile's `patch_hash` matches upstream's).

**Pre-existing, unrelated.** `apps/server/integration/orphanedProviderSessionStartup.integration.test.ts`
fails to typecheck at HEAD too (`GitVcsDriver` missing from the expected Effect context, TS2375 +
TS377004). Batch 25 introduced it; this batch neither fixed nor worsened it. Everything else in
`apps/server` typechecks.

**How the server suite was verified.** It takes ~35 minutes and was re-run after every
correction; three rounds of it caught defects the per-file runs had missed — a receipts queue wired
to `RuntimeReceiptBusLive` (a deliberate no-op) instead of `RuntimeReceiptBusTest`, `01f3e50ec`'s
tests landing without its `opencodeRuntime` source, and `61a91b6ef`'s Codex hunk not routing
`CodexDeveloperInstructions` through the shared `buildRuntimeInstructions`. Running it once at the
end would not have been enough.

**Not tested.** No client was started, per `AGENTS.md`. Worth a look first:

- The **segmented toggle** written for this fork — the variant is new here, so its rest, hover and
  pressed states have only ever been read, not seen. It is now the `ToggleGroup` default, which
  reaches the diff layout switch, the PR code tab, the PR markdown editor, the theme editor and both
  diagnostics windows.
- The **custom model editor** in Settings → Providers, including the new pencil affordance on custom
  rows and the inline editor beneath them.
- **Changed files as a persistent tree** — the collapse control is gone and the duration label moved
  into the sticky header.
- **Draft pull requests** rendering through `--vcs-draft-foreground` in the sidebar and PR list.
- The **PR Code tab's deferred chunk**: it now loads on hover or focus of the tab rather than on
  panel mount, so a slow first open is the thing to watch for.

## Batch 27 — reviewed through `b155c2199` (82 commits)

A small range by count, but a lopsided one: half of it is upstream's Knip/test-hygiene sweep and
its mobile work, and the four commits that would have been the most user-visible turned out to rest
on a subsystem this fork never took.

### Ported (23)

**Provider and server correctness.**

| Upstream    | Title                                                                     | Notes                                                                              |
| ----------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `311f05c8e` | fix(server): install pinned runtime when pnpm node lacks npm (#9923)      | clean                                                                              |
| `0d8a91a25` | fix(cursor): cache successful model discovery between refreshes (#9918)   | **adapted** — kept `getCursorFallbackModels` exported; upstream made it private    |
| `4ca71463a` | fix(opencode): revert from the first removed assistant message (#9924)    | clean                                                                              |
| `050690d1b` | fix(server): settle threads using actual pull request terminal timestamps | **adapted** — one hunk re-indented onto Ronin's formatting of `PullRequestService` |
| `e2e6ce6a2` | feat(server): report image dimensions with signed asset URLs (#10198)     | **adapted** — see below                                                            |

**Desktop and connections.**

| Upstream    | Title                                                                    | Notes                                                      |
| ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `60e1b7394` | fix(desktop): separate LAN and Tailscale pairing endpoints (#9882)       | clean — a Tailscale-only host now stays network-accessible |
| `420fd76f6` | feat(connections): balance new threads across connected machines (#9895) | **adapted** — see below                                    |

**Client runtime.**

| Upstream    | Title                                               | Notes                   |
| ----------- | --------------------------------------------------- | ----------------------- |
| `bd16b86d5` | fix(client-runtime): report terminated thread loads | **adapted** — see below |
| `eee05575e` | fix(clients): persist project icons across reloads  | **adapted** — see below |

**Web.**

| Upstream    | Title                                                              | Notes                                                                           |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `89bd6376d` | fix(web): align tool disclosure chevrons with expanded state       | clean — only `PlainWorkEntryRow`, as upstream scoped it                         |
| `d92dca74e` | fix(web): resume imported custom-provider threads (#10184)         | **adapted** — source clean; tests rewritten, see below                          |
| `f8b4c464b` | test(web): cancel pending highlight fixture frames during cleanup  | clean — a real fixture leak, not a styling-assertion removal                    |
| `d0f855bfa` | fix(web): size the chat image slot from server-reported dimensions | **adapted** — see below                                                         |
| `54441e63d` | fix(web): copy provider update commands from compact rows (#9888)  | **adapted** — Ronin's `icon-xs`/`ghost` scale and `--vcs`-style update token    |
| `f12d39359` | fix(ui): unify loading and refresh feedback across clients (#9561) | **adapted** — see below                                                         |
| `2c3353578` | fix(web): keep timestamp tooltip dates in English (#10256)         | clean                                                                           |
| `3da9399b1` | fix(web): let authorized clients scrolling reach settings (#10080) | clean — Ronin's `ScrollArea` already had `chainVerticalScroll`                  |
| `add8c3a55` | fix(web): remember usage page selection (#10189)                   | **adapted** — `cost`/`tokens` only; no `limits` metric here                     |
| `84aebb72f` | fix(web): respect reduced motion in shared disclosures (#10258)    | clean                                                                           |
| `4f782beda` | fix(web): prevent file tree search focus ring clipping (#10175)    | **adapted** — Ronin centralises the rule in `chrome.css`, see below             |
| `272d6d747` | feat(markdown): show the GitHub mark for github.com links (#10324) | **adapted** — web hunk only; the mobile native module is not a surface here     |
| `127efae44` | fix(web): expose error disclosure state (#10125)                   | **adapted** — `ExpandableText` is private to `DiagnosticsSettings` in this fork |
| `55333833e` | fix(web): name combobox chip removal targets (#10127)              | clean                                                                           |

#### Adaptations worth knowing about

- **`e2e6ce6a2` (image dimensions).** Upstream reads the header through `assets/MediaFile.ts` and a
  `media-file` asset resource, neither of which exists here. `packages/shared/src/imageDimensions.ts`
  and the `AssetImageDimensions` contract were taken verbatim; the read itself was rewritten against
  Ronin's `FileSystem` (`stat` → `open` → `readAlloc`) and hung off the two resources this fork does
  have, `workspace-file` and `attachment`. The `stat` guard replaces upstream's non-blocking open:
  a path swapped for a FIFO is rejected rather than blocking the request.
- **`d0f855bfa` (chat image slot).** Ronin's `ChatMarkdownAssetImage` has none of upstream's
  `standalone`/`MediaActionSource` structure and no `authoredImageSizeStyle`, so a private
  `knownImageSizeStyle` was written with upstream's height-cap-folded-into-`max-width` trick. The
  one caller that passed `style={{ maxHeight: "16rem" }}` now passes `maxHeightRem={16}`.
- **`bd16b86d5` (terminated thread loads).** The `onDefect` hook and the error-preserving guards
  landed as upstream wrote them. `markSynchronizing` did not: upstream clears the diagnostic at the
  start of every retry, which is invisible behind its fixed 250 ms retry but not behind Ronin's
  `threadSubscriptionRetryDelay` backoff — `threads-sync.test.ts` asserts the opposite, and a reader
  would sit in front of an unexplained spinner for seconds. Split the two cases instead: an
  automatic retry of an already-reported failure keeps its diagnostic, and retires it only once that
  retry delivers a value; a defect or a new session still starts clean. Two refs carry this,
  `retryingExpectedFailure` (set by `onExpectedFailure`) and `retryRetiresError` (set at the next
  attempt's start, so values still draining from the failed attempt cannot consume it). All of
  upstream's new tests and all of Ronin's pass unchanged.
- **`eee05575e` (project icons).** `projectFaviconCache.ts` came over whole, minus its dependency on
  `mediaMimeType` from upstream's much larger `filePreview.ts`; a private `faviconMimeType` maps the
  eight workspace image extensions instead. `createProjectFaviconUrlAtomFamily` was rewritten
  against `resolveAssetUrl`, since the `AssetUrlState`/`assetUrlStateFromResult` abstraction lives
  in `apps/web/src/assets/assetUrls.ts` here, not in `client-runtime`.
- **`d92dca74e` (imported custom-provider threads).** The `deriveLockedProvider` change applied
  clean. Its tests did not: they sit inside a `resolveComposerProviderSelection` suite for a
  function this fork does not have. Two focused tests were written against Ronin's existing
  `deriveLockedProvider` suite instead — one for catalog resolution, one asserting a started thread
  with a missing instance does not fall back to the picker's driver.
- **`420fd76f6` (load balancing).** The scoring module, the `hostResources` RPC and the settings
  panel are upstream's. Three things differ: `ws.ts` took only the `HostResources` import (upstream
  also pulls in `AnalyticsService` and `UsageLimitSources`, neither of which exists here);
  `LoadBalancingSettings` uses Ronin's `SettingsSection`, which takes a `title` and no
  `description`, so the section copy moved onto the first row; and `BranchToolbar` kept Ronin's
  `isMobile` branch rather than upstream's `@3xl/composer-surface` container queries, taking only
  the `autoEnvironmentLabel`/`onAutoEnvironment` props. The doc section became its own
  `## Balancing New Threads Across Machines` in `docs/user/remote-access.md` rather than landing
  mid-sentence inside the headless-server walkthrough, and its mobile paragraph was dropped.
- **`f12d39359` (loading and refresh feedback).** Upstream backs its new `Spinner`/`RefreshIcon` on
  `lib/visibleAnimation.ts`, an IntersectionObserver that also parks off-screen animations — the
  module batch 26 backed out of `ce4712d5b` for having no callers. It was not reintroduced. Ronin
  already owns this concern in `styles/motion.css`, whose header is explicit that anything looping
  forever carries `.loops-forever` and that the fix is "the class rather than a rule"; adding a
  second mechanism would contradict it. `Spinner` and the new `RefreshIcon` are built on
  `loops-forever` instead, and all 24 ad-hoc `animate-spin` call sites were converted. This gets
  upstream's unification and its window-hidden parking, but **not** its off-screen parking — worth
  revisiting as its own change, with the `visibleAnimation` question decided on purpose.
- **`4f782beda` (focus ring clipping).** Upstream raises the inline preview subheader from `h-7` to
  `h-9` on `FileBrowserPanel` itself. Ronin hoisted that rule into `chrome.css` for every
  `[data-surface-subheader]` in the inline right panel, so the fix went there. It is a wider blast
  radius by construction — the file browser search, the preview chrome row and the file preview
  header all share it — and all three have focusable controls the 28 px row was clipping.

### Already in the tree

- **`bc028738a` (name the editor picker accurately).** `OpenInPicker` already carries the
  unconditional `aria-label="Choose editor"` this commit introduces.

### Skipped

**Cut surfaces (17 commits).** `apps/mobile` and `apps/marketing` only: `6a8f4d3b8`, `7451d17a6`,
`3fb8942a4`, `1cb49c3df`, `7eda989d3`, `579a77588`, `89cc7434f`, `b438447f6`, `bfba77816`,
`b2e15185a`, `b7465a3bc`, `a49538558`, `d924fe266`, `e5d086c26`, `b155c2199`. `fc7ad2eda` targets
`LegacySidebar.tsx` and `8d3c56b48` its mobile shortcut label; neither file exists here.

**Upstream's Knip sweep, continued (14 commits).** `29c3a54a4` `3fbc497b7` `62ed748ac` `cb9a69423`
`0671e3427` `dbfd51731` `5716dec97` `50bc62a83` `2ae3b712b` `5fe5c6fe9` `fdcc491e0` `226abe5f9`
`1200f530b` `da2ba5b81`. Same reasoning as batch 26: upstream hygiene against upstream's usage
graph, and `AGENTS.md` asks a sync not to fold in opportunistic cleanup.

**Upstream's test-hygiene sweep (14 commits).** `47e250a84` `a324cabc0` `88fc41c1b` `748fe0f8b`
`585ce2c2a` `f93aafcc2` `a9fc4dc2b` `b972f1c1d` `f1e84c28f` delete styling assertions and narrow the
exports they reached through — the same class of change, and Ronin already removed its markup-only
tests in batch 25. `76f686d03` (Clerk), `cabac780f` `0c200c5f8` `b4040d9bf` (WSL) and `181e45110`
target cut surfaces. `f8b4c464b` was taken instead, because it fixes a real fixture leak.

**Antigravity's ACP auth architecture (3 commits).** `6349a0e68`, `c8872fd22`, `ab67795dd`. Ronin's
Antigravity driver probes `agy --version` / `agy models` and never reports an authenticated account;
it has no `AntigravityAuth.ts`, no `antigravityAuthSupport.ts`, no ACP session files and no profile
directory. `carrySavedAntigravityAccount` would never fire, the `session/new` error message has no
producer, and the `~/.gemini` skill-linking commit targets a `profileDirectory` indirection this
fork does not use — `skillsCatalog.ts` already reads `~/.gemini/config/skills` directly.

**Other absent surfaces.**

| Upstream    | Title                                                         | Why not                                                                                                   |
| ----------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `2c301fd0c` | fix(shared): validate cloudflared with the version subcommand | `packages/shared/src/relayClient.ts` is part of the hosted relay this fork removed.                       |
| `c2cfe59ac` | fix(web): defer browser discovery in integrations             | Ronin's `BrowserProfilesSetting` has no cookie-import wizard, so there is no eager scan to defer.         |
| `aea9ecbc4` | fix(web): make task row states readable                       | No `ComposerTasksBadge` here.                                                                             |
| `3be90ced4` | fix(web): align provider header action sizes and spacing      | Targets `editorHeaderAction` and the `icon-micro`/`ghost-muted` scale, neither of which exists here.      |
| `82689782e` | fix(web): explain hosted connection prerequisites             | Rewrites the empty state around `cloudEnabled` / T3 Connect sign-in copy for a surface this fork removed. |

**The usage-limits stack (4 commits) — asked, and decided by the maintainer.** `183c34330`
(`/usage-limits`), `be53bbd85` (remaining quota), `b273d1cfe` (pooled limits), `00d6109cb` (fixture
cleanup). The first triage read these as ~3 200 lines of self-contained feature. They are not: Ronin
has none of the foundation they extend, and none of it is in this range. Missing here are
`contracts/providerUsageLimits.ts`, `contracts/usageLimitSourceId.ts`, `shared/usageLimits.ts`,
`server/usage/UsageLimitSources.ts`, `server/usage/cliproxyUsageLimits.ts`,
`server/provider/providerUsageLimits.ts`, `server/provider/Layers/claudeUsageLimits.ts` (already
declined in batch 26), `server/provider/Layers/codexUsageLimits.ts`, `web/usage/UsageLimits.tsx` and
`web/settings/AddUsageLimitSourceDialog.tsx` — about 1 800 lines before the wiring into
`providerSnapshot.ts`, `contracts/server.ts`, `contracts/settings.ts` and `shared/serverSettings.ts`.
Taking it would mean importing a whole subsystem no commit in this range reviews. Deferred as a
scoped follow-up: the foundation first, then these four, verified on their own. `add8c3a55` was
taken, since it needs none of it.

**Deferred as its own change.** `9f40b2f56` (feat(settings): add shared project defaults and scoped
overrides). 38 files, +2 237: a new Settings → Projects route, a `ProjectDefaultsSettings` panel,
per-project scoped overrides in server settings, and a 1 060-line rewrite of `ProjectSettingsPanel`,
which this fork has diverged on. Its `WelcomeWizard` hunk has nothing to land on. Worth doing
deliberately rather than inside an 82-commit sync.

### Verification

Run per workspace, for the same reason as batch 26.

| Scope                     | Result                                       |
| ------------------------- | -------------------------------------------- |
| `packages/contracts`      | 354 tests, 0 failures                        |
| `packages/shared`         | 450 tests, 0 failures                        |
| `packages/client-runtime` | 557 tests, 50 files, 0 failures              |
| `apps/desktop`            | 498 tests, 54 files, 0 failures              |
| `apps/web`                | 3 854 tests, 329 files, 0 failures           |
| `apps/server`             | 3 550 tests, 282 files, 9 skipped, 1 failure |

- Typecheck: `tsgo --noEmit` in `packages/contracts`, `packages/shared`, `packages/client-runtime`,
  `packages/ssh`, `apps/web`, `apps/desktop` — 0 errors each. `apps/server` reports 2, both the
  pre-existing ones below.
- `vp lint` over every changed `.ts`/`.tsx` — clean. `vp fmt --check` over every changed source and
  doc — clean. `git diff --check` — clean outside `patches/`, unchanged from batch 26.

**Pre-existing, unrelated.** `apps/server/integration/orphanedProviderSessionStartup.integration.test.ts`
both fails and fails to typecheck at HEAD (`GitVcsDriver` missing from the expected Effect context,
TS2375 + TS377004). Confirmed by stashing this batch and re-running the file at HEAD. Batch 25
introduced it; batch 26 recorded the typecheck half. This batch neither fixed nor worsened it.

**Not tested.** No client was started, per `AGENTS.md`. Worth a look first:

- The **spinner and refresh unification** — 24 call sites moved onto two shared components, and
  `Spinner` changed glyph (`Loader2Icon` → `LoaderCircleIcon`). The refresh affordances now spin in
  place instead of being swapped out, which is the visible change; check the toast loading state,
  the PR check "Running" glyph and the diff/file-tree refresh buttons.
- **Load balancing** end to end: Settings → Connections → Load balancing, then a new draft in a
  project grouped across two environments, including the composer's "Auto balance" menu entry.
- **Chat images** reserving their box from server-reported dimensions — the win is the absence of a
  layout shift, so it only shows on a slow first load.
- **Project icons** surviving a reload and a reconnect, which is the whole point of `eee05575e`.
- The **provider row's update affordance**: the compact row's select target is now an overlay
  button behind the content, so tabbing and clicking around the new copy control is worth a check.

## Batch 28 — reviewed through `e1230d603` (84 commits)

Reviewed `b155c2199..e1230d603`, snapshotted at `e1230d6031bc55a21668818d0b585d8887b88579` for the whole run. The worktree already carried uncommitted batch-27 ports (load balancing, host resources, favicon cache, settlement policy). Those were preserved and later ports layered on top.

No commit needed a product Ask. Usage-limits follow-ups stay skipped on the same deferred foundation as batch 27. Onboarding wizard commits skip because this fork has no `WelcomeWizard`.

### Ported (51)

**Release / CI**

| Upstream    | Title                                                                     | Notes                                                             |
| ----------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `7544d3d2c` | fix(release): space automatic nightlies at least six hours apart (#10272) | new `check-nightly-release.cjs`; cron `8,38 * * * *`              |
| `001f06d54` | feat(ci): ship stable releases from the latest nightly commit (#10410)    | **adapted** — `resolve_commit` job; dropped Connect/WSL job hunks |

**Server correctness and perf**

| Upstream    | Title                                                                                      | Notes                                                              |
| ----------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `4c7cd17a8` | refactor(server): share Claude result status and error mapping (#10296)                    | `resultOutcome`; unknown `terminal_reason` follows subtype         |
| `f66cfe221` | fix(server): settle inactive threads without a PR lookup (#10103)                          | inactivity settles before any host lookup                          |
| `60e6fa30c` | fix(ssh): report remote stop failures without losing ownership (#10105)                    | **adapted** — “Remote Ronin server”; `.ronin/ssh-launch`           |
| `281b92b48` | perf(server): stop scanning old OpenCode parts (#10116)                                    | **adapted** — no turn token-usage accumulators here                |
| `17490c0a0` | perf(server): avoid full thread reads on turn start (#10108)                               | `getTurnStartMessage`; collapsed a duplicate first-turn block      |
| `eb8ed8030` | perf(server): skip plan bodies in thread summaries (#10341)                                | metadata-only `hasActionableByThreadId`                            |
| `62f568b88` | fix(server): skip disabled provider instances for text generation fallback (#10346)        | kept Ronin’s known-model filter                                    |
| `e0adcc8a2` | fix(server): capture checkpoints before refreshing PR status (#10347)                      | separate drainable PR worker                                       |
| `e4e9fa9a0` | perf(server): finish runtime messages without full thread reads (#10120)                   | targeted message/plan/activity queries                             |
| `5fa35d211` | refactor(server): let adapters declare context compaction (#10112)                         | native vs slash vs omit; Kilo rides OpenCode                       |
| `223ff4490` | fix(server): link thread PRs without an open client (#10101)                               | **adapted** — migration **056**; mobile/LegacySidebar dropped      |
| `7ac93e300` | fix(server): allow settling threads with unanswered async questions (#10400)               | manual settle dismisses `responseMode: "message"`                  |
| `ac4f1a2b6` | fix(server): preserve inline provider secrets on redacted saves (#10054)                   | folded into Ronin’s secret plan/commit                             |
| `86070cbc7` | fix(server): skip git status scans while the index is locked (#9845)                       | `index.lock` before porcelain                                      |
| `29c5ecd0e` | fix(mcp): allow text-only preview snapshots (#10232)                                       | `includeImage?: boolean`                                           |
| `3d00cfd5a` | fix(claude): name the expired login or usage limit instead of a generic API error (#10321) | **adapted** — no `announcedUsageLimits` here                       |
| `95139254b` | fix(codex): accept misalignment policy errors on thread resume (#10373)                    | generator + schema.gen + tests                                     |
| `d3d4ea42e` | fix(server): skip disabled settlement lookups (#10424)                                     | after `f66cfe221`                                                  |
| `9ab0635db` | fix(server): run OpenCode CLI commands sequentially (#10427)                               | SQLite lock; Kilo shares the path                                  |
| `1abc717f0` | fix(server): keep interrupted threads resumable after restarts (#10421)                    | **adapted** — `continueThreadsAfterServerUpdate` on ServerSettings |
| `1e740e48a` | fix(server): follow placeholder branches after checkout updates (#10441)                   | saved `t3code/<hex>` can adopt a real checkout                     |
| `52b2bf77a` | fix(server): handle JSON-wrapped titles and verbose Claude output (#10446)                 | docs re-homed into Ronin’s Claude settings section                 |
| `6134b90ff` | fix(server): mark Cursor transport error answers as failed (#10337)                        | **adapted** — skip drain when the session is already stopped       |
| `ea646c083` | fix(server): stop Windows terminal polling from spiking CPU (#9476)                        | protocol v3 `processTable`; backoff cap 60s                        |
| `c2c4185e1` | fix(web): onboarding installs agents without needing Node or npm (#10402)                  | **subset** — Windows junction test only; wizard skipped            |

**Client / web**

| Upstream    | Title                                                                          | Notes                                                               |
| ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `dd6407291` | refactor(web): share bulk thread deletion between sidebars (#10106)            | skip LegacySidebar; Ronin’s loop returned on first failure          |
| `ac11bd29b` | refactor(client): share tool outcome rules (#10122)                            | `./work-log/presentation`; skip mobile                              |
| `076d753ae` | perf(web): skip checkpoint map rebuilds while streaming (#10118)               | **adapted** — work-entry rows, not work-toggle summaries            |
| `bccad2704` | fix(web): keep manual panel choices during a turn (#10113)                     | `userActionRevision` + `openProactive`                              |
| `e63ddb48e` | fix(threads): keep completed requests closed across clients (#10123)           | `./pending-requests`; skip mobile                                   |
| `64fafbdfc` | perf(web): speed up folder menu sorting (#10190)                               | one `Intl.Collator` per sort                                        |
| `29d03ec55` | style(web): fix inconsistencies in new settings layouts (#10177)               | `first:rounded-t-xl last:rounded-b-xl`                              |
| `2d645df47` | feat(threads): persist manual active thread order (#9729)                      | migration **057**                                                   |
| `4023d93bc` | feat(web): drag threads across sections with consistent motion (#9731)         | **adapted** — Needs you stays non-droppable                         |
| `9a47c7bd4` | feat(web): simplify sidebar drag destination cues (#9750)                      | taken as later verb badge                                           |
| `9c96ac258` | fix(web): keep settings inputs focused during IME composition (#10262)         | `isComposing` / keyCode 229                                         |
| `2d6a37999` | fix(web): only show auto balance errors after failed checks (#10407)           | `idleTtlMs: 0` on hostResources                                     |
| `3941c2a1d` | fix(web): improve preview recording frame delivery (#10403)                    | prefer `avc1`; stop stream before save                              |
| `210899643` | fix(web, mobile): replace Apple desktop machine labels (#10396)                | skip mobile; Mini PC / Workstation                                  |
| `7e8ae6b8d` | fix(web): hide browser when the right panel starts closing (#10385)            | `visible={rightPanelOpen}`                                          |
| `79394154d` | fix(web): deduplicate expanded tool labels and keep errors expandable (#10420) | seed `seen` with the visible label                                  |
| `5b0c923ea` | feat(web): name the drop action while dragging sidebar threads (#10378)        | Pin/Unpin/Settle/Un-settle/Wake                                     |
| `252df7742` | perf(web): keep the sidebar responsive during bulk thread updates (#10413)     | **adapted** — shell `applyItems`; fromQueue tests cannot pin chunks |
| `7112697e8` | feat(threads): dismiss async questions without replying (#10431)               | **adapted** — sibling `X` button, no `ComposerBanner.Dismiss`       |
| `efeac1442` | fix(web): show load balancing note for a single machine (#10433)               | `< 2` environments                                                  |
| `ecf3716fd` | fix(web): composer regains focus when you tab back into T3 Code (#10463)       | window-focus refocus                                                |
| `4e969f373` | fix(web): keep sidebar drag dividers clear and gestures smooth (#10453)        | CSS in `chrome.css`, not `index.css`                                |
| `f5fb056d2` | fix(web): clear stuck panel resize cursor (#10461)                             | blur / lost capture / cancel / unmount                              |
| `490eb17d3` | fix(web): clarify sidebar drag dividers and empty targets (#10464)             | always-mounted placeholders                                         |

Fork-specific decisions worth recording:

- **`001f06d54` (stable from latest nightly).** Ronin already maintains the same `release.yml`. Manual `channel=stable` now builds the latest published nightly’s commit. `relay_public_config` and `build_wsl_node_pty` hunks dropped — those jobs are not in this fork. Version example in the docs uses `0.6.9-nightly.*`, not upstream’s `0.0.39`.
- **`223ff4490` (PR without a client).** Migration remapped 048 → **056**. `PullRequestDetailPanel.tsx` hunk dropped: Ronin still uses `onStateChange` for right-panel tab icons. Engine still starts QuotaResume + BuildSystem.
- **`2d645df47` + drag stack.** Migration remapped 049 → **057**. Needs you stays a leading non-droppable shelf. `Sidebar.tsx` was not replaced wholesale.
- **`1abc717f0` (interrupted resume).** Added `continueThreadsAfterServerUpdate` on **ServerSettings** so reconcile can read the opt-in. Did not take `preparedWhileReady` / `listBindings`.
- **`252df7742` (shell batches).** `applyItems` + `Stream.runForEachArray` landed. This fork’s `subscribeDynamic` taps per event, so a `fromQueue` fake cannot pin RpcClient’s 16-event buffer sizes; the test asserts the end state instead.
- **`7112697e8` (dismiss).** No `ComposerBanner.Dismiss`. Dismiss is a sibling `X` on the collapsible header (`t3code/no-native-title-tooltip`).
- **`c2c4185e1`.** WelcomeWizard / `providerReadiness` / `docs/user/welcome-wizard.md` skipped. Server already followed `realCommandPath`; only the junction test was added.

### Already in the tree (1, mixed)

| Upstream    | Title                                                              | Where it lives                                            |
| ----------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `45387700b` | fix(web): keep settings section headings description-free (#10415) | `SettingsSection` already has no `description`. See below |

`UsageProviderSettings.tsx` does not exist here. `ProviderInstanceCard` is a custom tabbed editor, not a `SettingsSection`. The LoadBalancingSettings copy shortening was taken with `efeac1442`.

### Skipped (32)

**Mobile (11).** `6766e682a` `36c48a6b7` `c0bf35466` `8e129a0df` `98469159d` `66a24d6c1` `d6aa179ad` `8c9a49afb` `e1230d603`. No `apps/mobile`.

**Marketing (6).** `075a86e3b` `da976cf29` `bd280de80` `b22646c31` `7e03dcfe5` `0860cea0c`. No `apps/marketing`. The last also adds a Vercel `deploy_marketing` job this fork does not have.

**Usage-limits stack (4) — same deferred follow-up as batch 27.** `f1a08116f` `0a89364f1` `1c1d38fcd` `6abdf37a5`. Foundation files still absent (`providerUsageLimits.ts`, `usageLimits.ts`, `UsageLimitSources.ts`, `cliproxyApi.ts`, `codexUsageLimits.ts`, `UsageLimits.tsx`). Uncommitted batch-27 work did not add them.

**Onboarding wizard (3).** `ec36176e4` `f729e8fd8` and the wizard half of `c2c4185e1`. No `WelcomeWizard`, no `apps/web/src/onboarding/`, no `docs/user/welcome-wizard.md`.

**Composer rest-on-blur (2).** `a12589dc0` `a07715c09`. Ronin has no `composerCollapseOnBlur` / resting-composer layout. Desktop collapse is not a thing here.

**Cut product / governance (6).**

| Upstream                | Title                                                                | Why                                                                |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `72cb638a8`             | fix(web): show Tux icon for WSL environments (#8511)                 | WSL is cut; detection is Microsoft `osrelease` only                |
| `95d99373b`             | fix(clients): show feedback results in composer banners (#10398)     | `/feedback` was declined in batch 11 (`3db38b881`)                 |
| `e15ffb9c0`             | docs: link the repository security reporting policy (#10303)         | `security@ping.gg` / t3.codes; Ronin has a root stub `SECURITY.md` |
| `3cd2cbbc1` `003289265` | Macroscope `ui-consistency.md`                                       | file does not exist here                                           |
| `f5a1ec5e2` `d57bdf384` | Macroscope `effect-service-conventions.md`                           | unwired inherited governance                                       |
| `de28fa1ff`             | chore: enable CodeRabbit automatic reviews (#10457)                  | no `.coderabbit.yaml`                                              |
| `95f9b14f8`             | fix(server): import transcripts with oversized tool records (#10430) | no `AgentSessionScanner`                                           |

### Verification

- `git diff --check` — clean. No `.rej` files left.
- Typecheck: `@t3tools/contracts`, `@t3tools/client-runtime`, `@t3tools/web`, `@t3tools/desktop`, `@t3tools/ssh` — 0 errors. `t3` (server) reports the same **pre-existing** `orphanedProviderSessionStartup.integration.test.ts` `GitVcsDriver` missing-context pair (TS2375 + TS377004) recorded in batches 25–27. Confirmed this batch did not introduce it. Two Effect _suggestions_ in uncommitted `HostResources.ts` (batch 27) and two `multipleEffectProvide` warnings in `serverRuntimeStartup.reconcile.test.ts` are not errors.
- One type error **was** introduced by the drag-stack port and fixed: `Sidebar.logic.test.ts` used `SidebarThreadSummary` without importing it.
- Focused tests, all pass unless noted:
  - nightly script: `node --test .github/scripts/check-nightly-release.test.cjs` — 13 pass
  - settlement + settle-async: `ThreadSettlementReactor.test.ts` 15, `decider.settled.test.ts` 20
  - web: `filePath.test.ts` 9, `Sidebar.logic.test.ts` 124 then 168 after drag, `ChatView.logic` 95, `rightPanelStore` 51, `MessagesTimeline.logic` 35, `MessagesTimeline.test.tsx` 29
  - client-runtime: `pendingRequests` 21, `work-log/presentation` 21, `shell-sync` 4 (batching assertion adapted)
  - server: `serverSettings` 39, `GitVcsDriverCore` 74, `McpHttpServer` 10, `ClaudeAdapter` 109, `ClaudeHome` 5, `ClaudeTextGeneration`+prompts 44, `OpenCodeAdapter` 90, `CursorAdapter`+transport 39, `CheckpointReactor` 27, `ProviderService` 47, `CodexSessionRuntime` 40, `terminal/Manager` 67, projection/ingestion 189, GitManager + ThreadPullRequestReactor + projector suites
  - ssh: `tunnel` + `runnerProcess` 35
  - drag: `threadSort` 22, `threadReducer` 39, `decider.active-order` 8, migration 057 1, `Sidebar.drag` 45, `Sidebar.motion` 14, `Sidebar.pointer` 22
- `vp lint` on files touched by each port agent — 0 findings in those reports.
- Index left unstaged, as found.

**Pre-existing, unrelated.** `apps/server/integration/orphanedProviderSessionStartup.integration.test.ts` still fails to typecheck (`GitVcsDriver` missing from the expected Effect context). Batch 25 introduced it; batches 26–27 recorded it. This batch neither fixed nor worsened it.

**Hit every surface (for this batch):**

- **Contracts** — `thread.pull-request.sync`, `branchPullRequest`, `thread.active.reorder` / `activeOrderKey` / `threadActiveReorder`, `thread.user-input.dismiss`, `continueThreadsAfterServerUpdate`, resource-telemetry protocol v3 `processTable`, compaction declaration on adapters.
- **Server** — settlement (inactivity without PR lookup, skip when disabled, dismiss on manual settle), projection perf, PR reactor, checkpoint/PR timing, placeholder branch follow, secrets, git index lock, MCP snapshots, OpenCode sequential CLI + per-message text maps, Claude result/auth/title, Codex resume + misalignment, Cursor transport, compaction, Windows terminal polling, interrupted-session continuation.
- **Desktop (Electron/IPC)** — no new IPC. Typechecked. Preview recording and resize-cursor are renderer-side; resource-monitor is the native sidecar.
- **Web renderer** — sidebar (bulk delete, cross-section drag, Needs you preserved), chat (pending-request closed sets, dismiss, panel choices, streaming timeline, composer window focus, tool-label dedupe), settings (IME, rounding, load-balancing follow-ups), preview (hide on close, recording), file tree sort, machine labels.
- **Providers** — Claude, Codex, OpenCode/Kilo, Cursor, Grok/Antigravity (compaction slash), Droid/Pi (unsupported). No decision needed for a new adapter beyond the compaction table.
- **Reverse states** — dismiss has no-op on already-answered and native-callback questions; drag pin/unpin/settle/unsettle/wake are all reversible; load-balancing error label only after a failed check; mute of auto-balance for a single machine has the multi-machine UI as the way back.
- **Connection modes** — SSH stop ownership is remote-specific; PR linking and settlement run server-side so LAN/Tailscale/SSH agree; load-balancing follow-ups are multi-environment.
- **Docs** — `docs/operations/release.md` (30-minute nightly, six-hour gap, promote-nightly stable), `docs/user/thread-sidebar.md` (dismiss on settle, server-side PR link, drag across sections), `docs/user/providers-codex.md` (dismiss), `docs/user/providers-claude.md` (verbose titles).

### Not tested

- A real cross-section sidebar drag in a live client (unit coverage only).
- A real nightly→stable promotion on GitHub Actions.
- `grok inspect` / live OpenCode CLI sequential lock (test doubles).
- The Windows terminal sidecar `processTable` path on a real Windows host. Backoff is unit-tested.

## Batch 29 — reviewed through `0d34579d6` (27 commits)

Reviewed `e1230d603..0d34579d6`, with upstream snapshotted at
`0d34579d674920cc47fc5c908494f51ed3895204` for the whole run. The worktree started clean. No
commit needed a product Ask.

### Ported (9)

| Upstream    | Title                                                                    | Notes                                                                                         |
| ----------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `a7028f139` | fix: use Pierre icons consistently for attachments (#10475)              | **adapted** — replaced Ronin's remaining generic file-row icon; kept its filename placeholder |
| `7376536b2` | fix(devcontainer): make repository setup work (#7875)                    | **adapted** — Ronin naming, `.ronin` state, no Connect/mobile setup                           |
| `d8bc6831c` | fix(projects): prevent invalid script IDs from crashing threads (#10019) | **adapted** — see below                                                                       |
| `b919d6389` | fix(web): keep composer toolbar controls anchored during transitions     | **adapted** — Ronin's mobile selector does not use the compact desktop strip                  |
| `f57d3832c` | fix(web): resize the floating preview from any edge (#10467)             | **adapted** — preserved Ronin webview chrome and its deliberate lack of pop-out/PiP           |
| `fe07ffe7c` | fix(web): remove inserted citations on cancel (#10518)                   | clean against Ronin's citation editor shape                                                   |
| `72d94087b` | fix(web): restore settled PR colors on hover (#10023)                    | **adapted** — Ronin VCS color tokens and `group/sidebar-row`                                  |
| `9cc983954` | fix(web): keep popup triggers steady when pressed (#10468)               | **adapted** — applied to Ronin's flat shared button recipe                                    |
| `0d34579d6` | fix(web): keep project favicon shape consistent across sizes (#10502)    | clean                                                                                         |

Fork-specific decisions worth recording:

- **`7376536b2` (devcontainer).** The old Debian/Bun setup did not install the repository's `vp`
  runner and used the wrong package-manager path. The replacement mirrors CI with Ubuntu 24.04,
  Node 24, Rust and GitHub CLI, installs through `vp i`, repairs Electron, and warms Vite's cache.
  Runtime state is isolated at `${containerWorkspaceFolder}/.ronin` through the still-canonical
  `T3CODE_HOME` environment variable. Upstream's T3 Connect notice and mobile-native paragraph were
  dropped. The maintainer guide lives at `docs/internals/devcontainer.md` and is indexed.
- **`d8bc6831c` (script IDs).** The server now rejects newly introduced script IDs that cannot map
  to `script.<id>.run`, while allowing persisted legacy IDs to be edited or removed. Web helpers
  return `null` instead of throwing for those IDs, so project settings and chat action menus stay
  usable. Ronin's command palette is a fork-only extra surface backed by the keybinding command bus;
  it omits legacy IDs that cannot be represented on that bus, while the chat actions menu can still
  run them directly.
- **`b919d6389` (composer strip).** The desktop strip now animates label width rather than
  translating whole control groups, keeping trailing controls anchored. Ronin's small-screen menu
  is a separate, always-visible control without compact-label animation, so upstream's mobile-web
  class hunk had no landing point.
- **`f57d3832c` (floating preview).** The mini-player stores only its preferred width and derives
  height from the preview viewport, preserving aspect ratio through device presets, zoom and
  temporary container constraints. Eight edge/corner handles landed. The upstream pop-out control
  remains omitted, and Ronin's 8px native-webview corner contract and chrome tokens were preserved.

### Already in the tree (0)

No commit in this range was already satisfied semantically.

### Skipped (18)

**Mobile/native (15).** `bb5748bfa`, `5b68b2c8e`, `bc3dc2694`, `e3b644c5a`, `7dda0b1c0`,
`062987b2f`, `71297974c`, `b248f5ad5`, `c0d4e95c0`, `e32dd42f8`, `b7175371d`, `dc39615ae`,
`357b8d521`, `8d7f78121`, `1d1bf5040`. These target `apps/mobile`, iOS/React Native patches, or
mobile-only helpers. The `packages/shared/orchestrationTiming` hunk in `5b68b2c8e` serves the mobile
new-task flow and has no runtime caller in this fork.

**Release metadata (1).** `08c715ed9` prepares upstream v0.0.39 and changes mobile/package versions;
Ronin owns a separate release line.

**Removed onboarding stack (2).** `8b2838e0e` and `62fbbe08a` extend `WelcomeWizard`,
`AgentSessionScanner`, onboarding project-import logic and their contracts. None of that foundation
exists in Ronin; importing only the git-config helpers would leave no product caller.

### Verification

- Focused tests: 151 tests across 9 files, then 126 tests across 4 integration-adjacent web files —
  **277 passed, 0 failed**. Coverage includes the server script invariant, legacy project-script
  helpers, preview aspect-ratio and eight-direction resize math, mini-player state, PR hover colors,
  favicons, branch-toolbar logic, PreviewView, ChatView logic, command-palette logic and project
  settings logic.
- Typecheck: `@t3tools/web` — 0 errors. A combined `@t3tools/web` + `t3` run reported only the same
  pre-existing server failure below; no new server diagnostic points at this batch.
- `vp lint` over all changed `.ts`/`.tsx` files — clean. `vp fmt --check` — clean.
  `git diff --check` and `bash -n` for both devcontainer lifecycle scripts — clean.
- React Doctor required by the repository workflow: `--scope changed` scored 56/100 because it
  scans the full bodies of large touched components. The narrower `--scope lines` pass reported 9
  findings. Review found no introduced issue: eight are pre-existing component complexity/manual
  memoization/state-structure warnings, and the lone error points at the existing once-only Web
  Animation `finish` listener, whose animations are cancelled on replacement and unmount. No
  finding points at the new floating-preview component.

**Pre-existing, unrelated.** `apps/server/integration/orphanedProviderSessionStartup.integration.test.ts`
still fails to typecheck because `GitVcsDriver` is missing from the expected Effect context (TS2375

- TS377004). Batch 25 introduced it and batches 26–28 recorded it. This batch neither fixed nor
  worsened it. The existing `HostResources.ts` suggestions and `serverRuntimeStartup.reconcile.test.ts`
  warnings also remain non-errors.

**Hit every applicable surface:**

- **Entry points** — valid project scripts remain available from the chat actions menu, Settings,
  command palette and keybindings. Legacy invalid IDs are editable/removable and directly runnable;
  only the keybinding-backed palette entry is omitted because no valid command can represent it.
- **Clients** — changes are in the shared web renderer used by Electron. Floating-preview layout
  preserves the native webview's corner-radius contract; no desktop IPC changed.
- **Providers/contracts** — provider adapters are unaffected. Script validation uses the existing
  keybinding contract and does not change the wire schema.
- **Reverse states** — floating previews can grow or shrink from every edge/corner, move, return to
  the panel and close; temporary viewport constraints no longer overwrite the preferred width.
- **Connection modes** — project metadata validation runs on the environment server, so local,
  LAN, Tailscale and SSH clients receive the same invariant. No origin is baked into the renderer;
  the devcontainer still relies on the pairing URL.
- **Docs** — the new devcontainer maintainer guide is indexed in `docs/README.md`.

### Not tested

- No live client was started, per `AGENTS.md`. The floating preview's eight resize handles,
  composer-strip transition, citation-cancel removal, settled-PR hover, popup press treatment and
  favicon curvature have unit/type/static coverage only.
- A full Dev Container or Codespaces image was not built; its JSONC, shell syntax and repository
  commands were checked locally.

## Batch 30 — reviewed through `5e6cc2b89` (77 commits)

Reviewed `0d34579d6..5e6cc2b89`, with upstream snapshotted at
`5e6cc2b89534a8e01772bf647b79a1f2da2f9664` for the whole run. Fork merge base remains
`083fa4ab24c464ddf01e5b7ab22135d1ebdc120b`. No commit needed a product Ask.

### Ported (37)

| Upstream    | Title                                                                                   | Notes                                                                                              |
| ----------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `3bf74eb6d` | fix(claude): report usage limits on retried turns (#10549)                              | clean                                                                                              |
| `577b6cc22` | fix(web): remove excess sidebar thread spacing (#10569)                                 | clean                                                                                              |
| `c8ec7df12` | fix(web): make settings project scopes searchable and scrollable (#10570)               | **adapted** — shared search input + Ronin sidebar picker; no upstream `ProjectsSettings` page      |
| `5ec6f77ec` | fix(web): use `tabular-nums` with the ui font for sidebar timer (#10592)                | clean                                                                                              |
| `12f560444` | fix(web): correct pending question attachment message (#10599)                          | clean                                                                                              |
| `dadba6d95` | fix(web): remember Composer Fast mode across new chats (#2981)                          | **adapted** — preserves Ronin's per-instance provider selections                                   |
| `95834d68a` | fix(server): disable executable capabilities in Claude metadata generation (#4169)      | clean; hermetic hook-disabled metadata generation                                                  |
| `09e8de9c6` | Add stop thread keybinding command (#4308)                                              | all desktop entry points: composer, palette, settings and keybinding contract                      |
| `ea2983afb` | fix(web): copy selected pull request link from PR page (#10615)                         | **adapted** — Ronin right-panel state and standalone PR page                                       |
| `d67157a09` | fix(web): keep ref picker steady when opening (#9472)                                   | clean                                                                                              |
| `569a8cd2c` | fix(web): play pull request videos inline (#10617)                                      | clean                                                                                              |
| `e0e0bcb11` | fix(desktop): preserve browser editing shortcuts (#10621)                               | clean                                                                                              |
| `d081ab7ab` | fix(web): open pull request markdown links in the panel (#10623)                        | **adapted** — threads and the standalone PR surface share Ronin's panel routing                    |
| `299404a75` | feat(desktop): add cross-platform window capture (#8103)                                | **adapted** — full Ronin-branded capture stack; see below                                          |
| `8588d7f63` | fix(web): open proactive panels when entering threads (#10610)                          | clean                                                                                              |
| `9fe4d6568` | fix(native): wait for the KDE feedback test listener (#10645)                           | clean                                                                                              |
| `b7c002f91` | fix(web): add bottom padding to project actions header (#10634)                         | clean                                                                                              |
| `15193df9f` | fix(web): update machines together in auto balance (#10596)                             | **adapted** — shared-setting patches are filtered against each Ronin environment                   |
| `9e37f0c29` | fix(preview): transfer recordings to the agent environment (#10572)                     | clean across preview contracts, broker, toolkit and renderer upload                                |
| `50a76cee7` | fix(web): keep scroll-to-end button close to composer (#10543)                          | **adapted** — measures Ronin's flat composer surface and attached banners                          |
| `bc4b00666` | fix: generate thread titles with the selected model across connections (#10526)         | **subset** — server/web/client-runtime; mobile hunk dropped                                        |
| `b5f7fa0ed` | fix(desktop): enable context menus in the browser (#10670)                              | clean                                                                                              |
| `bc88fdf6a` | fix(desktop): stop generating declarations during bundling (#10679)                     | clean                                                                                              |
| `349ce3014` | fix(desktop): restore layout control hit targets (#10673)                               | **adapted** — Electron 44 app-region reset lives in Ronin's split `styles/base.css`                |
| `7220dfe2c` | feat(chat): attach files to question answers (#9871)                                    | **adapted** — desktop/web/server/contracts only; path validation uses Ronin's provider layer graph |
| `430fbd1ff` | fix(server): give completed turns a full session idle window (#10689)                   | clean                                                                                              |
| `7d9aaf6a7` | feat(web): add pull request merge defaults (#8088)                                      | clean across settings, desktop persistence, PR actions and contracts                               |
| `134b7194b` | feat(web): add previous/next turn navigation in minimap (#8531)                         | clean                                                                                              |
| `83b865fec` | fix(web): copy terminal selection with Ctrl+Insert (#8541)                              | clean                                                                                              |
| `82451eeb7` | fix(web): show the same project icon in the command palette as everywhere else (#10712) | **adapted** — uses Ronin's existing `ProjectFavicon` API                                           |
| `d7a59c63c` | fix(web): stop sidebar rows flashing and shifting on click (#10713)                     | clean                                                                                              |
| `bde39d4d8` | feat(web): accept file drops into sidebar threads (#7892)                               | **subset** — current sidebar + route handoff; removed `LegacySidebar` hunk                         |
| `061543e9e` | fix(mcp): keep preview snapshots usable by the agent and let it save them (#10501)      | clean; bounded snapshot serialization plus optional save path                                      |
| `47eed9fac` | fix(server): stop Windows terminal processes when closing (#10771)                      | clean                                                                                              |
| `12391bd0d` | feat(web): show project favicon in new-thread project picker (#10790)                   | **adapted** — Ronin's favicon API and grouped project picker                                       |
| `772ea1473` | fix(web): honor terminal link browser overrides (#10060)                                | clean across terminal surface, drawer and integrations setting                                     |
| `5e6cc2b89` | fix(web): restore text-only draft project title (#10821)                                | clean follow-up to the project-picker favicon                                                      |

`299404a75` is the large feature in this batch. Ronin now has one capture path across macOS,
Windows, KDE, Hyprland and GNOME; the desktop bridge stages captures durably before acknowledging
them, the composer preserves screenshot metadata and extracted accessibility content, Settings
owns shortcut/sound/animation setup, and packaging/CI build the two Rust helpers and GNOME
extension. User-facing copy and docs say Ronin, while the existing `t3code` URL scheme, bundle IDs
and protocol identifiers stay stable for compatibility. The upstream MP3 blobs were represented as
source data instead of importing binary assets.

The durable-capture test exposed a small prerequisite from the previously skipped upstream welcome
wizard: `useLocalStorage` must resolve `window.localStorage` at call time rather than capturing it at
module import. Only that generic storage correction was taken; the onboarding product remains cut.

`7220dfe2c` carries attachments through question drafts, uploads, provider answers, normalization
and orchestration. Claude receives validated local attachment paths; every other provider retains
the typed optional contract without pretending to support a native attachment shape. The
`ProviderService` layer supplies `NodeServices.layer` locally so path validation does not leak a new
filesystem requirement into every consumer.

### Already in the tree (2)

| Upstream    | Title                                                                      | Where it lives                                                                                         |
| ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `d6dbe8dd6` | fix(web): stop the settings sidebar shifting when switching pages (#10705) | Ronin's grouped settings navigation is already a stable, always-mounted list                           |
| `b5d89038a` | feat(web): accept file drops into sidebar threads (#7892)                  | empty duplicate of `bde39d4d8`; the parent and tree are identical, so there is no second patch to take |

### Skipped (38)

**Export classification / Knip enforcement (14).** `5b8a69c7b` `5a853a4b4` `89dd9ab32`
`e279e402c` `b491e41da` `6f4cd07b9` `0af04f180` `161715b1e` `77d9ffc82` `060c576f8`
`3b6ce931c` `7cdeb696e` `1f0a14cf7` `7d620506a`. These are upstream's internal export-policy
refactors and enforcement passes. Ronin has a different desktop/server public surface; importing
the policy wholesale would delete or privatize fork-owned APIs without changing shipped behavior.

**Mobile/native app (7).** `c0cad74bf` `02443335b` `2c8e95a4b` `892de47f0` `b28471567`
`579266caa` `4664c572a`. No `apps/mobile` or native iOS/Android product exists in this fork.

**Usage-limit presentation stack (3).** `d64335bb5` `6ba15c027` `1f14d6d10`. Ronin still lacks
upstream's account-row usage-limit source and presentation stack, so these patches have no product
consumer. They do not affect quota-resume classification.

**Release metadata (1).** `8de9169f0` prepares upstream v0.0.40 and mobile/package versions;
Ronin owns a separate release line.

**Remote local-media/gallery stack (2).** `a01b227d6` assumes upstream's earlier remote-thread
local-media serving baseline, which Ronin does not carry. `6df0add6e` builds its linked markdown
gallery on the same newer media registry and action-source shape; taking a partial gallery would
drop linked-image semantics and remote ownership.

**Governance (2).** `f0bd43eaf` `5a18fb95e` only add Macroscope labels to upstream convention
files.

**Toolchain/reference churn (4).** `a37c66406` `bd56e920b` `458f50298` `9d345fa95` upgrade
TypeScript/Effect/Alchemy and sync vendored references as one upstream toolchain train. Ronin's
patched Effect beta and dependency set intentionally remain on their fork-tested versions.

**Upstream installer artwork (3).** `991526383` `5d14c0e96` `0fe4c99ee` cycle through T3-branded
macOS DMG backgrounds and logos. Ronin's product artwork is independent.

**Diverged UI architecture (2).** `11601da84` patches a one-pixel seam in upstream's attached-glass
composer-banner geometry; Ronin uses a flat composer and already reserves banner clearance.
`eb1150636` is an upstream-wide `ProjectFavicon` API refactor that conflicts with Ronin's custom
project/board icon system; the two concrete picker/palette fixes were ported against the existing
API instead.

### Verification

- Changed desktop tests: 38 files / 589 tests pass after adapting Ronin's desktop-entry identity
  fixture and explicitly authorizing the new IPC sender-forwarding test.
- Changed server tests: 13 files / 329 tests pass. Changed web tests: 29 files / 802 tests pass.
- Contracts: 3 files / 159 tests; local-storage coverage: 2 files / 7 tests; artifact builder:
  1 file / 31 tests — all pass.
- Native helpers: KDE 11 tests and Hyprland 10 tests pass with `cargo fmt --check`; GNOME extension
  3 files / 24 tests pass.
- Typecheck: `@t3tools/contracts`, `@t3tools/client-runtime`, `@t3tools/web` and desktop pass.
  Server reports only the same pre-existing
  `integration/orphanedProviderSessionStartup.integration.test.ts` missing-`GitVcsDriver` context
  pair (TS2375 / TS377004) recorded in batches 25–29; this batch does not touch that test.
- React Doctor's required changed-scope scan scored 46/100 before and after the final storage
  adaptation, with the identical 480-diagnostic backlog. No regression was introduced; findings
  are existing large-component/compiler diagnostics or unchanged upstream patterns.
- `vp fmt --check` over 262 changed/untracked files and `git diff --check` pass.

**Hit every applicable surface:** desktop Electron/IPC and packaging, the shared web renderer,
server orchestration/MCP/provider/terminal paths, wire contracts, local and remote environment
recording transfer, command-palette/settings/keybinding entry points, reverse capture setup states,
and user/internals docs. Mobile, Connect/Clerk, WSL, legacy sidebar and upstream release/artwork
surfaces remain deliberately cut.

### Not tested

- No live client or browser automation was run, per `AGENTS.md`; capture animation, shortcut setup,
  sidebar drops, minimap navigation and terminal-link routing have unit/type/static coverage.
- Native capture was not exercised on real macOS, Windows, KDE, Hyprland or GNOME desktops; platform
  services, geometry, transport and packaging paths are covered by focused tests.

## Batch 31 — reviewed through `3836890e4` (31 commits)

Reviewed `5e6cc2b89..3836890e4`, with upstream snapshotted at
`3836890e4484406813997259efc69065b25ce698` for the whole run. Fork merge base remains
`083fa4ab24c464ddf01e5b7ab22135d1ebdc120b`. No commit needed a product Ask.

### Ported (17)

| Upstream    | Title                                                                            | Notes                                                                                                      |
| ----------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `de545c417` | fix(web): stop the bar under the composer popping in after threads load (#10727) | **adapted** — thread-shell readiness now drives the loading boundary                                       |
| `7fbc545ae` | fix(web): keep the composer footer still while thread data loads (#10768)        | **adapted** — shares the same stable thread-shell/catalog state                                            |
| `08463e2c4` | fix(server): release consumed event replay pages (#10777)                        | clean; global replay now paginates without retaining consumed pages                                        |
| `e16b8b059` | feat(web): add provider model bulk toggle (#10947)                               | clean                                                                                                      |
| `50f918c57` | fix(web): allow expanding duplicate tool call commands (#10981)                  | clean                                                                                                      |
| `afb84898b` | feat(pull-requests): link multiple pull requests to threads (#10839)             | **adapted** — full contracts/server/web/MCP migration against Ronin's event-sourced project and panel APIs |
| `f0401c629` | feat(search): find threads by linked pull request (#10870)                       | **adapted** — indexed through Ronin's thread search projection                                             |
| `de37964db` | feat(prs): navigate, merge and rebase GitHub stacks (#10875)                     | **adapted** — stack actions use Ronin's right panel, environment routing and GitHub service                |
| `33242d016` | fix(server): preserve recent PR reads across server restarts (#11007)            | clean                                                                                                      |
| `8d8189e67` | feat(web): zoom and pan expanded images (#10869)                                 | **adapted** — preserves Ronin's video/download/fallback behavior                                           |
| `b7b3ef1e6` | fix(ui): use available space for composer model names (#11002)                   | clean                                                                                                      |
| `addfb1390` | fix(web): restore pr list diff counts to the top right (#10609)                  | clean                                                                                                      |
| `385cc0a4c` | fix(web): show message copy buttons on touch devices (#11020)                    | clean                                                                                                      |
| `d1eeb1624` | fix(web): middle-click pastes in the terminal on Linux (#11018)                  | clean                                                                                                      |
| `0f602b337` | fix(editors): open remote projects in Zed (#11022)                               | clean                                                                                                      |
| `bb5e824c9` | feat: add blue and orange diff color palette (#10671)                            | **adapted** — roles live in Ronin's split token/theme CSS                                                  |
| `d29c56a5c` | fix(server): resolve project identity before legacy pr relinks (#11045)          | **adapted** — retains the multi-PR projection bridge and shell snapshot mappings                           |

`afb84898b` is the structural center of this batch. A thread can now retain more than one linked
pull request, with migration 058, typed events and read models, projection/relink handling, MCP
tools, service/reactor behavior, list and detail panels, link dialogs, and user/internals docs all
moving together. The follow-up search, stack, cache and legacy-identity commits were reconciled on
top of that model rather than copied against upstream's different panel and environment shapes.

During verification, the port was tightened in the places where upstream context hid required
Ronin integrations: requested PR hosts are no longer overwritten by stored links, projector
handlers and the legacy-link bridge cover every PR event, shell snapshots retain
`branchPullRequest`, confirmed merges keep the enriched PR summary, and the WebSocket layer
provides the required SQL service. The related projector, service, runtime-instruction and MCP
tests cover those adaptations.

### Already in the tree (0)

None.

### Skipped (14)

| Upstream    | Title                                                                        | Why                                                                                          |
| ----------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `3faeee49a` | refactor(web): consolidate setup wizards into shared components (#10832)     | the upstream setup-wizard product surface is cut from Ronin                                  |
| `20e2e899e` | fix(desktop): defer keyring loading until macOS cookie import (#10667)       | depends on upstream's BrowserImport/cookie-import flow, which this desktop does not carry    |
| `fdf34c401` | fix(relay): share notification policy and prioritize waiting agents (#10848) | hosted relay surface is cut                                                                  |
| `3dfc134e6` | fix(relay): recheck queued iOS alerts and retain fast completions (#10849)   | hosted relay and iOS notification surfaces are cut                                           |
| `1862686f9` | fix(relay): use current APNs registration routing for queued jobs (#10859)   | hosted relay and APNs surfaces are cut                                                       |
| `9d6c43f32` | fix(mobile): respect notification permission when tokens rotate (#10850)     | no mobile app in this repo                                                                   |
| `3e6f856f2` | fix(mobile): tolerate native Headers without getSetCookie (#10851)           | no mobile app in this repo                                                                   |
| `2a3035353` | feat(mobile): arrange threads with drag handles (#10496)                     | no mobile app in this repo                                                                   |
| `6c583620f` | feat(mobile): add Android agent notifications and ongoing activity (#10416)  | no mobile app in this repo                                                                   |
| `a29a7cc58` | fix(mobile): blur glass fallbacks to prevent background text bleed (#10964)  | no mobile app in this repo                                                                   |
| `75e4ceb96` | fix(mobile): prevent Android chat rows overlapping during sync (#10983)      | no mobile app in this repo                                                                   |
| `383cc40f4` | fix(mobile): prevent text leaking through Android glass (#10998)             | no mobile app in this repo                                                                   |
| `444fd8bad` | fix(mobile): keep Android markdown icons aligned with text (#11079)          | no mobile app; the next upstream commit also reverts this exact patch                        |
| `3836890e4` | Revert "fix(mobile): keep Android markdown icons aligned with text" (#11098) | mobile-only revert; together with `444fd8bad` it is a net-zero upstream change for this fork |

### Verification

The focused test runs used this changed-file selector from the repository root:

```bash
repo_root=$(pwd)
changed_tests() {
  scope=$1
  {
    git -C "$repo_root" diff --name-only --diff-filter=ACMRTUXB -- "$scope"
    git -C "$repo_root" ls-files --others --exclude-standard -- "$scope"
  } | sed -n -E '/\.test\.(ts|tsx)$/p' | sed "s#^$scope/##"
}
(cd packages/contracts && vp test run $(changed_tests packages/contracts))
(cd packages/shared && vp test run $(changed_tests packages/shared))
(cd packages/client-runtime && vp test run $(changed_tests packages/client-runtime))
(cd apps/web && vp test run $(changed_tests apps/web))
(cd apps/desktop && vp test run $(changed_tests apps/desktop))
(cd apps/server && vp test run $(changed_tests apps/server))
```

The remaining checks were run with these commands from their affected workspace or the repository
root:

```bash
(cd packages/contracts && vp typecheck)
(cd packages/shared && vp typecheck)
(cd packages/client-runtime && vp typecheck)
(cd apps/web && vp typecheck)
(cd apps/desktop && vp typecheck)
(cd apps/server && vp typecheck) # exits 1 on the four pre-existing Effect diagnostics below
mapfile -d '' changed_paths < <(git diff --name-only -z)
mapfile -d '' untracked_paths < <(git ls-files --others --exclude-standard -z)
lint_paths=()
for path in "${changed_paths[@]}" "${untracked_paths[@]}"; do
  case "$path" in
    *.cjs | *.js | *.jsx | *.mjs | *.ts | *.tsx) lint_paths+=("$path") ;;
  esac
done
vp lint --report-unused-disable-directives "${lint_paths[@]}"
vp fmt --check "${changed_paths[@]}" "${untracked_paths[@]}"
npx react-doctor@latest --score --scope changed
git diff --check
```

- Focused tests pass in every affected workspace: contracts 2 files / 154 tests, shared 4 / 69,
  client runtime 10 / 171, web 19 / 683, desktop 1 / 8, and server 43 / 988 — 2,073 tests total.
- Typechecks pass for `@t3tools/contracts`, `@t3tools/shared`, `@t3tools/client-runtime`,
  `@t3tools/web` and desktop. Server reports only four pre-existing Effect diagnostics:
  suggestions in `resourceTelemetry/HostResources.ts:63,71` and warnings in
  `serverRuntimeStartup.reconcile.test.ts:102,737`. The two prior missing-`GitVcsDriver` errors
  recorded in batches 25–30 are cleared by this synced tree.
- Changed-file lint passes across 197 TypeScript/JavaScript files. Changed-file formatting and
  `git diff --check` pass.
- React Doctor's required changed-scope scan scores 45/100 before and after final reconciliation;
  no finding was introduced by the reconciliation. The remaining findings are pre-existing or
  unchanged upstream component/compiler patterns.

**Hit every applicable surface:** desktop and web entry points, server orchestration/projectors,
provider-facing runtime instructions, MCP tools, wire contracts, client runtime, local and remote
environment routing, PR link/unlink and stack actions, persisted projections, search, settings,
and user/internals docs. Mobile, hosted relay, BrowserImport and setup-wizard surfaces remain
deliberately cut.

### Not tested

- No live client or browser automation was run, per `AGENTS.md`; the composer transitions, image
  gestures, touch controls, terminal paste, remote Zed routing and PR panels have focused
  unit/type/static coverage.
- GitHub stack merge and rebase were not executed against a live repository; service/reactor and
  UI behavior are covered by focused tests.

## Batch 32 — reviewed through `b1e223e2b` (83 commits)

Reviewed `3836890e4..b1e223e2b`, with upstream snapshotted at
`b1e223e2b0d87124883b1410ab52dd6a1338e40d` for the whole run. Fork merge base remains
`083fa4ab24c464ddf01e5b7ab22135d1ebdc120b`. No commit needed a product Ask.

### Ported (66)

| Upstream    | Title                                                                             | Notes                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `e784975bb` | fix(ui): simplify multiple linked pull request badges (#11104)                    | adapted to Ronin's shared sidebar and pull-request presentation helpers                                                     |
| `0882431e0` | fix(preview): return to pip when closing the right panel (#11102)                 | adapted to the thread-scoped floating preview store                                                                         |
| `0527ddf06` | fix: quiet settled threads and simplify PR badges (#11101)                        | clean                                                                                                                       |
| `f814983c2` | fix(web): emphasize primary pull request actions (#11105)                         | clean                                                                                                                       |
| `21a5ccf88` | fix(web): prevent seams in the topbar scroll fade (#10914)                        | adapted to Ronin's split `styles/chrome.css`                                                                                |
| `21d744039` | fix(web): fit provider update text inside sidebar notices (#11034)                | clean                                                                                                                       |
| `3997b9a3a` | fix(web): align floating browser preview corners (#10915)                         | clean                                                                                                                       |
| `60eff99f2` | fix(web): save PR body edits with Cmd/Ctrl+Enter (#10660)                         | clean                                                                                                                       |
| `502131adf` | fix(web): collapse a tool call by clicking its expanded label (#11017)            | adapted to Ronin's `p`-based work-row label and public stable tool-call identity                                            |
| `dca7b59be` | feat(devices): add simulator and emulator support (#10677)                        | adapted end to end for Ronin contracts, server MCP, renderer panel, settings and docs; mobile client hunks omitted          |
| `e022fa430` | feat(devices): scope targets and sessions to their hosts (#10854)                 | adapted with host-qualified contracts, persistence and local-device compatibility                                           |
| `7734c6d71` | feat(devices): target concurrent agent sessions across hosts (#10855)             | adapted across MCP sessions, client state, floating streams and tests                                                       |
| `d2eeacd8c` | feat(devices): connect simulator hosts over SSH (#10856)                          | adapted to Ronin's existing SSH package and remote-environment model                                                        |
| `dfa345b36` | feat(web): use a compact right-panel surface menu (#11111)                        | clean                                                                                                                       |
| `a5ac76659` | fix(media): preserve playback during fullscreen transitions (#11113)              | ported with the new attachment media surfaces                                                                               |
| `c52b8d96e` | feat(command-palette): show environments in search results (#10722)               | adapted to Ronin's multi-environment project grouping                                                                       |
| `6a2d24666` | fix(pr): update labels and reviewers without redundant reloads (#11117)           | clean                                                                                                                       |
| `27eb79dc7` | fix(chat): fold question answers into tool activity (#11014)                      | adapted across client work-log derivation and transcript rendering                                                          |
| `48654c118` | fix(usage): flag unpriced model activity instead of showing $0.00 (#11021)        | ported to Ronin's cost/token usage page; upstream limits UI remains cut                                                     |
| `5735693d4` | fix(server): let Claude launch args override the derived permission mode (#11026) | clean                                                                                                                       |
| `20ef25037` | fix(editors): accept root paths and Windows servers in Zed remote links (#11044)  | adapted to Ronin's desktop protocol validation                                                                              |
| `4d06156dd` | fix(web): center pull request unavailable states (#11110)                         | clean                                                                                                                       |
| `0a37240a8` | fix(web): remove sidebar pull request link icon (#11179)                          | clean                                                                                                                       |
| `02297e3db` | fix(ui): color linked pr counts by aggregate status (#11180)                      | clean                                                                                                                       |
| `6c69534a5` | fix(preview): render website favicons for browser tool activity (#11032)          | adapted through Ronin's preview state and tool-activity icon contract; no removed native icon resolver restored             |
| `18c5a1d2d` | fix(web): simplify pull request summary sections (#10612)                         | clean                                                                                                                       |
| `ef6fa1187` | fix(web): preserve drafts when compacting context (#11103)                        | adapted to Ronin's composer draft store                                                                                     |
| `57aee3e19` | fix(server): queue messages during context compaction (#11107)                    | adapted to event-sourced orchestration with receipt-backed tests                                                            |
| `8fc253605` | perf(web): format minimap previews only when opened (#11181)                      | clean                                                                                                                       |
| `a9dabbf10` | perf(web): reuse completed Markdown prefixes while streaming (#11193)             | ported with incremental Markdown coverage                                                                                   |
| `d7d7f8f3e` | perf(web): resume syntax highlighting from completed lines (#11196)               | ported with incremental highlighter coverage                                                                                |
| `8078c532c` | perf(web): preserve completed code-line DOM while streaming (#11198)              | ported with stable highlighted-line components                                                                              |
| `211618fd9` | perf(web): huge-thread switch no longer blanks the chat pane (#11169)             | adapted to Ronin's held and remembered timeline caches                                                                      |
| `fb3d165d3` | fix(web): show platform file manager icons in Open menu (#11228)                  | adapted to Ronin's Open picker and platform labels                                                                          |
| `26894dda7` | fix(server): detect file renames in review diffs (#8086)                          | ported in Git VCS core with rename regression coverage                                                                      |
| `2b7d3a45e` | perf(web): avoid scanning chat history for sidebar backgrounds (#11206)           | clean                                                                                                                       |
| `6e8931d75` | perf(client): reduce remote request and message sync overhead (#11029)            | adapted across HTTP pagination, reducers and remote authorization                                                           |
| `fb52d125b` | fix(client-runtime): typecheck device hub ticket request on main (#11304)         | ported with the device hub access client                                                                                    |
| `8bbe2bf66` | feat(web): float device streams over chat (#11285)                                | adapted by generalizing Ronin's thread preview mini-player to browser and device sources                                    |
| `18f7254e0` | fix(web): floating preview can use the margins beside the composer (#11290)       | adapted to Ronin's composer and right-panel layout                                                                          |
| `e145c5f22` | perf(client-runtime): speed up message sync on desktop and mobile (#11302)        | adapted to preserve transport batches without importing the skipped setup-wizard subscription abstraction                   |
| `15c6167bc` | fix(web): use the configured panel shortcut on the PR page (#11292)               | clean                                                                                                                       |
| `b3ed07fb3` | feat(web): add PR page selections to new draft threads (#11296)                   | adapted to structured composer context records                                                                              |
| `0eaa18c12` | feat(web): show recording status on floating previews (#11312)                    | adapted for browser mini-player recording state                                                                             |
| `095d57552` | fix(desktop): hold-to-quit no longer strands the quit (#11016)                    | clean                                                                                                                       |
| `4a8ab1b72` | feat(web): mark projects on another machine in project pickers (#11323)           | adapted to Ronin environment badges and command palette                                                                     |
| `871192933` | fix(web): show pointer cursors on pull request controls (#11283)                  | clean                                                                                                                       |
| `867eb9bff` | fix(web): themed panel toggles show their disabled state (#11188)                 | clean                                                                                                                       |
| `50791a053` | fix(web): use branch wording in commit dialogs (#11281)                           | clean                                                                                                                       |
| `a92161a05` | fix(codex): preserve qualified model ids in selection and generation (#9921)      | adapted through shared model normalization, manifest and text generation                                                    |
| `8a2d5f545` | fix(test): drain worker broadcasts before restoring browser globals (#11349)      | clean                                                                                                                       |
| `8461c25ff` | fix(web): disable linked pull requests when none are linked (#11348)              | clean                                                                                                                       |
| `1f73a89fc` | fix(models): default to astra medium and fable 5.1 medium (#11347)                | adapted to Ronin's model manifest and composer defaults                                                                     |
| `4d16e6bc6` | fix(web): align provider settings with shared settings rows (#10571)              | adapted without the skipped project-scope settings UI                                                                       |
| `cf1ba3d7d` | feat(settings): configure default permissions for new threads (#11346)            | adapted across shared settings and new-thread composition; cut onboarding surfaces omitted                                  |
| `fd5553f1a` | fix: restore provider history and prompts when rewinding (#11338)                 | adapted for Claude and Codex history; Cursor and Grok explicitly reject unsupported rollback                                |
| `25da98603` | fix(web): keep comment actions visible when pr comments are folded (#11357)       | clean                                                                                                                       |
| `efccda9ac` | feat: rewind conversations while keeping file changes (#11358)                    | adapted across checkpoint receipts, OpenCode rollback and composer UI; Claude reset boundaries are cleared safely           |
| `38827789c` | fix(web): keep sidebar scroll position when pinning threads (#10757)              | clean                                                                                                                       |
| `8eec78cf8` | fix(web): remove pr description reactions (#11361)                                | clean                                                                                                                       |
| `e81606494` | fix(desktop): keep preview keystrokes out of the composer (#11354)                | adapted to Ronin's Electron preview keyboard routing                                                                        |
| `4a4c6dd2a` | feat(settings): add open source license notices (#8962)                           | adapted to desktop/web bundles only; mobile-only notices and missing mobile paths were removed                              |
| `ca6416ec2` | perf(client): reduce repeated sorting and date formatting (#11019)                | ported across thread ordering and shared date formatting                                                                    |
| `4fed6cfb3` | feat: add inline file previews and attachment chips across surfaces (#11265)      | adapted across contracts, persistence, media range serving and structured transcript context; preserves legacy placeholders |
| `57b23a09f` | fix(desktop): preserve long offscreen text in SnapShots (#11250)                  | adapted across macOS, Windows and Linux accessibility snapshots                                                             |
| `b1e223e2b` | perf(server): avoid workspace scans when loading pull requests (#11299)           | ported with focused pull-request service coverage                                                                           |

### Already in the tree (1)

| Upstream    | Title                                                            | Where it lives                                                                                                                                         |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `5eecc24a1` | fix(cli): pin shared Effect dependency for npm installs (#11240) | `apps/server/package.json`, the workspace catalog and `pnpm-lock.yaml` already directly pin `@effect/platform-node-shared` at Ronin's Effect beta line |

### Skipped (16)

| Upstream    | Title                                                                            | Why                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `32b690934` | fix(mobile): keep Android markdown icons aligned (#11118)                        | no mobile app in this repo                                                                                                                        |
| `47dbb06c3` | fix(mobile): add close controls to tablet files and terminal (#11115)            | same                                                                                                                                              |
| `96f43708a` | fix(mobile): preserve the final composer animation frame (#11114)                | same                                                                                                                                              |
| `859304b78` | fix(mobile): keep composer transitions aligned (#11127)                          | same                                                                                                                                              |
| `1a9336bcd` | refactor(mobile): name shared markdown renderer without iOS suffixes (#11128)    | same                                                                                                                                              |
| `39ca4171e` | fix(marketing): redirect /app to app.t3.codes (#11145)                           | Ronin has no marketing site                                                                                                                       |
| `2afa02a28` | chore(marketing): update to 300k users and 22k stars (#11146)                    | same                                                                                                                                              |
| `2ebc9fa4e` | fix(mobile): prevent Hermes crashes when opening threads (#11233)                | Hermes-only compatibility changes; Ronin's desktop/web runtimes support `toSorted` and `toReversed`                                               |
| `05d404210` | feat(web): open Usage on the Limits tab by default (#11261)                      | Ronin does not carry upstream's account/hub Limits metric; its Usage page exposes cost and tokens only                                            |
| `7bd7f99e6` | perf(mobile): reuse completed code lines while streaming (#11211)                | no mobile app in this repo; the equivalent web optimization was ported                                                                            |
| `e1c94f703` | fix(web): refresh usage limit countdowns without switching tabs (#11187)         | depends on the same cut Limits presentation stack                                                                                                 |
| `2c0e89174` | feat(settings): add per-project overrides for scopable server settings (#11176)  | upstream project-scope settings machinery is not part of Ronin's simpler environment settings model                                               |
| `8b2c0465d` | feat(web): pick settings environment and project as two selects (#10636)         | depends on the skipped project-scope settings axis                                                                                                |
| `e22040dfc` | feat(settings): edit any scopable setting as a project override (#10639)         | depends on the same server/UI inheritance stack; generic provider-row and default-permission changes came from their independent upstream commits |
| `cd64ad384` | fix(mobile): keep Android file icons on the line with wrapped filenames (#11234) | no mobile app in this repo                                                                                                                        |
| `36668dbe4` | feat(desktop): share macOS permission onboarding (#11289)                        | primarily centralizes BrowserImport and setup-wizard permission flows that Ronin removed; SnapShot keeps its existing dedicated permission UI     |

### Verification

- `vp test run` over all 131 changed tests in desktop, server, web, client runtime, contracts and
  shared: **131 files / 3,189 tests pass**. The separate license-generator suite passes **1 file /
  16 tests**.
- Typecheck passes for `@t3tools/web`, `@t3tools/desktop`, `@t3tools/client-runtime`,
  `@t3tools/contracts` and `@t3tools/shared`. Server typecheck reports only the established
  `resourceTelemetry/HostResources.ts:63,71` recovery suggestions and
  `serverRuntimeStartup.reconcile.test.ts:103,738` multiple-provide warnings; new diagnostics from
  the port were cleared.
- Changed-file lint exits successfully across 374 TypeScript/JavaScript files with 11 non-blocking
  warnings from the device WebSocket/test mock event style and one existing Electron mock class.
- React Doctor's required changed-scope scan scores 45/100 before and after reconciliation, with
  the identical 369-diagnostic backlog; no regression was introduced.
- `vp fmt --check` over 392 matched changed/untracked files and `git diff --check` pass. The
  83-commit ledger matches the fixed review range: 66 ported, 1 already present and 16 skipped.

**Hit every applicable surface:** desktop Electron/IPC, the shared web renderer, server
orchestration/checkpoint/provider/MCP/device/asset paths, wire contracts, client runtime, local and
remote/SSH environments, settings/command-palette/keybinding entry points, reverse rewind and device
states, and user/internals docs. Mobile, marketing, BrowserImport, managed usage limits,
per-project setting inheritance and removed preview-pick/native-PiP actions remain deliberately cut.

### Not tested

- No live client or browser automation was run, per `AGENTS.md`; device streaming, floating preview,
  context chips, media playback, pull-request surfaces and settings have unit/type/static coverage.
- No simulator/emulator, SSH device host, real provider rollback, GitHub mutation or platform
  accessibility capture was exercised against external systems; their contracts, adapters,
  orchestration and focused regressions are covered locally.

## Batch 33 — reviewed through `9375c7797` (84 commits)

Reviewed `b1e223e2b..9375c7797`, with upstream snapshotted at
`9375c779707fb95c06670db6da87441720b2d2e2` for the whole run. Fork merge base remains
`083fa4ab24c464ddf01e5b7ab22135d1ebdc120b`. No commit needed a product Ask.

### Ported (59)

| Upstream    | Title                                                                                      | Notes                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `d1d15c67f` | feat(sidebar): fold the project scope into the search row (#11315)                         | adapted to Ronin's environment-aware project search                                     |
| `a43f9b45a` | fix(web): preserve snapshot preview size in sent messages (#11429)                         | clean                                                                                   |
| `c542b781c` | fix(desktop): keep the native preview User-Agent so Turnstile passes (#7110)               | adapted to Ronin's Electron preview session                                             |
| `348645152` | fix(chat): keep user input outside collapsed work (#11363)                                 | clean                                                                                   |
| `cfeaca41a` | fix(web): preserve preview focus on window return (#11444)                                 | adapted to Ronin's browser preview controller                                           |
| `03e135577` | fix(web): complete thread status icons and keep input threads prominent (#11461)           | adapted across Ronin's sidebar status presentation                                      |
| `75d8b132c` | feat(web): tint image chips with their average color (#11468)                              | clean                                                                                   |
| `c1ff6ab3d` | fix(web): move viewer controls outside media and restore arrow navigation (#11470)         | clean                                                                                   |
| `b0c6c3b2f` | fix(web): tighten sidebar search and footer spacing (#11466)                               | adapted to the folded project-search row                                                |
| `c0ddfb3a8` | feat(web): subagent spawns render as an expandable work row (#11433)                       | adapted to Ronin's orchestration timeline                                               |
| `af2baccd1` | fix(web): keep subagent rows visible under folded turns (#11474)                           | clean                                                                                   |
| `8ddd9f7ef` | fix(desktop): bound backend shutdown wait during quit (#7599)                              | clean                                                                                   |
| `36caf200c` | feat(web): choose the default diff file state (#11484)                                     | clean                                                                                   |
| `68c2277f5` | feat(composer): fold large pastes into text attachments (#11442)                           | adapted to Ronin's composer draft persistence and desktop paste path                    |
| `6cdbf76fa` | feat(web): expose each chat message as a heading for screen readers (#11199)               | clean                                                                                   |
| `2db675aef` | fix(usage): respect provider account homes (#11485)                                        | adapted to Ronin's transcript-backed usage service                                      |
| `2587c8060` | feat(web): switch saved environments off instead of removing them (#11478)                 | adapted across connection storage, resolver and settings                                |
| `c29976458` | fix(server): open Cursor links in classic IDE mode (#11498)                                | clean                                                                                   |
| `6fd68f5c3` | feat(source-control): support Forgejo and Gitea with fj and tea (#11436)                   | ported through discovery, pull-request providers, contracts and UI presentation         |
| `0c5771d60` | fix(web): match draft row heights to thread rows (#11512)                                  | clean                                                                                   |
| `3138f5716` | fix(grok): emit task lifecycle for monitors and background shells (#9139)                  | adapted to Ronin's Grok adapter and runtime ingestion                                   |
| `46140c96a` | fix(web): unify panel resizing and retain final drag width (#11529)                        | adapted through the shared resize-drag hook and persisted widths                        |
| `2ec59ca1f` | fix(web): hide back button for single linked pull requests (#11520)                        | clean                                                                                   |
| `21d53ca2e` | fix(files): browse ignored files and load folders on demand (#11527)                       | adapted to Ronin's project file browser and query state                                 |
| `d7c71f91d` | feat(web): float the pull request comment composer (#11531)                                | clean                                                                                   |
| `db6e0531e` | feat(github): route pull request operations across matching accounts (#11367)              | adapted end to end across settings, client routing, server providers and MCP tools      |
| `20363c32c` | feat(web): add provider selector to pull request toolbar (#11524)                          | adapted to Ronin's provider-instance model                                              |
| `4a39cade9` | fix(web): offer recovery from missing pages (#11314)                                       | adapted to the renderer root error boundary                                             |
| `e62868393` | fix(web): retry startup after the server recovers (#11291)                                 | adapted to Ronin's primary-environment bootstrap                                        |
| `42b6bcc6f` | feat(web): add opt-in in-app thread notifications (#11570)                                 | adapted to Ronin's existing agent-attention notifications and desktop badge integration |
| `f26198d79` | feat(web): organize connections by environment (#11542)                                    | ported as the intermediate settings model later superseded by `5e961d3d7`               |
| `0118b5229` | fix(web): keep sparse sidebar shelves at the bottom (#11595)                               | clean                                                                                   |
| `9bf349cf6` | fix(cursor): preserve internal agent errors without transport labels (#11365)              | clean                                                                                   |
| `dd6ba84dc` | fix(server): fall back when new worktrees are unavailable (#6208)                          | ported with explicit setup-stage tracking and recovery coverage                         |
| `6e5e986f1` | feat: badge background thread notifications on desktop and web (#11569)                    | adapted across Electron IPC, window state and renderer notifications                    |
| `3689c98d2` | fix(web): separate expanded tool output from adjacent hover highlights (#11658)            | adapted to Ronin's shared work-row surfaces                                             |
| `66e39ca2a` | fix(web): apply device settings to selected environments (#11541)                          | adapted to Ronin's environment settings without importing project-scope inheritance     |
| `c07575f57` | feat(server): show finished paragraphs and code blocks while the response streams (#11062) | adapted in provider ingestion and Markdown timeline rendering                           |
| `2d7374650` | fix(web): disconnect offline servers from threads (#11671)                                 | adapted with a delayed disconnect hook to avoid transient churn                         |
| `5e961d3d7` | feat(web): flatten the connections page into one environments list (#11672)                | adapted to Ronin's simpler environment-only settings model                              |
| `3b75e607e` | feat(server): add reusable auth token for dev worktrees (#8606)                            | adapted across local bootstrap, HTTP auth and remote docs                               |
| `1bbca0e78` | feat(settings): choose how responses stream, with a warning on legacy token mode (#11678)  | adapted without upstream project-scoped settings machinery                              |
| `683aa8709` | build(desktop): bundle the main process and stage only its native externals (#11410)       | adapted to Ronin's desktop build and patched native dependencies                        |
| `06de59b3d` | build(server): make the CLI bundle loadable as a Node single-executable (#11316)           | adapted to the Ronin CLI and worker entry points                                        |
| `eb8f6f42a` | ci(release): build, sign, and publish self-contained CLI archives (#11317)                 | adapted to Ronin's release workflow and supported desktop architectures                 |
| `8f90b380f` | feat(server): install preview runtimes from release archives (#11318)                      | adapted to release-archive runtime management                                           |
| `13c134c10` | feat(ssh): run preview builds on remotes from the release archive (#11319)                 | adapted to Ronin's SSH tunnel and runner process                                        |
| `c7f23c466` | feat(cli): add t3 update for self-contained installs (#11451)                              | ported with archive resolution and focused CLI coverage                                 |
| `af6c138a0` | feat(server): manage runtimes as release archives only, never from npm (#11510)            | adapted while retaining compatibility with Ronin's existing npm-installed service       |
| `2c54f2ff1` | ci(release): build CLI archives for five targets, each on its own architecture (#11605)    | adapted to Ronin's three shipped targets: macOS arm64, Linux x64 and Windows x64        |
| `b70015b6d` | feat(cli): add t3 uninstall for self-contained installs (#11659)                           | ported with service and archive cleanup coverage                                        |
| `73b206f4b` | feat(web): show each worktree setup step and let users cancel it (#11372)                  | adapted across contracts, setup tracking, orchestration and chat UI                     |
| `1ced38a66` | fix(server): skip device hosts that resolve to the local machine (#11698)                  | ported at the device-host boundary with focused address coverage                        |
| `cba7dd778` | feat(desktop): allow disabling the local environment (#9194)                               | adapted across Electron IPC, connection catalog and renderer settings                   |
| `d8655ed2f` | feat(cli): add t3 service restart and make t3 update repoint the service eagerly (#11702)  | ported through service lifecycle and updater coverage                                   |
| `0dec07d91` | fix(web): keep large image previews from stalling composer typing (#11324)                 | ported with async image compression and attachment coverage                             |
| `8ef478eb0` | fix(server): avoid extra round trips for terminal output (#11407)                          | ported through a batched output protocol and PTY coverage                               |
| `6f00d3881` | fix(web): remember panel width for each thread (#11310)                                    | adapted to Ronin's per-thread UI state                                                  |
| `9375c7797` | fix(release): preserve updates from npm-based services (#11732)                            | adapted to distinguish executable installs while preserving Ronin's npm service path    |

### Already in the tree (2)

| Upstream    | Title                                                          | Where it lives                                                                                                                          |
| ----------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `534952210` | Delete .pnpm-store/v11 directory                               | Ronin does not track the deleted package-store cache                                                                                    |
| `0e0ddaeed` | feat(web): add opt-in thread notifications and sounds (#11481) | Ronin already has opt-in agent notifications and sounds in `AgentAttentionNotifier`, UI state, settings and desktop-compatible web APIs |

### Skipped (23)

| Upstream    | Title                                                                                              | Why                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `18d8cbfd9` | fix(mobile): pin expo-audio so the release smoke patch stays in use (#11426)                       | no mobile app in this repo                                                                                                      |
| `bbedad027` | fix(mobile): render photo library picks to a bounded JPEG off the JS thread (#11440)               | same                                                                                                                            |
| `fcbe45796` | fix(usage): make unavailable account limits more visible (#10601)                                  | Ronin's usage page reports transcript-backed cost and tokens, not upstream's managed account-limit API                          |
| `5781e2be2` | fix(mobile): stop crashing on launch when a thread has a PR stack (#11486)                         | no mobile app in this repo                                                                                                      |
| `af0657e3b` | fix(mobile): stop alerting that shared content vanished after sending it (#11487)                  | same                                                                                                                            |
| `8b3ddf51c` | fix(mobile): stop crashing on launch before the shell snapshot arrives (#11537)                    | same                                                                                                                            |
| `20a8f1de3` | chore(mobile): enable noUncheckedIndexedAccess and noImplicitOverride (#11538)                     | same                                                                                                                            |
| `0a91b9a11` | feat(mobile): show startup crashes in Settings → Diagnostics (#11540)                              | same                                                                                                                            |
| `17f8e2a8a` | feat(mobile): add pooled subscription usage widgets (#11506)                                       | same; Ronin also omits the managed subscription-usage API                                                                       |
| `ca2cc1339` | feat(web): add optional compact sidebar rail (#11525)                                              | compact sidebar series was reverted upstream and is absent from Ronin                                                           |
| `77bca8b2d` | feat(web): add compact thread list mode (#9417)                                                    | same                                                                                                                            |
| `df7ccc8fd` | feat(web): refine compact thread row badges (#11644)                                               | same                                                                                                                            |
| `7b6109988` | feat(web): show the linked pull request in the compact sidebar rail (#11652)                       | same                                                                                                                            |
| `9086a1f71` | fix(mobile): adopt system glass for Live Activities (#11604)                                       | no mobile app in this repo                                                                                                      |
| `564719165` | fix(mobile): keep usage widget rows consistently sized (#11669)                                    | same                                                                                                                            |
| `d81278aa6` | revert(web): remove the compact sidebar (#11685)                                                   | no-op because the compact sidebar commits were not ported                                                                       |
| `07549200d` | feat(desktop): run the WSL backend from the Linux CLI archive (#11511)                             | Ronin deliberately has no WSL backend                                                                                           |
| `2f7616ef1` | ci(release): build the JS bundle once and run every platform and architecture in parallel (#11606) | depends on upstream's reusable five-target release workflow; Ronin keeps its simpler three-target release job                   |
| `91cd91c08` | feat(release): publish npx t3 as a launcher over per-platform executable packages (#11607)         | Ronin continues publishing the full `t3` npm package; per-platform scoped launcher packages are not part of its release surface |
| `8984f8103` | fix(web): test device hosts across selected environments (#11699)                                  | depends on upstream SettingsScope/project-inheritance infrastructure that Ronin intentionally does not carry                    |
| `0b54e00f9` | Change input type from 'full_diff' to 'incremental'                                                | repository-governance prompt change outside Ronin's product and contributor docs                                                |
| `e3792a53f` | Update model and input type in ui-consistency.md                                                   | same                                                                                                                            |
| `01e05c152` | docs(claude): clarify OpenRouter model selection (#11369)                                          | documents upstream Claude Code configuration that Ronin does not own                                                            |

### Verification

- Focused tests pass across contracts, shared, client runtime, SSH, web, desktop, server and release
  scripts: **113 files / 2,952 tests pass**, with one intentional skip.
- Typechecks pass for `@t3tools/contracts`, `@t3tools/shared`, `@t3tools/client-runtime`,
  `@t3tools/ssh`, `@t3tools/web`, `@t3tools/desktop` and server. Client runtime reports two
  non-blocking Effect suggestions in existing tests; server reports the four established
  `HostResources` recovery and reconcile-test layer-provision diagnostics.
- Changed-file lint, changed-file formatting and `git diff --check` pass. React Doctor improves
  from 42/100 to 43/100 after final lint cleanup; its remaining changed-scope diagnostics are the
  branch's established component/compiler backlog, not a regression introduced by reconciliation.
- The server production bundle builds successfully with the main CLI and Claude-history worker.
  The 84-commit ledger matches the fixed range: 59 ported, 2 already present and 23 skipped.

**Hit every applicable surface:** desktop Electron/IPC and packaging, web renderer entry points,
server auth/orchestration/providers/source-control/terminal/CLI, shared contracts and client runtime,
local and remote/SSH environments, settings and docs. Mobile, WSL, hosted account limits,
project-scoped settings inheritance, compact sidebar and scoped npm launcher packages remain
deliberately cut.

### Not tested

- No live client or browser automation was run, per `AGENTS.md`; user-visible behavior has focused
  unit, type and static coverage.
- No signed release archive, updater/uninstaller mutation, real SSH remote, Forgejo/Gitea host,
  provider session or desktop notification was exercised against an external system.

## Batch 34 — reviewed through `3efdcc529` (59 commits)

Reviewed `8b1ea4dd2..3efdcc529`, with upstream snapshotted at
`3efdcc5296f1754e0f3bf7fee5fc2ada510e0438` for the whole run. Fork merge base remains
`083fa4ab24c464ddf01e5b7ab22135d1ebdc120b`. No commit needed a product Ask.

### Ported (34)

| Upstream    | Title                                                                                        | Notes                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `955b787e6` | fix(server): parse CLI versions with a "v" prefix (#11738)                                   | clean                                                                                                       |
| `494cfac24` | Allow setting T3CODE_OTLP_HEADERS (#11218)                                                   | ported without upstream's WSL environment plumbing                                                          |
| `47ace9496` | fix(web): use consistent PR section toggles (#11763)                                         | clean                                                                                                       |
| `33118d9ab` | Add T3CODE_OTLP_PROTOCOL to allow protobuf protocol (#11224)                                 | ported without upstream's WSL environment plumbing                                                          |
| `9130d932f` | feat(web): add composer and PR number shortcuts (#11615)                                     | adapted to Ronin's composer controls and preserved Ask on the Side by assigning mode to `mod+shift+r`       |
| `112a7088d` | fix(web): use project monograms for automatic icon fallbacks (#11572)                        | adapted to Ronin's existing favicon API while supporting explicit and automatic monograms                   |
| `8d7c700c1` | feat(web): clone repositories in the background instead of holding the palette open (#11762) | ported across contracts, server tracking, command palette, composer gating, retry/removal and global toasts |
| `793122797` | fix(server): stop refreshing providers on every config subscription (#11811)                 | adapted to Ronin's server WebSocket setup                                                                   |
| `5bf43c9f3` | fix(web): align monogram project icons in menus (#11806)                                     | clean                                                                                                       |
| `014016a62` | fix(web): make copy PR link discoverable in keybindings (#11826)                             | adapted to Ronin's PR detail panel and command registry                                                     |
| `3be02ae57` | feat: add custom snooze dates and durations (#11800)                                         | ported for desktop/web and client runtime; mobile hunks omitted                                             |
| `5ea643981` | feat(web): inline worktree setup rows and async setup scripts (#11832)                       | adapted to Ronin's timeline and project settings; removed upstream settings surface omitted                 |
| `b5b29e7b8` | fix(server): stream tight list items one at a time in paragraph mode (#11833)                | clean                                                                                                       |
| `7cafe52bb` | fix(server): keep thread titles tied to user intent (#10720)                                 | adapted across contracts, projection state, migration `060`, generation and refinement workers              |
| `08abda9dc` | refactor(server): resolve title links through source control providers (#11844)              | adapted to Ronin's source-control provider registry                                                         |
| `a62e7d670` | refactor(server): align title generation with Effect conventions (#11847)                    | clean                                                                                                       |
| `5623089ae` | fix(server): disable color probes in worktree setup (#11843)                                 | clean                                                                                                       |
| `0310cbf9f` | fix: keep worktree setup visible after leaving and reopening the thread (#11836)             | adapted to Ronin's recorded-activity timeline                                                               |
| `b20d29dc4` | fix(desktop): prevent startup from running twice (#11857)                                    | ported with focused Electron startup coverage                                                               |
| `2c19283af` | feat(server): persist the worktree setup send and progress on the thread (#11852)            | adapted across setup tracking, startup recovery and timeline rendering                                      |
| `cc839c42b` | feat(web): queue messages sent client-side while the agent is working (#11673)               | adapted to Ronin's composer, optimistic timeline and turn lifecycle                                         |
| `5b377e2a0` | fix(server): bound Git process bursts to keep connections responsive (#11405)                | ported through the shared Git workflow semaphore                                                            |
| `a37b85279` | perf(server): speed up worktree fetch and checkout (#11633)                                  | clean                                                                                                       |
| `9ea892e3b` | fix(client): show thread state changes before remote replies (#11408)                        | ported in client runtime; mobile hooks omitted                                                              |
| `3c4c9a125` | fix(web): restore composer focus after closing option menus (#11884)                         | adapted across every composer-owned select, menu, combobox and popover                                      |
| `bf3be75c4` | fix(web): center refresh devices in the empty state (#11808)                                 | clean                                                                                                       |
| `ae53072af` | fix(web): keep the composer ready during background worktree setup (#11883)                  | adapted to Ronin's send gate and async setup handoff                                                        |
| `c1b221041` | fix(desktop): keep the sidebar brand and window buttons aligned (#11906)                     | adapted to Ronin's 44px titlebar and Electron inset handling                                                |
| `9a6b57be2` | fix(web): drop the filled well behind the sidebar header buttons (#11660)                    | clean                                                                                                       |
| `2a264adc6` | fix(server): explain how to configure a missing Codex executable (#11345)                    | clean                                                                                                       |
| `438465d6b` | feat: add customizable soft-tint project monograms (#11845)                                  | ported through contracts, picker, favicon rendering and backwards-compatible encoding                       |
| `24b711b7f` | fix: multiple UI and server bug fixes (#11593)                                               | adapted Forgejo, z-order, model picker and dialog no-drag fixes; mobile hunks omitted                       |
| `7235701de` | fix(server): release preview hosts after unanswered requests (#11381)                        | clean                                                                                                       |
| `3efdcc529` | Preserve diff tree order and collapsed folders (#11931)                                      | adapted to Ronin's diff tree logic and component coverage                                                   |

### Already in the tree (1)

| Upstream    | Title                                                             | Where it lives                                                                                          |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ec5ede5e6` | fix(web): open video attachment thumbnails in the viewer (#11734) | `MessagesTimeline.tsx` already opens attachments through `ctx.onFileOpen(file)` with an in-flight state |

### Skipped (24)

| Upstream    | Title                                                                                       | Why                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `8b1ea4dd2` | fix(desktop): restore Node discovery for WSL providers (#11741)                             | Ronin deliberately has no WSL backend                                                                          |
| `ae67c5b81` | fix(release): stop npm from pruning the platform packages' shipped node_modules (#11750)    | depends on the scoped platform npm launcher packages that Ronin intentionally does not publish                 |
| `05e3bcbc6` | fix(desktop): keep preview releases out of the nightly update changelog (#11753)            | upstream update surface is absent from this fork                                                               |
| `f328db30d` | chore(server): keep the legacy service entry point to the npm package only (#11770)         | Ronin retains npm-service and archive compatibility                                                            |
| `549d182aa` | feat(mobile): clone repositories in the background and gate the draft on the clone (#11774) | no mobile app in this repo                                                                                     |
| `9d4bb550a` | fix(mobile): scale inline pills with Dynamic Type (#11792)                                  | same                                                                                                           |
| `bcc20249c` | chore(deps): bump the Clerk stack to current releases (#11764)                              | Clerk cut                                                                                                      |
| `0f21fcbb6` | feat(mobile): add a T3 Connect page to the Clerk profile (#11765)                           | no mobile app and T3 Connect cut                                                                               |
| `dc0869b60` | feat(server): use Clerk's device authorization grant for headless connect login (#11794)    | Clerk and T3 Connect cut                                                                                       |
| `84192388b` | Add new GitHub user f-trycua                                                                | upstream governance file                                                                                       |
| `9a49d6d5a` | ci(desktop): sign fork PR macOS previews without exposing signing secrets (#11760)          | depends on upstream Clerk/relay/WSL release governance; adopting it would require a separate operations design |
| `ea6af5924` | feat(mobile): redesign the Android agent activity card (#11645)                             | no mobile app in this repo                                                                                     |
| `6dbea7ed0` | chore(mobile): bump app version to 1.2.0                                                    | same                                                                                                           |
| `e9b055588` | Remove labels from effect service conventions                                               | Macroscope governance prompt, not product or contributor documentation                                         |
| `537dc0fe1` | Remove labels from ui-consistency.md                                                        | same                                                                                                           |
| `970a8730e` | Change conclusion status from failure to neutral                                            | same                                                                                                           |
| `8b9f6d3d5` | Change conclusion from 'failure' to 'neutral'                                               | same                                                                                                           |
| `26b8f985d` | feat(mobile): add iPad keyboard shortcuts and command palette (#11679)                      | no mobile app in this repo                                                                                     |
| `6ecc15fa2` | fix(mobile): restrict row highlighting to pointer input (#11863)                            | same                                                                                                           |
| `50ff4c371` | fix(mobile): ensure a compatible native client before verification (#11862)                 | same                                                                                                           |
| `e33b710d5` | fix(mobile): match command palette colors to sheets (#11861)                                | same                                                                                                           |
| `d1790aa14` | fix(mobile): add missing thread rename action (#11503)                                      | same                                                                                                           |
| `caf8b5d79` | fix(mobile): wait for thread deep link hydration (#11502)                                   | same                                                                                                           |
| `d07ffbe35` | fix(mobile): keep iOS chat rows aligned after measurement (#11813)                          | same                                                                                                           |

### Verification

- `vp i --frozen-lockfile` succeeds after adding only the web calendar dependency needed for
  custom snooze controls.
- All six applicable scoped typechecks pass: server, web, desktop, client runtime, contracts and
  shared. Their existing non-blocking Effect suggestions remain informational.
- `vp test run` over every changed or added test passes: **63 files / 1,957 tests**.
- Changed-file lint completes with no diagnostics; `vp fmt --check` over **189** matched files and
  `git diff --check` pass.
- React Doctor's required changed-scope scan completes at **50/100**. A clean-checkout reference
  scan scores 8/100 (and falls back to the full 1,146-file surface because it has no changed files),
  so the port does not regress the audit; the remaining findings are the fork's established large-
  component/compiler backlog.
- The 59-commit ledger matches the frozen range: **34 ported, 1 already present and 24 skipped**.

**Hit every applicable surface:** desktop Electron/preload/build, web chat/sidebar/settings/command
palette/keybindings/pull requests/diffs, server orchestration/projections/persistence/provider/source
control/preview/CLI, wire contracts, client runtime, shared helpers, local and remote environments,
reverse clone/snooze/setup states, and user/operations docs. Mobile, WSL, Clerk/T3 Connect, updater,
scoped npm launchers, Macroscope governance and upstream-only signing infrastructure remain
deliberately cut.

### Not tested

- No live client or browser automation was run, per `AGENTS.md`; user-visible behavior has focused
  unit, type, lint, formatting and React static-analysis coverage.
- No real provider process, remote host, repository clone, preview host, GitHub mutation, signed
  release or platform accessibility capture was exercised against external systems.

## Batch 35 — reviewed through `dfbb11bdd` (181 commits)

Reviewed `3efdcc529..dfbb11bdd`, with upstream snapshotted at
`dfbb11bdd7c3f1a5575cb55d3e3abb12be025727` for the whole run. Fork merge base remains
`083fa4ab24c464ddf01e5b7ab22135d1ebdc120b`. No commit needed a product Ask.

### Chronological ledger

|   # | Upstream    | Verdict | Title                                                                                                        | Notes                                                                                                                                   |
| --: | ----------- | ------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | `a5da32750` | Port    | fix(client-runtime): preserve cached turns and older-page loading (#8309)                                    | Applied cached-turn and older-page preservation in client runtime.                                                                      |
|   2 | `844203d4f` | Skip    | chore(deps): bump Clerk stack to latest stable versions (#11956)                                             | Clerk is deliberately cut.                                                                                                              |
|   3 | `b18a560bb` | Skip    | fix(mobile): update Reanimated and Worklets (#11957)                                                         | No mobile app in this repo.                                                                                                             |
|   4 | `96bddf812` | Port    | fix(desktop): paste as text no longer doubles the pasted text (#11958)                                       | Applied the Electron paste-as-text fix with desktop coverage.                                                                           |
|   5 | `719a76ca1` | Port    | feat(web): choose queue or steer for follow-up messages (#11964)                                             | Ported queue/steer behavior through settings, composer controls, keybindings, and docs.                                                 |
|   6 | `e6ae764f4` | Skip    | feat(mobile): add v2 preview store builds (#11966)                                                           | No mobile app in this repo.                                                                                                             |
|   7 | `2c16c1d26` | Port    | fix(mobile): block incompatible server connections (#11974)                                                  | Ported shared compatibility handling; mobile and hosted-relay pieces were omitted.                                                      |
|   8 | `f0a0ead94` | Port    | fix(web): keep PR controls readable in narrow panels (#11962)                                                | Applied the narrow-panel pull-request control layout.                                                                                   |
|   9 | `b84f63bb1` | Skip    | fix(server): block updates under legacy service launchers (#11940)                                           | Ronin retains legacy service-launch compatibility.                                                                                      |
|  10 | `f4600d77d` | Port    | fix: reduce GitHub quota use with sharing enabled (#11888)                                                   | Ported GitHub budget sharing to reduce duplicate quota use.                                                                             |
|  11 | `87a12b53f` | Skip    | fix(usage): refresh limits when the tab opens (#11928)                                                       | The upstream subscription-limit surface is not carried in Ronin.                                                                        |
|  12 | `6f7aaffe2` | Skip    | fix(contracts): avoid Intl.Segmenter in monogram validation (Hermes crash) (#11984)                          | No mobile app in this repo.                                                                                                             |
|  13 | `37a8ab2b2` | Skip    | feat(lint): extend Hermes API bans with a configurable API list (#11982)                                     | No mobile app in this repo.                                                                                                             |
|  14 | `b12c92f69` | Port    | fix(server): reuse Git index metadata during checkpoint capture (#10792)                                     | Ported Git index reuse on the checkpoint capture path.                                                                                  |
|  15 | `7a368fe7c` | Port    | refactor: give project monograms their own icon variant (#11993)                                             | Adapted monograms into Ronin's explicit project-icon variant.                                                                           |
|  16 | `935c55b37` | Port    | fix(clients): disable incompatible environments during discovery (#11990)                                    | Ported incompatible-environment discovery behavior without hosted-relay branches.                                                       |
|  17 | `8c18b5bb2` | Skip    | fix(antigravity): stop health checks from filling the disk with _MEI folders (#12008)                        | The upstream packaged Antigravity helper path is absent from Ronin's runtime.                                                           |
|  18 | `0ec2b08a9` | Skip    | fix(mobile): bare t3code:// links no longer reset navigation to Home (#12002)                                | No mobile app in this repo.                                                                                                             |
|  19 | `eed974c12` | Port    | fix(server): keep Claude rewind when fork history length changes (#11954)                                    | Applied the Claude rewind history fix.                                                                                                  |
|  20 | `f8500f112` | Skip    | fix(mobile): use native toolbar search for licenses (#12011)                                                 | No mobile app in this repo.                                                                                                             |
|  21 | `0bf2d6b01` | Skip    | chore(release): prepare v0.0.41                                                                              | Upstream release-version bookkeeping is not portable to the fork.                                                                       |
|  22 | `47ef0177d` | Skip    | Revert "chore(release): prepare v0.0.41"                                                                     | Upstream release-version bookkeeping is not portable to the fork.                                                                       |
|  23 | `3060cc461` | Port    | fix(release): restrict stable channels to main                                                               | Ported stable-channel gating and its release-script coverage.                                                                           |
|  24 | `53612cc04` | Skip    | fix(server): detect unsupported legacy Android command-line tools (#12017)                                   | No mobile app in this repo.                                                                                                             |
|  25 | `fe896e6a9` | Skip    | chore(release): prepare v0.0.42                                                                              | Upstream release-version bookkeeping is not portable to the fork.                                                                       |
|  26 | `0f5a1513e` | Port    | fix(web): stop the worktree setup card from flashing and shifting (#12015)                                   | Adapted setup-card stability to Ronin's recorded-activity timeline.                                                                     |
|  27 | `c1b2ed650` | Port    | fix(clients): show unsupported environments as neutral rows with their machine icon (#12026)                 | Ported neutral unsupported rows and retained discovered machine icons.                                                                  |
|  28 | `6ee03240b` | Skip    | fix(clients): hold the discovered machine icon across relay refreshes (#12030)                               | Hosted relay is deliberately cut.                                                                                                       |
|  29 | `bf55408a5` | Port    | fix(server): resolve Node for standalone helper scripts (#12033)                                             | Adapted helper-script Node resolution to Ronin's Effect beta.103 APIs.                                                                  |
|  30 | `b900fc94e` | Port    | feat(web): reveal timestamps on tool rows and turn folds (#8641)                                             | Adapted timestamps for tool rows and turn folds.                                                                                        |
|  31 | `ccf220be2` | Skip    | docs: make the standalone installer the primary way to get the CLI (#11696)                                  | Standalone installer documentation is outside Ronin's shipped desktop flow.                                                             |
|  32 | `f45c6b4a7` | Port    | fix(web): submit PR comments with Cmd/Ctrl+Enter (#11994)                                                    | Applied Cmd/Ctrl+Enter pull-request comment submission.                                                                                 |
|  33 | `e8ca3a828` | Port    | refactor(web): centralize pull request icon state presentation (#11144)                                      | Centralized pull-request status icon presentation and added an import guard.                                                            |
|  34 | `0b83045d0` | Port    | feat(providers): expose native slash commands across clients (#11519)                                        | Ported native slash commands for Grok and OpenCode; omitted Cursor's catalog because its prerequisite workspace-snapshot SPI is absent. |
|  35 | `f4ef5155f` | Port    | feat(web): add send shortcut and follow-up controls (#12075)                                                 | Ported send-shortcut and follow-up controls across settings, keybindings, composer behavior, and docs.                                  |
|  36 | `052c7ae53` | Port    | feat(chat): show provider thinking traces (#11784)                                                           | Reconciled provider thinking traces with Ronin's existing chat activity model.                                                          |
|  37 | `eff44be43` | Skip    | feat(usage): show OpenCode Go, Cursor, and Grok subscription limits (#12115)                                 | The upstream subscription-limit surface is not carried in Ronin.                                                                        |
|  38 | `d1a644897` | Skip    | fix(web): dropped folders become path chips on the local environment and are refused on remote ones (#12001) | Upstream folder-drop plumbing has no compatible integration point in Ronin's composer architecture.                                     |
|  39 | `384de0858` | Port    | fix(web): adapt provider settings to available content width (#12138)                                        | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  40 | `32e8b2584` | Skip    | fix(web): show private repository media in pull request tabs (#11706)                                        | Private-media fetch plumbing depends on an upstream GitHub-media integration Ronin does not carry.                                      |
|  41 | `aae361c4e` | Skip    | fix(review): show complete counts and load large diffs progressively (#10822)                                | The progressive-diff helper is orphaned under Ronin's divergent diff pipeline.                                                          |
|  42 | `52ad70ec4` | Port    | fix(web): prioritize linked pull requests over automatic diffs (#12142)                                      | Reconciled linked pull-request priority with current routing behavior.                                                                  |
|  43 | `f1b497a55` | Skip    | feat(cli): show installer and update download progress (#12044)                                              | The upstream installer/update client is not part of Ronin's CLI flow.                                                                   |
|  44 | `01e64193d` | Port    | fix(web): simplify agent approval prompts (#12082)                                                           | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  45 | `dda44ed33` | Port    | fix(web): show tooltips for composer environment and workspace controls (#11787)                             | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  46 | `22539f2a4` | Port    | fix(chat): group thoughts into the changing tool activity line (#12147)                                      | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  47 | `ed1238979` | Port    | fix(web): keep tool timestamps before disclosure chevrons (#12152)                                           | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  48 | `394af73e0` | Port    | fix(web): default diff panel to working tree (#12139)                                                        | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  49 | `e106fe95c` | Skip    | design(mobile): unify Android Material layouts and native controls (#11841)                                  | No mobile app in this repo.                                                                                                             |
|  50 | `9686cd9af` | Port    | feat(web): choose themes from chat with color previews (#12143)                                              | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  51 | `e47a11e1e` | Port    | fix(web): align follow-up and license settings controls (#12167)                                             | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  52 | `892b86da1` | Port    | fix(web): align composer task rows (#12165)                                                                  | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  53 | `ed88937cf` | Skip    | fix(mobile): prevent Android compose FAB animation jitter (#12169)                                           | No mobile app in this repo.                                                                                                             |
|  54 | `c1738f131` | Port    | fix(server): keep large sparse checkouts on the fast checkpoint path (#12154)                                | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  55 | `c12ba7581` | Port    | feat(web): make pull request comments easier to scan (#12150)                                                | Applicable pull-request comment presentation was already equivalent in the current tree.                                                |
|  56 | `19ee856ec` | Port    | fix(server): propagate linked pr changes and settle threads immediately (#12161)                             | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  57 | `d612d12b8` | Port    | fix(web): reuse cached GitHub PR details across entry points (#12168)                                        | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  58 | `315b72371` | Port    | Remove `new` badge from Fable 5.1 (#12173)                                                                   | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  59 | `962bf6292` | Port    | fix(web): show author avatars in pull request previews (#12125)                                              | Ported author avatars and added an image-failure fallback.                                                                              |
|  60 | `3bee4c286` | Port    | fix(server): settle cancelled worktree setup before rollback (#12176)                                        | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  61 | `4abb07eac` | Port    | feat(mobile): port worktree setup progress and agent handoff (#12177)                                        | Ported the reusable worktree-setup state helper; mobile UI was omitted.                                                                 |
|  62 | `8130a9f13` | Port    | fix(server): flush checkpoint objects and refs before publishing them (#10944)                               | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  63 | `88d0c40c8` | Skip    | chore(mobile): bump app version to 1.2.1                                                                     | No mobile app in this repo.                                                                                                             |
|  64 | `d42a3bd2a` | Port    | fix(server): keep ready checkpoints when a later placeholder arrives (#8432)                                 | Reconciled ready-checkpoint preservation with the current projector.                                                                    |
|  65 | `901db8966` | Port    | fix(server): keep VCS waits from blocking turn completion (#11970)                                           | Added the invariant that a later missing placeholder cannot overwrite a captured checkpoint.                                            |
|  66 | `573a8f2f3` | Port    | fix(web): keep header spacing stable when sidebar drawer opens (#12162)                                      | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  67 | `df466c798` | Port    | fix(web): fall back when pull request avatars fail (#11728)                                                  | Applied the pull-request avatar fallback with focused coverage.                                                                         |
|  68 | `d359e94ca` | Skip    | feat(web): enable rich text composer by default (#12160)                                                     | Ronin retains its established Lexical composer instead of upstream's Tiptap rollout.                                                    |
|  69 | `71d12d8c4` | Port    | feat(web): make keybindings searchable from settings search (#12175)                                         | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  70 | `f17165a76` | Port    | fix(web): preserve thread reading positions (#12144)                                                         | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  71 | `6d1d54944` | Port    | fix(diff): collapse files by default (#12190)                                                                | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  72 | `886c83450` | Port    | fix(web): folder links from chat open the file tree instead of a broken preview (#10909)                     | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  73 | `712f8cad3` | Port    | feat(web): command palette search matches thread IDs (#11185)                                                | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  74 | `01eb4b9a8` | Port    | fix(web): align notification icons with titles (#12202)                                                      | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  75 | `2a47fc905` | Port    | fix(skills): support unicode currency symbols as skill aliases (#12098)                                      | Ported Unicode currency aliases for skills; mobile consumers were omitted.                                                              |
|  76 | `c4ca1b0f9` | Skip    | feat(settings): add automatic storage cleanup per machine and project (#11598)                               | Automatic storage cleanup requires upstream settings and persistence infrastructure not present here.                                   |
|  77 | `c0dded88b` | Port    | feat(web): command palette finds the pull requests and usage pages (#12211)                                  | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  78 | `0150c6a53` | Port    | feat(web): start new threads with multiple models in separate worktrees (#12179)                             | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  79 | `dd9528a97` | Skip    | fix(mobile): keep screen awake during dictation (#12227)                                                     | No mobile app in this repo.                                                                                                             |
|  80 | `298f8c95c` | Skip    | feat(mobile): add favorites to model picker (#12231)                                                         | No mobile app in this repo.                                                                                                             |
|  81 | `1ab2dfb5a` | Port    | fix(desktop): keep preview picking active across subframe navigation (#9741)                                 | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  82 | `d4d5d12e8` | Port    | fix(shared): keep the newest shared usage scan (#10315)                                                      | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  83 | `fbc8b9600` | Port    | fix(web): keep thoughts and failed tool calls in one activity row (#12270)                                   | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  84 | `2d8378b44` | Port    | fix(web): avoid reopening settled threads when adding projects (#11804)                                      | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  85 | `c25c3e0ee` | Skip    | feat(mobile): make Settings easier to navigate and scope (#12272)                                            | No mobile app in this repo.                                                                                                             |
|  86 | `8db3c250f` | Skip    | fix(mobile): prevent overlapping text and UI on Android chat messages (#11611)                               | No mobile app in this repo.                                                                                                             |
|  87 | `03950089f` | Skip    | feat(web): pull request files can be marked as viewed (#7721)                                                | The viewed-files feature was not adopted; its new files had no compatible consumers.                                                    |
|  88 | `4749035bd` | Port    | fix(web): keep composer banners compact and readable (#12166)                                                | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  89 | `592021f00` | Port    | fix(web): collapse thoughts within tool groups (#12302)                                                      | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  90 | `675869d2b` | Port    | fix(usage): preserve saved totals after transcript cleanup (#12304)                                          | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  91 | `6deac7a92` | Skip    | fix(mobile): show Agent behavior icon on Android (#12316)                                                    | No mobile app in this repo.                                                                                                             |
|  92 | `e26af33b2` | Port    | fix(web): keep PR panel actions in the current thread (#12320)                                               | Adapted pull-request panel actions to remain in the current thread.                                                                     |
|  93 | `4cc984fed` | Port    | fix(web): keep browser pages aligned during panel animations (#12329)                                        | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  94 | `b17cc2ab5` | Port    | fix(server): bound provider event log records before serialization (#12305)                                  | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  95 | `b4620d595` | Port    | fix(server): reject file rewind in shared workspaces (#12306)                                                | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  96 | `67993623a` | Port    | fix(server): capture checkpoints when baseline lookup fails (#12307)                                         | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  97 | `d17f46d76` | Port    | fix(server): refresh file search outside checkpoint processing (#12308)                                      | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  98 | `fcfd9f911` | Port    | fix(web): keep chat from jumping when the scroll-to-end pill mounts (#12317)                                 | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
|  99 | `1455cb5c3` | Port    | fix(server): checkpoint workspaces with empty nested repositories (#12181)                                   | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 100 | `5f2253956` | Skip    | chore(review): keep review bots out of the vendored .repos references (#12333)                               | Upstream review-bot governance does not apply to the fork.                                                                              |
| 101 | `3fd21df62` | Port    | fix(server): pass Codex image attachments by path to avoid oversized requests (#11050)                       | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 102 | `256e630ef` | Port    | feat(web): filter sidebar from thread menu (#8719)                                                           | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 103 | `9051ed9c3` | Skip    | feat(web): open diff files from a right-click context menu (#11842)                                          | The new diff context-menu helpers had no compatible consumer in Ronin's diff surface.                                                   |
| 104 | `3fd5d6439` | Port    | fix(web): keep numbered jumps from stealing browser tabs (#12315)                                            | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 105 | `53510d44e` | Skip    | fix(mobile): define Clerk colors in every Uniwind theme (#12344)                                             | No mobile app in this repo.                                                                                                             |
| 106 | `8583eac64` | Port    | refactor(web): reuse searchable picker inputs (#12353)                                                       | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 107 | `5a3901331` | Skip    | fix(web): share touch-visible pull request edit actions (#12370)                                             | The touch-only pull-request edit abstraction is not used by the desktop-first surface.                                                  |
| 108 | `05a8c6016` | Skip    | fix(mobile): share accessible connection trace controls (#12371)                                             | No mobile app in this repo.                                                                                                             |
| 109 | `a1390ac65` | Skip    | fix(mobile): share settings control row layout (#12356)                                                      | No mobile app in this repo.                                                                                                             |
| 110 | `6088c8104` | Port    | refactor(web): share diagnostic process actions (#12358)                                                     | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 111 | `14337401b` | Skip    | refactor(mobile): share Android toolbar search fields (#12359)                                               | No mobile app in this repo.                                                                                                             |
| 112 | `4aa841a8d` | Port    | refactor(web): share settings group surfaces (#12360)                                                        | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 113 | `8eb1f6e74` | Port    | refactor(web): reuse inline settings actions (#12362)                                                        | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 114 | `767a5dbd0` | Skip    | refactor(mobile): share thread list section controls (#12363)                                                | No mobile app in this repo.                                                                                                             |
| 115 | `18dcc43ac` | Skip    | refactor(mobile): share connection form fields (#12364)                                                      | No mobile app in this repo.                                                                                                             |
| 116 | `1a2a03f44` | Skip    | refactor(mobile): share local environment lists (#12365)                                                     | No mobile app in this repo.                                                                                                             |
| 117 | `58fcae64a` | Skip    | refactor(mobile): share file preview feedback (#12368)                                                       | No mobile app in this repo.                                                                                                             |
| 118 | `fa2decfce` | Skip    | refactor(web): share standalone page layout (#12354)                                                         | The standalone hosted page surface is deliberately cut.                                                                                 |
| 119 | `c7fa1e969` | Skip    | fix(mobile): share settings action row defaults (#12369)                                                     | No mobile app in this repo.                                                                                                             |
| 120 | `cc39ec100` | Skip    | fix(mobile): share request action button defaults (#12366)                                                   | No mobile app in this repo.                                                                                                             |
| 121 | `994654198` | Skip    | fix(web): share accessible color picker controls (#12355)                                                    | The new color-picker primitive had no caller after cut surfaces were excluded.                                                          |
| 122 | `818add08f` | Skip    | fix(mobile): use singular label for one settings environment (#12282)                                        | No mobile app in this repo.                                                                                                             |
| 123 | `7a2cce826` | Skip    | feat(mobile): add copy thread ID to thread list actions (#12228)                                             | No mobile app in this repo.                                                                                                             |
| 124 | `243e94470` | Skip    | fix(mobile): remove Android input underline backgrounds (#12394)                                             | No mobile app in this repo.                                                                                                             |
| 125 | `d547e3b12` | Skip    | chore(deps): upgrade Effect to rc.115 and Alchemy to beta.78 (#12326)                                        | Ronin remains on Effect beta.103; the rc.115/Alchemy upgrade needs a separate coordinated migration.                                    |
| 126 | `e3c85ead6` | Skip    | chore(refs): sync Effect and Alchemy references to rc.115 and beta.78 (#12327)                               | Reference sync accompanies the skipped Effect/Alchemy dependency upgrade.                                                               |
| 127 | `747962568` | Skip    | chore(relay): deploy with the Alchemy CLI and publish client config through an Action (#12401)               | Hosted relay is deliberately cut.                                                                                                       |
| 128 | `c5bbf3d14` | Skip    | chore(deps): bump the npm_and_yarn group across 1 directory with 3 updates (#12411)                          | The dependency group only affects cut or divergent upstream surfaces.                                                                   |
| 129 | `56a9bf2bd` | Port    | fix(git): prevent stale branch selections from restoring files (#10574)                                      | Reconciled stale branch selection protection with Ronin's current git flow.                                                             |
| 130 | `52e4b4429` | Skip    | chore(deps): bump parents that carry vulnerable transitive dependencies (#12417)                             | Depends on the incompatible Effect rc.115 and upstream packaging stack; defer to a dedicated dependency upgrade.                        |
| 131 | `9ea9c3d5d` | Port    | fix(web): keep a file-to-symlink type change from crashing the diff view (#11075)                            | Reconciled symlink type-change handling with the current diff view.                                                                     |
| 132 | `ccad9f69a` | Skip    | Use T3 Device panel for mobile testing (#12414)                                                              | No mobile app in this repo.                                                                                                             |
| 133 | `bd5dc58c6` | Skip    | fix(web): client spans reach the trace proxy again (#12332)                                                  | The client trace-proxy integration is absent from Ronin's current runtime.                                                              |
| 134 | `eadeaf228` | Port    | fix(bitbucket): preserve rate limits from optional PR reads (#12486)                                         | Reconciled optional Bitbucket reads without losing rate-limit state.                                                                    |
| 135 | `9118b6d3e` | Skip    | fix(mobile): synchronize native permission registry access (#12482)                                          | No mobile app in this repo.                                                                                                             |
| 136 | `ed6fe339d` | Port    | fix(build): retain multiple license notices for one package (#12489)                                         | Reconciled multi-notice license retention with the existing build pipeline.                                                             |
| 137 | `dcdf5e6a0` | Skip    | fix(build): parse executable imports without matching source strings (#12488)                                | The executable-import parser is not used by Ronin's build path.                                                                         |
| 138 | `4c61e3d7e` | Skip    | fix(mobile): synchronize native notification delegates (#12483)                                              | No mobile app in this repo.                                                                                                             |
| 139 | `80c1f771b` | Skip    | fix(relay): accept delegated thread IDs in activity routes (#12484)                                          | Hosted relay is deliberately cut.                                                                                                       |
| 140 | `c03b24026` | Port    | fix(git): explain fetch failures without exposing remote output (#12485)                                     | Reconciled fetch-failure privacy with Ronin's git error presentation.                                                                   |
| 141 | `c557bb10a` | Port    | fix(web): sidebar search matches message content (#11761)                                                    | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 142 | `6d68677ff` | Port    | fix(server): restore secrets when settings persistence fails (#12487)                                        | Reconciled secret restoration with settings persistence failure handling.                                                               |
| 143 | `8ebb61123` | Port    | fix(ci): accept V2 transfer reports without cross-scenario comparisons (#12492)                              | Applied the compatible CI transfer-report handling.                                                                                     |
| 144 | `e84f23a97` | Port    | fix(web): speed up PR previews with fewer GitHub requests (#11825)                                           | Applicable behavior was applied or confirmed equivalent in the current Ronin tree.                                                      |
| 145 | `869347bc2` | Port    | fix(server): retry transient git failures during checkpoint capture (#11665)                                 | Reconciled transient checkpoint git retries with the current capture path.                                                              |
| 146 | `4d36142c0` | Skip    | fix(mobile): keep archived threads visible during iOS search (#12420)                                        | No mobile app in this repo.                                                                                                             |
| 147 | `e0649ed7d` | Skip    | perf(mobile): isolate Material You conversion on Android (#12379)                                            | No mobile app in this repo.                                                                                                             |
| 148 | `53830d413` | Skip    | perf(mobile): isolate iOS Live Activity imports (#12380)                                                     | No mobile app in this repo.                                                                                                             |
| 149 | `7e7cd3246` | Skip    | refactor(mobile): split home headers by platform (#12381)                                                    | No mobile app in this repo.                                                                                                             |
| 150 | `429d66c13` | Skip    | refactor(mobile): split native menus by platform (#12382)                                                    | No mobile app in this repo.                                                                                                             |
| 151 | `dec073228` | Skip    | refactor(mobile): isolate thread row appearance by platform (#12383)                                         | No mobile app in this repo.                                                                                                             |
| 152 | `7230f6b1b` | Skip    | refactor(mobile): split settings selection rows by platform (#12384)                                         | No mobile app in this repo.                                                                                                             |
| 153 | `4fb9dfc8b` | Skip    | refactor(mobile): centralize platform header rendering (#12388)                                              | No mobile app in this repo.                                                                                                             |
| 154 | `989bde889` | Skip    | refactor(mobile): configure thread headers through the shared core (#12389)                                  | No mobile app in this repo.                                                                                                             |
| 155 | `54bbed660` | Skip    | refactor(mobile): share file header actions and search configuration (#12390)                                | No mobile app in this repo.                                                                                                             |
| 156 | `7ee60f4bc` | Skip    | refactor(mobile): share terminal header and menu configuration (#12391)                                      | No mobile app in this repo.                                                                                                             |
| 157 | `aba1c6352` | Skip    | refactor(mobile): share archived thread header configuration (#12399)                                        | No mobile app in this repo.                                                                                                             |
| 158 | `88b9226d2` | Skip    | refactor(mobile): compose review menus through the shared header (#12400)                                    | No mobile app in this repo.                                                                                                             |
| 159 | `93e04160a` | Skip    | feat(mobile): search projects when starting a task (#12496)                                                  | No mobile app in this repo.                                                                                                             |
| 160 | `82cd1d1aa` | Skip    | fix(mobile): preserve multiple model favorites (#12505)                                                      | No mobile app in this repo.                                                                                                             |
| 161 | `3bb06ad91` | Skip    | feat(server): export log records over OTLP (#12493)                                                          | Upstream server log-export wiring has no compatible source integration in the current telemetry stack.                                  |
| 162 | `ea15f17af` | Skip    | fix(mobile): use native settings and snooze controls (#12512)                                                | No mobile app in this repo.                                                                                                             |
| 163 | `d99bc5a4d` | Port    | feat(web): sort pull requests by what is blocked on me (#12508)                                              | Reconciled blocked-on-me pull-request ordering with current presentation logic.                                                         |
| 164 | `8c3b5bef1` | Skip    | fix(mobile): prefer pull-to-refresh on list screens (#12515)                                                 | No mobile app in this repo.                                                                                                             |
| 165 | `de6a230db` | Port    | fix(acp): accept SDK elicitation requests (#11294)                                                           | Reconciled ACP elicitation requests with Ronin's provider runtime.                                                                      |
| 166 | `bd0b9edac` | Skip    | fix(release): read relay configuration without loading deployment providers (#12518)                         | Hosted relay is deliberately cut.                                                                                                       |
| 167 | `4931d73af` | Skip    | fix(ci): reconcile native change labels against pinned commits (#12517)                                      | No mobile app in this repo.                                                                                                             |
| 168 | `e74c668d7` | Skip    | fix(release): strip Alchemy progress before parsing relay state (#12519)                                     | Hosted relay is deliberately cut.                                                                                                       |
| 169 | `9cb586acd` | Port    | refactor: remove obsolete code (#9917)                                                                       | Applied only safe obsolete-code cleanup; restored files still referenced by Ronin and omitted cut surfaces.                             |
| 170 | `cb3d95c17` | Port    | fix(server): release oversized pull request diff cache entries (#12523)                                      | Reconciled oversized pull-request diff cache eviction.                                                                                  |
| 171 | `823119350` | Skip    | feat(mobile): view and control agent devices (#12531)                                                        | No mobile app in this repo.                                                                                                             |
| 172 | `5378f87f9` | Port    | fix(preview): recover host registration after request timeouts (#12535)                                      | Reconciled preview-host recovery after request timeouts.                                                                                |
| 173 | `0f1b572b9` | Port    | fix(mobile): align built-in theme colors with desktop (#12534)                                               | Reconciled shared desktop theme colors; mobile-only changes were omitted.                                                               |
| 174 | `82059df15` | Port    | feat(desktop): export main process telemetry over OTLP (#12520)                                              | Reconciled desktop main-process OTLP export with existing telemetry configuration.                                                      |
| 175 | `efb96939f` | Port    | fix(codex): surface app permission requests as approvable (#7861)                                            | Reconciled approvable Codex app-permission requests; mobile pieces were omitted.                                                        |
| 176 | `a8693eb4e` | Port    | chore(desktop): leave main process metrics export off until a metric exists (#12540)                         | Kept desktop metric export disabled while no metric source exists.                                                                      |
| 177 | `803f94e78` | Port    | fix(release): drop placeholder allowBuilds entry that broke desktop builds (#12544)                          | Applied the release allowBuilds correction used by Ronin's desktop build.                                                               |
| 178 | `29a23fdf1` | Skip    | fix(mobile): adapt workspace navigation and expand controls (#12551)                                         | No mobile app in this repo.                                                                                                             |
| 179 | `7a326c244` | Skip    | chore(mobile): add dev client script with preview environment (#12558)                                       | No mobile app in this repo.                                                                                                             |
| 180 | `408ff8ae9` | Skip    | fix: detect installed editors outside PATH (#12439)                                                          | The upstream editor-discovery helper does not integrate with Ronin's launcher shape.                                                    |
| 181 | `dfbb11bdd` | Port    | fix(web): show plain text in collapsed thought previews (#12377)                                             | Reconciled plain-text collapsed thought previews with Ronin's grouped activity rows.                                                    |

### Verification

- Every changed or added Vite test passes: **46 files / 1,491 tests**.
- The release-script Node suite passes: **21 tests**.
- Typechecks pass for server, web, desktop, contracts, shared, and client runtime. Remaining server
  output is non-blocking Effect suggestions.
- Changed-file formatting and `git diff --check` pass.
- React Doctor's final changed-scope scan completes at **54/100** with both stale-memo findings
  fixed. Its remaining 49 maintainability warnings are the established large-component/Fast
  Refresh backlog; the one bug-class warning is the intentional project-icon draft reset when the
  picker reopens.
- The 181-commit ledger matches the frozen range: **95 Port, 86 Skip, 0 Ask**.

**Hit every applicable surface:** desktop Electron/menu and release flow, web chat/composer/settings/
keybindings/pull requests/diffs/sidebar, server orchestration/checkpoints/providers/source control/
device runtime, wire contracts, client runtime, shared helpers, local and remote environments, and
user/operations docs. Mobile, Clerk/T3 Connect, hosted relay, WSL, legacy sidebar, standalone hosted
pages, Playwright preview automation and incompatible dependency migrations remain deliberately
cut.

### Not tested

- No live client or browser automation was run, per `AGENTS.md`; user-visible behavior has focused
  unit, type, formatting and React static-analysis coverage.
- No real provider process, remote host, GitHub mutation, signed release, updater, telemetry
  collector or platform accessibility capture was exercised against an external system.

## Batch 36 — reviewed through `f5ef0ddb9` (147 commits)

Reviewed `dfbb11bdd..f5ef0ddb9`, with upstream snapshotted at
`f5ef0ddb90a8c36584e181b1913e7b8a5df30ffc` for the whole run. Fork merge base remains
`083fa4ab24c464ddf01e5b7ab22135d1ebdc120b`. No commit needed a product Ask.

### Ported (78)

| Upstream    | Title                                                                                                   | Notes                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `9accc5676` | fix(web): wrap long titles in confirmation dialogs (#12571)                                             | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `8dd02470b` | fix(web): restore providers settings heading (#12552)                                                   | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `dcf894230` | fix(web): keep desktop annotation screenshots under CSP (#12636)                                        | Applied to Ronin's desktop/Electron architecture with the relevant regression coverage.                    |
| `e36725682` | fix(web): keep typed text when a question option is clicked (#12577)                                    | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `63ff33756` | fix(server): empty Claude homePath shares continuation with ~/.claude (#12624)                          | Applied to Ronin's current server architecture with focused regression coverage.                           |
| `52d08a14b` | fix(desktop): include SnapShot app text for Flatpak and GTK4 (#12635)                                   | Applied to Ronin's desktop/Electron architecture with the relevant regression coverage.                    |
| `d6f291303` | fix(server): surface ACP stderr when cursor-agent exits at session start (#12625)                       | Adapted stderr-first startup failure reporting to Ronin's ACP transport error shape.                       |
| `599c9776e` | fix(web): align pull request state glyph to top of row (#11268)                                         | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `7445aa733` | fix(web): align menu item icons in pull request detail panel (#11263)                                   | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `4a560b4e4` | fix(web): honor whitespace settings in pull request diffs (#12438)                                      | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `0ff87f251` | fix(web): keep citation comment when popover is dismissed (#10831)                                      | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `c14f6015b` | fix(web): keep narrow chat headers readable and aligned (#12453)                                        | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `fa1e17155` | refactor(observability): hold OTLP export settings per signal (#12657)                                  | Ported per-signal OTLP settings while preserving Ronin's existing telemetry configuration.                 |
| `ead1dee22` | fix(web): explain what enabling network access means in its confirmation (#10098)                       | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `9f0c9f725` | fix(web): reuse current PR status in the sidebar (#12545)                                               | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `6a699f0f2` | fix(web): stabilize pull request loading layout (#12721)                                                | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `55c24273a` | fix(desktop): align preview recording cursors and show input feedback (#12779)                          | Ported recording input/cursor feedback through Ronin's Electron preload and preview manager.               |
| `7ade2d2c6` | fix(web): the Run on / Workspace menu closes after a pick (#12685)                                      | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `3cfebf4aa` | fix(web): keep portaled menus clickable over Electron drag regions (#12527)                             | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `5d9e27a59` | fix(web): render citations in queued messages (#12403)                                                  | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `2d8f9a8f5` | fix(web): keep the timeline still when the resting composer expands (#12771)                            | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `45e06f48a` | fix: composer hero reads project name to screen readers (#12397)                                        | Applied the compatible behavior across Ronin's existing shared and desktop-first surfaces.                 |
| `adcd90858` | fix(web): allow full contrast in assistant replies (#12405)                                             | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `584450a1f` | fix(web): compact the worktree setup glass popover (#12802)                                             | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `67285e4b8` | fix(web): route keyboard submit through the primary worktree action (#12526)                            | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `c789cd174` | fix(web): skip image inline chip when composer is empty (#12528)                                        | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `f4d979a6c` | fix(web): only show notice details when text is clipped (#12760)                                        | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `9f73ca367` | fix(devices): recover simulator streams after failures (#12639)                                         | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `1ba471a37` | chore(server): bump device tooling versions (#12809)                                                    | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `2b178231e` | fix: allow more attachments without raising the image payload budget (#12620)                           | Applied the compatible behavior across Ronin's existing shared and desktop-first surfaces.                 |
| `051a4057a` | fix(web): device Reconnect starts one stream instead of two (#12808)                                    | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `58f89818e` | fix(server): tolerate shutting down an iOS simulator that is already off (#12807)                       | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `411da2a73` | feat(web): use the linked pull request row layout on the pull requests page (#12536)                    | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `2efb8178d` | fix(clients): keep backslashes in copied Codex citations (#12243)                                       | Ported Codex citation escaping and its regression test.                                                    |
| `f7efb5354` | feat(web): truncate branch names and paths in the middle (#12805)                                       | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `dca84efb5` | fix(web): paste markdown with inline code inside bold, italic, or strikethrough (#12290)                | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `a9ab9049b` | feat(web): show the pull request refresh spinning in the detail header (#12833)                         | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `a4bc7deb9` | fix(web): dismiss composer suggestions with Escape (#12836)                                             | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `6cc7f7006` | fix(web): keep composer controls visible while they fit (#12837)                                        | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `5c5fa5ffb` | feat(devices): show installed and running tool versions per host (#12816)                               | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `3b836f994` | feat(devices): show automatic update progress and host retry (#12817)                                   | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `61b25b88d` | feat(devices): add read-only update discovery and remote ownership (#12818)                             | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `790be6d75` | fix(devices): safely reclaim obsolete managed tool versions (#12819)                                    | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `30e3649c3` | fix(web): match thread notification icons to sidebar status (#12806)                                    | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `f391b88c3` | fix(web): move sidebar shelves as one block (#11772)                                                    | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `6b0a04ade` | fix(web): offer undo after unpinning a thread (#10744)                                                  | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `5781b5240` | feat(web): undo settle, snooze and archive, with a mod+z shortcut (#12848)                              | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `b379b5b14` | test(web): remove redundant favicon test (#12856)                                                       | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `1de563c14` | feat(devices): offer manual updates in tool version details (#12877)                                    | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `371b52d9d` | feat(web): answer pull request actions on the row at once (#12843)                                      | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `2c2fa8cd7` | fix(web): pull request embed chip shows the state icon (#12951)                                         | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `2d377bfb1` | fix(web): dismiss selection actions when pressing buttons (#12950)                                      | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `d2a90b921` | fix(web): name message copy actions accurately (#12865)                                                 | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `80d9c181d` | fix(contracts): old message-sent events without turnId no longer stop the server from starting (#12763) | Ported backward-compatible contract decoding for legacy message-sent events.                               |
| `e1cbb7052` | fix(web): the custom snooze calendar starts the week where the locale does (#12745)                     | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `1262d2f3a` | feat(server): let t3.json limit or disable submodule init in new worktrees (#12953)                     | Ported the t3.json submodule-init policy without adding project-scoped settings inheritance.               |
| `9a609a4e4` | fix(web): show thread undo notice in the sidebar (#12972)                                               | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `5423ba0fd` | feat(web): merge the comment and review buttons into one composer (#12945)                              | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `e65bc1c73` | fix(web): allow text selection when renaming threads (#12935)                                           | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `438bf466f` | fix(web): close menus when clicking into the browser tab (#11148)                                       | Ported browser-tab menu dismissal to Ronin's hosted browser surface.                                       |
| `aff9318bf` | fix(web): retry failed attachment uploads after reconnect (#10338)                                      | Ported reconnect-aware attachment retry behavior and tests.                                                |
| `da6a85b13` | fix(web): respect panel motion in composer transitions (#11064)                                         | Adapted composer motion behavior to Ronin's existing panel-animation model.                                |
| `7c2702d68` | fix(web): read panel animation settings in the composer (#13098)                                        | Adapted composer motion behavior to Ronin's existing panel-animation model.                                |
| `f25a8e4b7` | feat(models): add opus 5.5 without changing existing aliases (#13094)                                   | Updated the model manifest/capabilities while preserving Ronin's aliases and compatibility policy.         |
| `17e34773b` | Update model manifest with new timestamps and models                                                    | Updated the model manifest/capabilities while preserving Ronin's aliases and compatibility policy.         |
| `f193a6863` | fix(server): bypass owned caches on explicit provider refresh (#13109)                                  | Ported explicit provider refresh cache invalidation through contracts, web, and server.                    |
| `d7819c188` | chore(devices): bump agent-device to 0.21.12 (#13124)                                                   | Ported through the device contracts, server/host lifecycle, and desktop/web status surfaces as applicable. |
| `f22331240` | fix(server): generate PR diffs from branch changes (#13170)                                             | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `68607c5a9` | fix(web): preserve nested scroll behavior in chat timeline (#13167)                                     | Applied or adapted to Ronin's current web architecture and retained visual system.                         |
| `b954af60c` | test(web): cover usage model ordering without static markup (#13104)                                    | Ported the non-static usage ordering coverage and supporting helper.                                       |
| `ca864a25b` | chore(models): use GPT-6 Luna for text generation (#13115)                                              | Updated Ronin's text-generation default to GPT-6 Luna.                                                     |
| `96c4bfa0a` | feat(providers): check remote compatibility ranges (#13130)                                             | Ported remote provider compatibility ranges, advisories, maintenance gating, and tests.                    |
| `219c1d265` | fix(web): align provider emails without clipping (#13174)                                               | Applied the provider-email alignment fix without importing the skipped auth surface.                       |
| `5975ec78b` | fix(server): background PR checks spend less GitHub quota (#13189)                                      | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `18de6bb32` | fix(server): background PR sync reads summaries in batches (#13198)                                     | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `eafb4a934` | fix(server): GitHub PR lookups stop probing owner-qualified heads (#13200)                              | Adapted to Ronin's current pull-request service and UI architecture, with focused regression coverage.     |
| `829af7b73` | feat(web): navigate back and forward with mod+[ and mod+] (#13212)                                      | Ported desktop history navigation keybindings and routing behavior.                                        |
| `b21c54565` | fix(web): sort title matches by recent activity (#13219)                                                | Ported recent-activity tie-breaking for command-palette title matches.                                     |

### Already in the tree (2)

| Upstream    | Title                                                                  | Notes                                                                                    |
| ----------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `6975efd3d` | fix(web): the pull request badge reads at the meta size again (#13175) | The pull-request badge already uses Ronin's meta-size treatment.                         |
| `eb6c170c4` | test(desktop): remove redundant keyring module-load test (#13220)      | Equivalent cleanup is already present: the redundant keyring module-load test is absent. |

### Skipped (67)

| Upstream    | Title                                                                                                                | Notes                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `b44c1ce5d` | fix(mobile): keep the Android composer placeholder on one line (#12605)                                              | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `7810fb263` | Add new GitHub user 'yordis' to VOUCHED.td (#12546)                                                                  | Upstream contributor-governance data is not part of the fork.                                                   |
| `f9e8f578f` | chore: vouch cestercian (#12638)                                                                                     | Upstream contributor-governance data is not part of the fork.                                                   |
| `f6cc6bc7e` | fix(mobile): respect word wrap in diffs (#12590)                                                                     | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `933492470` | fix(web): pull request chips share the link hover preview (#12719)                                                   | Ronin deliberately removed the pull-request link-hover preview in an earlier batch.                             |
| `a6cb1dd20` | fix(mobile): keep the source worktree when starting a thread on a branch (#12623)                                    | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `1eeeabb26` | fix(mobile): use a proper pull request icon on iOS (#12855)                                                          | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `33cb911ce` | fix(mobile): stop iOS autocorrect from rewriting search queries (#12949)                                             | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `76cc9b08f` | chore(mobile): bump app version to 1.3.0                                                                             | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `742173a13` | feat(settings): resolve t3.json inside the project settings resolver (#12954)                                        | Project-scoped settings inheritance remains a deliberate Ronin cut.                                             |
| `0141bc2bf` | feat(settings): choose how new worktrees initialize submodules (#12955)                                              | Project-scoped settings inheritance remains a deliberate Ronin cut.                                             |
| `5a61f50cc` | chore(lint): report className restyling of components/ui exports (#12982)                                            | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `c26119ada` | refactor(web): drop className overrides that repeat the base styles (#12984)                                         | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `b5a0f8101` | refactor(web): give Spinner and RefreshIcon a size prop (#12985)                                                     | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `c0490e9d0` | refactor(web): use ghost-muted where ghost buttons restyled to muted (#13020)                                        | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `1a81ea8c1` | refactor(web): fold repeated overrides into ui defaults (#13021)                                                     | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `ce98d4107` | refactor(web): mark the current menu value with MenuRadioGroup (#13022)                                              | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `ed856946c` | refactor(web): add an active prop to CommandItem (#13023)                                                            | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `bbd5cc032` | chore(lint): exempt CollapsibleTrigger from no-restyle (#13024)                                                      | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `951501616` | refactor(web): use icon-xs where icon buttons were forced to size-6 (#13025)                                         | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `b4f1f18b7` | refactor(web): add radius="none" to ScrollArea (#13026)                                                              | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `7b54af90f` | refactor(web): add font="mono" to Input (#13027)                                                                     | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `be80e3693` | refactor(web): add SidebarInput (#13028)                                                                             | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `8d02447c3` | refactor(web): add a label variant to Badge (#13029)                                                                 | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `7d658c24d` | refactor(web): give Skeleton three shapes (#13030)                                                                   | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `aa2b25d29` | refactor(web): one wrap width for tooltips, plus a code variant (#13031)                                             | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `f3d3fe456` | refactor(web): one vertical rhythm for dialog bodies (#13032)                                                        | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `18aa70367` | refactor(web): ghost-muted icons follow the text; add ghost-destructive (#13033)                                     | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `4c9fbf1f6` | refactor(web): InlineButton underlines on hover and takes a tone (#13034)                                            | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `d7736e06b` | refactor(web): one minimum width for menus, three widths for popovers (#13035)                                       | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `da89e102f` | refactor(web): every textarea caps its growth; the diff comment box is a Textarea (#13036)                           | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `016cdb962` | refactor(web): stacked sidebar groups share one inset (#13037)                                                       | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `e420ef983` | refactor(web): Collapsible stays a plain container (#13038)                                                          | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `0fa4a859f` | refactor(web): show more / show less are ordinary sidebar sub-rows (#13039)                                          | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `0ee02ebf2` | refactor(web): Empty has three sizes (#13040)                                                                        | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `4321aa24f` | refactor(web): one row height for select, combobox and radio items (#13041)                                          | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `1c2f93389` | refactor(web): render menu and popover triggers through Button (#13042)                                              | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `83bbfa7e8` | refactor(web): sidebar alerts use the standard variants; one keycap (#13043)                                         | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `bed0b4cda` | chore(mobile): drop dead nitro-markdown tgz override and @expo/metro-runtime (#13148)                                | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `242816af8` | feat(web): show settings scope as a sentence at the top of the page (#13139)                                         | Project-scoped settings inheritance remains a deliberate Ronin cut.                                             |
| `db9a0671b` | refactor(web): move settings scope pickers into breadcrumbs (#13165)                                                 | Project-scoped settings inheritance remains a deliberate Ronin cut.                                             |
| `7e65b226e` | feat(auth): share provider sign-in flows and credential bindings (#12983)                                            | The shared provider sign-in/credential-binding surface is deliberately excluded.                                |
| `ec28eefa0` | refactor(mobile): git sheets use uniwind platform variants instead of className ternaries (#13161)                   | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `340965191` | chore(mobile): name the two project favicon caches by their job (#13160)                                             | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `6dcde218a` | revert(mobile): git sheets back to Platform.OS ternaries (un-guarded uniwind variants broke both platforms) (#13169) | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `5d493d67c` | docs(mobile): document the two mobile routes that intentionally skip deep links (#13164)                             | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `5821b778f` | refactor(mobile): break module cycles with focused extractions (#13151)                                              | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `e4422eec7` | fix(desktop): find linuxbrew node for the WSL backend (#7827)                                                        | No WSL backend in this repo.                                                                                    |
| `a493946bb` | fix(mobile): keep ordinary offline outbox failures out of console.warn (#13144)                                      | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `2eaff0824` | chore(lint): keep mobile theme escape-hatch allowlist honest (#13146)                                                | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `b9199617d` | fix(mobile): uniwind platform variants stay guarded on both platforms (#13172)                                       | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `21be723ad` | refactor(mobile): git sheets use uniwind platform variants instead of className ternaries (#13185)                   | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `db898a306` | refactor(mobile): remaining className platform ternaries become class variants (#13188)                              | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `151324b2c` | perf(mobile): recycle the default v2 home list and scope the snooze minute tick (#13149)                             | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `0c91f687d` | refactor(mobile): retire the legacy grouped thread list (#13183)                                                     | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `aca3c87cd` | chore(mobile): clear the legacy-list deletion fallout (#13203)                                                       | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `29931dd3a` | hatch/variant functions (#13191)                                                                                     | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `266d70cc4` | refactor(web): context chips render through one ContextChip component (#13192)                                       | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `361b047f5` | refactor(web): ui components drop their secondary className props (#13193)                                           | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `866fc9075` | refactor(web): menu triggers and items stop restyling ui/menu (#13205)                                               | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `21079391c` | refactor(web): field controls stop restyling Input, Select, Combobox and Command (#13206)                            | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `f46522777` | refactor(web): app code stops restyling sidebar, popover, table and misc ui exports (#13207)                         | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `71c9b6931` | refactor(web): Button consumers outside the composer stop restyling it (#13208)                                      | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `0e512db34` | refactor(web): composer controls own their look instead of restyling ui components (#13209)                          | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `10882bea7` | chore(web): no-restyle fails lint, and the ceiling gate goes (#13210)                                                | Superseded by Ronin's intentional UI/no-restyle architecture; importing it would undo the fork's design system. |
| `23c7ab901` | fix(mobile): recover from screen render errors (#13197)                                                              | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |
| `f5ef0ddb9` | chore(mobile): bump app version to 1.3.1                                                                             | No mobile app in this repo; no shared non-mobile hunk remained.                                                 |

### Verification

- Full test suites pass for server (**328 files / 4,316 tests**, plus 2 files / 9 tests skipped),
  web (**387 / 4,820**), desktop (**85 / 1,012**), contracts (**25 / 407**), shared
  (**58 / 740**), and effect-acp (**5 / 32**).
- The changed client-runtime citation suite passes (**1 file / 28 tests**). Its full suite still has
  one verified pre-existing failure in `src/state/sharedSettings.test.ts`: the old assertion omits
  `textGenerationModelSelection`, while both the current HEAD implementation and this batch leave
  that field in shared settings.
- Typechecks pass for server, web, desktop, client runtime, contracts, and shared. Server output
  contains only non-blocking Effect suggestions.
- `vp lint --report-unused-disable-directives` completes with no errors and five existing warnings;
  `vp fmt --check` and `git diff --check` pass.
- The 147-commit ledger matches the frozen range: **78 Port, 2 Already in tree, 67 Skip, 0 Ask**.

**Hit every applicable surface:** desktop Electron/preload and accessibility capture, web chat/
composer/sidebar/settings/pull requests/device controls, server provider/ACP/device/git/pull-request
services, wire contracts, client runtime, shared helpers, local and SSH hosts, and user docs. Mobile,
WSL, provider auth bindings, project-scoped settings inheritance, and upstream's no-restyle design
migration remain deliberately cut.

### Not tested

- No live browser/client automation was run, per `AGENTS.md`.
- No real provider process, remote host, simulator, GitHub mutation, or telemetry collector was
  exercised against an external system.

## Batch 37 — reviewed through `4293433ec` (80 commits)

Reviewed `f5ef0ddb9..4293433ec`, with upstream snapshotted at
`4293433eccbe6c6661acd020e584ae5d2234bf1e` for the whole run. Fork merge base remains
`083fa4ab24c464ddf01e5b7ab22135d1ebdc120b`. No commit needed a product Ask.

### Ported (47)

| Upstream    | Title                                                                                           | Notes                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `e407f9bb0` | fix(ci): shard release tests like pull request CI (#13321)                                      | Split release verification into non-server and sharded server jobs.                            |
| `effaab94e` | fix(web): show previous worktree branch on second line (#13314)                                 | Preserved the previous branch as secondary worktree context.                                   |
| `d4cd7d5c3` | fix(providers): restore compatibility ranges for every harness (#13328)                         | Reconciled provider compatibility ranges and maintenance coverage.                             |
| `894d33419` | fix(preview): use the visible browser for new agent sessions (#13064)                           | Routed new agent browser sessions to the visible preview surface.                              |
| `6b4b19096` | fix(desktop): SnapShot shortcut helper no longer adds a Dock icon on macOS (#13286)             | Applied the activation-policy fix to the desktop helper.                                       |
| `9030a60ea` | fix(web): composer chip rings no longer clip at the editor edge (#13301)                        | Ported the composer chip spacing correction.                                                   |
| `f1add18ae` | fix(shared): preserve final quoted empty CSV records (#11425)                                   | Fixed delimited parsing and added regression coverage.                                         |
| `78af372cf` | feat(web): add an interactive 3D device workspace (#12787)                                      | Ported the device workspace, models, controls, streaming, server support, contracts, and docs. |
| `e67abcf79` | feat(observability): honor the OpenTelemetry kill switch (#13355)                               | Added the standard SDK-disable switch to server and desktop telemetry.                         |
| `b2b43bef7` | fix(server): preserve racy edits in review diff previews (#12613)                               | Reconciled preview snapshots with concurrent working-tree edits.                               |
| `cb1a3f346` | fix(web): show repository names on linked pull requests (#13061)                                | Added repository identity to linked pull-request presentation.                                 |
| `87d842801` | fix(observability): a malformed OTEL_RESOURCE_ATTRIBUTES no longer stops startup (#13469)       | Made malformed resource attributes non-fatal.                                                  |
| `e759847f9` | fix(acp): keep one answer when a running tool reports progress (#13386)                         | Kept the final ACP answer stable across progress updates.                                      |
| `66129c6fd` | feat(web): run shell commands from chat in the thread terminal (#13060)                         | Added chat command execution through the thread terminal.                                      |
| `567783ecd` | fix(codex): the protocol generator runs again on Effect rc.115 (#13480)                         | Updated the generator for the current Effect schema APIs.                                      |
| `d5d48742c` | feat(codex): require Codex 0.156 and regenerate its protocol (#13481)                           | Regenerated the Codex protocol and raised the compatibility floor.                             |
| `010967041` | feat(threads): add per-thread auto-settle switch (#11846)                                       | Added contracts, persistence, orchestration, menus, shortcuts, migration 061, tests, and docs. |
| `8251c8de7` | fix(web): working and monitoring threads fade in the sidebar again (#13506)                     | Restored the sidebar transition without adding continuous animation.                           |
| `a36af0637` | fix(server): streamed section titles wait for the text under them (#13504)                      | Delayed streamed headings until their content is available.                                    |
| `9a91177c3` | fix(web): sidebar Back always returns to the main app (#13516)                                  | Tracks the last main-app location for Settings and sidebar Back actions.                       |
| `fd4651005` | fix(web): keep sidebar terminal pulses in sync (#12962)                                         | Reconciled terminal activity indicators with current thread state.                             |
| `46f3c2ca2` | feat(web): add iPhone Duo 3D controls (#12813)                                                  | Added Duo viewport and control support to the 3D device workspace.                             |
| `3e2370fbb` | feat(web): add usage page keybinding (#9434)                                                    | Added the Stats-page keybinding and command surface.                                           |
| `ebdcda135` | fix(web): selected text stays visible on a revealed file line (#13548)                          | Preserved selection highlighting when revealing cited file lines.                              |
| `29abbf9b4` | fix(web): collapsed composer bar stops flipping its labels while you scroll (#13555)            | Stabilized collapsed-composer label measurement.                                               |
| `6391be272` | fix(server): newer Codex models get T3 Code's instructions again (#13547)                       | Adapted the newer-model instruction gate to Ronin branding and runtime context.                |
| `9957349c0` | feat(web): control Android foldables in the Device panel (#13534)                               | Added fold-state contracts, proxy routing, controls, and tests.                                |
| `4f27a8463` | fix(mcp): preview snapshots fit in the agent's tool output again (#13558)                       | Bounded text and structured snapshot output while retaining locators and omission guidance.    |
| `0c84b4289` | fix(web): paste after clicking away from the composer lands in it again (#13553)                | Restored composer focus for paste after focus moves away.                                      |
| `99641fd09` | feat(desktop): keep running threads synced in the background (#13554)                           | Added the desktop-only running-thread keep-alive, tests, and architecture docs.                |
| `1e192b255` | fix(mcp): preview errors tell agents what to do instead (#13559)                                | Added actionable preview failure details to MCP results.                                       |
| `df9826f08` | feat(web): agents working banner links to the Agents panel (#13572)                             | Added the missing panel-navigation action.                                                     |
| `7b8443116` | fix(web): size the Android fold model from the inner display (#13574)                           | Corrected foldable geometry and frame sizing.                                                  |
| `20f0ff178` | fix(web): keep nested task states out of parent bullets (#11477)                                | Limited task-state parsing to the current task level.                                          |
| `d10bd1360` | perf(desktop): cache compiled JavaScript between launches (#13501)                              | Wired the desktop and packaged backend compile caches through the boot artifact.               |
| `b3de243d5` | fix(dev): one t3.json setup action that works on every OS (#13589)                              | Replaced platform-specific setup actions with one TypeScript setup script.                     |
| `13d6b3051` | fix(web): new worktree threads no longer say "checkout" during setup (#13590)                   | Shows worktree preparation instead of an incorrect checkout label.                             |
| `86054b6df` | fix(desktop): `t3 app` keeps working after a second desktop app quits (#13585)                  | Ported the activation lease lifecycle and regression coverage.                                 |
| `e3e7cc3fc` | fix(usage): price Claude fast-mode requests at the fast rate (#13599)                           | Added fast-mode records and rate multipliers to usage pricing.                                 |
| `e55e7315e` | fix: update OpenAI logo to current brand asset (#13611)                                         | Updated the web provider icon; absent marketing/mobile assets were omitted.                    |
| `e5a46d6c5` | feat(usage): read cursor, opencode, and antigravity history (#10409)                            | Added readers, dedupe/source metadata, Cursor Keychain opt-in, UI notices, tests, and docs.    |
| `d06f0ff10` | fix(sqlite): retry failed statement preparations (#10584)                                       | Failed preparations no longer poison the statement cache.                                      |
| `a4f6078be` | fix(web): return focus to the composer after saving a citation note (#13450)                    | Restores the Lexical selection and editor focus after citation editing.                        |
| `fd996d15e` | feat(observability): honor the standard OTLP endpoint, headers, and protocol variables (#13492) | Added standard per-signal OTLP resolution, validation, tests, and operations docs.             |
| `1a0c915c4` | fix(terminal): settling a thread closes its idle shells (#13673)                                | Closes only prompt-idle shells on settle and after successful setup scripts.                   |
| `f5bd2fddb` | fix(server): load Cursor keyring with createRequire (#13678)                                    | Loads the native keyring safely from ESM.                                                      |
| `4293433ec` | perf(server): avoid rereading unchanged files in review previews (#13395)                       | Added mtime-aware review-file reuse with focused tests.                                        |

### Already in the tree (4)

| Upstream    | Title                                                                      | Notes                                                                                   |
| ----------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `21e2b7de0` | fix(web): switches announce their real state to screen readers (#11580)    | Ronin's switch already exposes checked state through its native semantics.              |
| `cdb26fe63` | fix(antigravity): let Stop end commands that outlived their turn (#13388)  | Ronin runs Antigravity per turn, and Stop already kills the active child process.       |
| `f61f979c7` | fix(web,mobile): drop the baked-in tile from the Antigravity icon (#13373) | Ronin already uses a newer tile-free vector icon.                                       |
| `72447f23d` | feat(grok): offer one-click updates through `grok update` (#13523)         | Equivalent Grok update behavior already exists in the fork's provider maintenance flow. |

### Skipped (29)

| Upstream    | Title                                                                                          | Notes                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `11e91f126` | feat(mobile): capture Live Activities and agent notifications in showcase screenshots (#13316) | No mobile app in this repo.                                                                 |
| `68fb7f4b8` | feat(mobile): manage environment and provider updates (#13302)                                 | No mobile app in this repo.                                                                 |
| `e4eb9977f` | fix(server): stop replaying old agent alerts on restart (#13340)                               | Hosted relay and its agent-alert replay are deliberately cut.                               |
| `c0912debc` | fix(web): use a brain icon for the effort dropdown (#13309)                                    | Superseded by Ronin's provider-control visual language.                                     |
| `9383f4ad7` | chore: add scratchyone to vouched list (#13353)                                                | Upstream contributor-governance data is not part of the fork.                               |
| `80fc23ac3` | lint/unknown and static (#13366)                                                               | Cleanup-only lint churn was not imported across the diverged tree.                          |
| `315fcca10` | fix(web): web colors come from theme tokens (#13371)                                           | Superseded by Ronin's theme and component system.                                           |
| `f26ee083f` | fix(web): appearance classes use theme tokens and scale values (#13397)                        | Superseded by Ronin's appearance implementation.                                            |
| `ffb5fcce7` | fix(server): keep Codex's reset answer when the re-probe fails (#13363)                        | Depends on the deliberately omitted Limits/reset-credit surface.                            |
| `84c436bcf` | fix(mobile): branch search finds remote and space-typed branches (#13454)                      | No mobile app in this repo.                                                                 |
| `7cfb4987f` | chore(ci): use GPT 6 Sol Max for check agents (#13473)                                         | Upstream CI-agent model governance is not inherited by the fork.                            |
| `3412097bf` | feat(server): show and redeem Claude banked resets (#13118)                                    | The upstream Limits/reset-credit product surface is deliberately omitted.                   |
| `53456bc01` | fix(marketing): use the official OpenCode and Antigravity logos (#13365)                       | No marketing app in this repo.                                                              |
| `f3cb2a1fe` | fix(antigravity): keep Windows runtime unpacking under MAX_PATH (#13389)                       | Ronin's per-turn `agy` adapter does not unpack that upstream runtime.                       |
| `720490adc` | fix(web): normalize disabled control opacity (#11441)                                          | Superseded by Ronin's component styling.                                                    |
| `d4a33457c` | fix(desktop): desktop updates reconnect in seconds, not minutes (#12006)                       | Targets the newer upstream updater architecture, which the fork does not have.              |
| `8d7b5e998` | fix(connect): remove tunnels after hosts go offline (#9386)                                    | T3 Connect is deliberately cut.                                                             |
| `9c524d577` | fix(mobile): capture a lit 6.9-inch lock screen in the agent-activity showcase (#13522)        | No mobile app in this repo.                                                                 |
| `59abcd67a` | fix(mobile): make Android subscription usage widgets scrollable (#13474)                       | No mobile app in this repo.                                                                 |
| `d23eab13d` | fix(relay): export tunnel cleanup counters to Axiom (#13528)                                   | Hosted relay is deliberately cut.                                                           |
| `0cab7d5ab` | fix(server): Grok accounts with no usage yet no longer vanish from Limits (#12799)             | Depends on the omitted Limits surface.                                                      |
| `91e53e501` | fix(server): report the Grok account email so usage limits merge across environments (#12588)  | Depends on the omitted Limits surface.                                                      |
| `568c9bc4d` | chore: clear Effect language service suggestions (#13536)                                      | Cleanup-only churn was not imported.                                                        |
| `fc46b8c3d` | ci(relay): add a forced manual relay deploy (#13550)                                           | Hosted relay is deliberately cut.                                                           |
| `ab70c8943` | fix(clients): sync status no longer flickers when opening running threads (#13551)             | Ronin has no matching sync-status UI; the underlying background sync was ported separately. |
| `a107f8a07` | fix(clients): a preview app no longer knocks the desktop's own server offline (#13577)         | Targets an upstream discovery-compatibility layer absent from Ronin.                        |
| `c13f7d93f` | feat(release): ship a Linux .deb that updates itself (#13575)                                  | Ronin's current updater and release path is AppImage-only.                                  |
| `1c1270663` | fix(mobile): render assigned project icons in chat list (#12810)                               | No mobile app in this repo.                                                                 |
| `7a12aff47` | fix(mobile): scale Android controls with appearance text size (#13356)                         | No mobile app in this repo.                                                                 |

### Verification

- Typechecks pass for contracts, shared, effect-codex-app-server, client runtime, server, web, and
  desktop. Server and client-runtime output contains only non-blocking Effect suggestions.
- Focused tests pass across contracts/shared parsing, provider compatibility and protocol generation,
  usage readers/pricing/merge, auto-settle and terminal cleanup, device streaming/folding, desktop
  activation/compile cache, MCP snapshot bounds, review-preview reuse, and changed web logic.
- All changed text files pass targeted formatting validation, including the release workflow;
  `git diff --check` passes.
- React Doctor completed its changed-scope scan at **38/100** across the cumulative uncommitted sync
  delta. Its findings are the existing/upstream large-component and React Compiler backlog; the one
  cleanup warning points at an effect that already removes all listeners and clears its timer.
- The 80-commit ledger matches the frozen range: **47 Port, 4 Already in tree, 29 Skip, 0 Ask**.

**Hit every applicable surface:** desktop Electron startup/activation/preview/SnapShot, web chat/
composer/sidebar/settings/usage/device/pull requests, server orchestration/providers/terminal/
usage/device/MCP/SQLite/review previews, wire contracts, client runtime, shared helpers, CI setup,
local and remote device hosts, and user/internals/operations docs. Mobile, T3 Connect, hosted relay,
marketing, the Limits/reset-credit product, the newer desktop updater, and upstream theme migrations
remain deliberately cut.

### Not tested

- No live browser/client automation was run, per `AGENTS.md`.
- No real provider process, simulator, SSH device host, macOS Keychain prompt, telemetry collector,
  GitHub mutation, packaged release, or self-updater was exercised against an external system.

# Upstream (T3 Code) sync log

Ronin is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) with a deliberate cut:
desktop only, no mobile app, no T3 Connect / Clerk / hosted relay, no WSL, no legacy sidebar, no
Playwright preview automation. Upstream commits are therefore **triaged, not merged**.

This file is the watermark. On the next sync, only look at commits _after_ the SHA below — every
commit at or before it has already been judged, and the verdict is recorded here.

## Watermark

|                               |                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Upstream reviewed through** | `994372ba4` — `fix(server): push no longer writes a feature branch's commits to its base branch (#8228)` (2026-08-25) |
| **Fork merge base**           | `083fa4ab2` — `feat(web): use OKLCH for theme palettes (#6036)`                                                       |
| **Ported on**                 | 2026-08-26                                                                                                            |

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

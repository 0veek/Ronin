# Workspace layout

> For maintainers. Using Ronin? See [docs/user](../user/).

A pnpm workspace driven by [vite-plus](https://vite.plus) (`vp`). See [scripts.md](./scripts.md) for
the task commands.

## apps

- `apps/server` (`t3`): the execution runtime and the published CLI. Owns orchestration, provider
  drivers, checkpointing, VCS, terminals, filesystem access, auth, and the HTTP + WebSocket surface.
  Also serves the built web app.
- `apps/web` (`@t3tools/web`): React + Vite UI used as the desktop renderer (and for local web dev).
  Consumes the shared client runtime and adds routing, components, and web-specific platform layers.
- `apps/desktop` (`@t3tools/desktop`): Electron shell and primary shipped product. Supervises a
  desktop-scoped `t3` backend, loads the web bundle over the `t3code://` protocol, and owns
  SSH-managed remote environments.

## packages

- `packages/contracts` (`@t3tools/contracts`): shared Effect Schema definitions. RPC group,
  orchestration commands/events/read model, auth scopes, environment descriptors, settings.
- `packages/shared` (`@t3tools/shared`): framework-agnostic utilities used by server and clients
  (`DrainableWorker`, git and source-control helpers, semver, logging, observability, and more).
- `packages/client-runtime` (`@t3tools/client-runtime`): connection lifecycle, authorization, RPC
  session, environment registry, and Atom-based domain state shared by web and desktop. See its
  [README](../../packages/client-runtime/README.md).
- `packages/ssh` (`@t3tools/ssh`): SSH config parsing, auth prompts, command execution, and the
  tunnel/environment manager behind desktop-managed SSH environments.
- `packages/tailscale` (`@t3tools/tailscale`): Tailscale CLI wrapper, including the
  `ensureTailscaleServe` / `disableTailscaleServe` serve lifecycle the server drives.
- `packages/effect-acp` (`effect-acp`): Effect client and agent implementation of the Agent Client
  Protocol, used by ACP-speaking provider drivers.
- `packages/effect-codex-app-server` (`effect-codex-app-server`): Effect client for the
  `codex app-server` JSON-RPC protocol.

## Other top-level directories

- `scripts/`: workspace tooling run through `vp run`. Dev runner, desktop artifact builds, release
  helpers, update-manifest merging.
- `assets/`: brand and app icon sources per channel (`dev`, `nightly`, `prod`).
- `patches/`: pnpm patches for pinned upstream dependencies.
- `oxlint-plugin-t3code/`: repo-specific lint rules.
- `docs/`: this documentation tree.

## Import conventions

`@t3tools/shared` and `@t3tools/client-runtime` use explicit subpath exports with no barrel index and
no wildcard re-exports. Import the concrete subpath you need.

## Renderer design system

The desktop and browser share the renderer's workspace styling. `styles/tokens.css` defines
semantic roles and geometry; `styles/themes.css` maps selected palettes onto those roles.
`styles/chrome.css` owns shared panel, composer, and overlay treatments. `styles/workspace.css`
owns the Ronin insignia, draft landing, sidebar actions, and settings surfaces. Keep new
decoration expressed in semantic roles so environment and custom themes work in both modes.

The standard palette's theme-editor seed lives in `themePalette.ts`; startup colors live in
`index.html`. Keep those copies aligned with token changes to avoid a different color during
boot or when duplicating the standard appearance. Native titlebar height and control insets
are shared with Electron and must retain their geometry when changing renderer chrome.

Default workspace surfaces are solid, with neutral controls. Entrance and hover motion uses transform or opacity and the
shared duration tokens, which become zero for reduced motion. Short or narrow windows put
the draft heading, composer, and starter cards in one scrollable flow.

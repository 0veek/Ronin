# Dev container

> For maintainers. Using Ronin? See [docs/user](../user/).

`.devcontainer/` provides a ready-to-code Linux environment matching CI: Ubuntu 24.04, Node 24, pnpm, Rust stable, the global `vp` CLI, and the GitHub CLI. Open the repository in VS Code and choose **Reopen in Container**, or create a GitHub Codespace. Dependency installation (`vp i`), the Electron runtime repair, and the Vite dependency-cache warmup run automatically before you attach.

## What works in the container

- The full server and renderer stack: run `vp run dev`, then open the pairing URL it prints through the forwarded web port (5733). The bare origin does not authenticate. VS Code forwards the port as localhost, so the printed URL works as-is. In browser-based Codespaces the forwarded origin differs; if the server rejects it, pass that origin through `T3CODE_DEV_ALLOWED_ORIGINS`.
- The Linux CI workflows: focused `vp test run <files>`, `vp lint <files>`, package typechecks, `vp run build:desktop`, and the resource-monitor Cargo build and tests. (`vpr` is not installed globally; use `vp run <script>` or `node_modules/.bin/vpr` after installation.)

## State and safety

`T3CODE_HOME` points at the workspace's gitignored `.ronin` directory, so runtime state stays inside the container workspace and cannot land on a host Ronin install. An explicit `--home-dir` still wins. Test data should still be copied into the workspace; never point a development server at shared live state.

## Caching

Two named volumes keep rebuilds fast and dependency traffic off slow macOS and Windows bind mounts: the pnpm store is shared across checkouts, while the root `node_modules` volume is scoped to one container. Recreating a container reuses both. The host may see an empty `node_modules`; run repository tooling inside the container.

## Out of scope

- Launching the Electron window requires a host display. Building and verifying the desktop bundle works headlessly in the container.
- `vp run dev --share` requires a Tailscale binary and a tailnet; neither is provisioned here.

## Prebuilds

Container creation installs the toolchain and all dependencies, so prebuilding can substantially reduce startup time. Codespaces prebuilds are configured in repository settings and automatically use the lifecycle commands in this configuration. Prebuild snapshots exclude named volumes; a prebuild-first workflow may prefer removing the volume mounts. Outside Codespaces, the Dev Container CLI can publish an image:

```bash
devcontainer build --workspace-folder . --push true --image-name <registry>/ronin-devcontainer:latest
```

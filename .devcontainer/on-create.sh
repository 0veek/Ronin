#!/usr/bin/env bash
# One-time container setup, baked into prebuilds. Content-dependent work
# (dependency installation and cache warming) lives in update-content.sh.
set -euo pipefail

# The Vite+ CLI is the repo task runner (vp i, vp run dev, vp test run).
# Download first so a curl failure cannot be mistaken for an empty successful
# install. Node comes from the devcontainer feature, so skip installer shims.
export VP_BIN_DIR="$HOME/.local/share/vite-plus/bin"
export VP_DATA_DIR="$HOME/.local/share/vite-plus"
export VP_CACHE_DIR="$HOME/.cache/vite-plus"
installer=$(mktemp)
curl -fsSL https://vite.plus -o "$installer"
VP_NODE_MANAGER=no bash "$installer"
rm -f "$installer"

# Lifecycle commands run in non-login shells, so expose vp independently of
# the profile edit made by the installer.
test -x "$VP_BIN_DIR/vp"
sudo ln -sf "$VP_BIN_DIR/vp" /usr/local/bin/vp

sudo mkdir -p /usr/local/etc/vscode-dev-containers
sudo tee /usr/local/etc/vscode-dev-containers/first-run-notice.txt >/dev/null <<'EOF'
Ronin devcontainer

  vp run dev  start server + web, then open the pairing URL it prints
              (the bare forwarded port will not authenticate)

Details: docs/internals/devcontainer.md
EOF

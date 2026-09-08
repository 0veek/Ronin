#!/usr/bin/env bash
# Runs at creation and on every prebuild content refresh, so environments
# start with dependencies installed and caches warm. Everything is idempotent.
set -euo pipefail

# Volume mounts and the directories Docker creates for them can arrive
# root-owned; hand them to the dev user before installing.
for dir in "$HOME/.cache" "$HOME/.cache/pnpm" node_modules; do
  if [ -d "$dir" ] && [ "$(stat -c %U "$dir")" != "$(id -un)" ]; then
    sudo chown "$(id -un):$(id -gn)" "$dir"
  fi
done

CI=true vp i
# Repair Electron's path.txt and executable bits after install, as CI does.
vp run --filter @t3tools/desktop ensure:electron
# Pre-warm Vite's dependency optimizer for the stable container path.
node apps/web/scripts/warm-dep-cache.ts

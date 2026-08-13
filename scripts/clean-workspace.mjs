#!/usr/bin/env node
// Removes build output and installed dependencies across the workspace.
//
// Node rather than `rm -rf`: cmd.exe and PowerShell have neither `rm -rf` nor
// the `apps/*/dist` globbing the shell form relied on, so the script form is
// what makes `clean` mean the same thing on every platform a contributor runs.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const repoRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

const REMOVAL_PATTERNS = [
  "node_modules",
  "apps/*/node_modules",
  "packages/*/node_modules",
  "apps/*/dist",
  "apps/*/dist-electron",
  "packages/*/dist",
  ".vite-plus",
  "apps/*/.vite-plus",
  "packages/*/.vite-plus",
];

let removed = 0;
for (const pattern of REMOVAL_PATTERNS) {
  for (const match of NodeFS.globSync(pattern, { cwd: repoRoot })) {
    const target = NodePath.join(repoRoot, match);
    NodeFS.rmSync(target, { recursive: true, force: true });
    removed += 1;
    console.log(`[clean] removed ${match}`);
  }
}

console.log(`[clean] ${removed} path${removed === 1 ? "" : "s"} removed.`);

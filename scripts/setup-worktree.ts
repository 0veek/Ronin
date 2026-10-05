// @effect-diagnostics nodeBuiltinImport:off - runs before `vp i`, so only Node built-ins exist.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const ENV_FILES = [".env", NodePath.join("infra", "relay", ".env")];
const projectRoot = process.env.T3CODE_PROJECT_ROOT;
if (!projectRoot) {
  throw new Error("T3CODE_PROJECT_ROOT is not set. Run this through the t3.json setup action.");
}
const worktree = NodePath.dirname(import.meta.dirname);

const install = NodeChildProcess.spawnSync("vp i", {
  cwd: worktree,
  shell: true,
  stdio: "inherit",
});
if (install.status !== 0) process.exit(install.status ?? 1);

// Only replace worktree symlinks; real files belong to the checkout owner.
for (const file of ENV_FILES) {
  const source = NodePath.join(projectRoot, file);
  const sourceStat = NodeFS.lstatSync(source, { throwIfNoEntry: false });
  if (!sourceStat) continue;
  if (!sourceStat.isFile()) {
    process.stderr.write(`Skipping ${file}: ${source} is not a regular file.\n`);
    continue;
  }
  const target = NodePath.join(worktree, file);
  const targetStat = NodeFS.lstatSync(target, { throwIfNoEntry: false });
  if (targetStat && !targetStat.isSymbolicLink()) {
    if (NodePath.resolve(source) !== NodePath.resolve(target)) {
      process.stderr.write(`Skipping ${file}: ${target} is a real file.\n`);
    }
    continue;
  }
  if (targetStat) NodeFS.unlinkSync(target);
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  NodeFS.symlinkSync(source, target);
}

const warm = NodeChildProcess.spawnSync(
  process.execPath,
  [NodePath.join(worktree, "apps", "web", "scripts", "warm-dep-cache.ts")],
  { cwd: worktree, stdio: "inherit" },
);
process.exit(warm.status ?? 1);

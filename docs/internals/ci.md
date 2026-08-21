# CI quality gates

> For maintainers. Using Ronin? See [docs/user](../user/).

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs these quality gates on pull
requests and pushes to `main`:

- **Check**: `vp check` (format and lint; this repo sets `typeCheck: false` in its lint options),
  then `vpr typecheck` for the workspace type check. The same job
  builds the desktop pipeline (`vp run build:desktop`) and verifies the preload bundle exists and
  still exports its expected symbols (and does not contain Clerk). It also rejects any committed
  `.github/pr-assets/` file: PR evidence belongs on GitHub, not in the tree.
- **Test**: every package except `t3` (`apps/server`), run with `--parallel`. Those `test` tasks
  declare no `dependsOn` and resolve workspace dependencies from source, so the default dependency
  ordering only bought idle runners between layers. The concurrency limit stays at 4.
- **Test Server 1..3**: `apps/server` sets `fileParallelism: false`, so its files run strictly one
  at a time. Sharding spreads them across three runners rather than three workers, which preserves
  that isolation exactly. Only the shard that runs `src/server.test.ts` produces the thread
  transfer budget report, so the upload is gated on the file existing — one
  `thread-transfer-results` artifact per run, which is the name `thread-transfer-report.yml`
  resolves.
- **Rust**: `cargo fmt --check` and `cargo test` for `native/resource-monitor`, on its own runner.
  Check and Test used to each install a Rust toolchain (~7-9s) for checks that take under 3s.
- **Windows Regression**: the Windows-only paths — command resolution, shell environment, process
  spawning, terminals, workspace paths, desktop backend configuration — on a real `windows-2025`
  runner. Ronin runs natively on Windows, so these branches are only ever exercised for real here.
- **Release Smoke**: exercises release-only workflow steps through `scripts/release-smoke.ts`, so
  release breakage surfaces on PRs rather than at tag time.

`.github/workflows/release.yml` builds macOS (`arm64` and `x64`), Linux (`x64`), and Windows (`x64`)
desktop artifacts from a single `v*.*.*` tag and publishes one GitHub release. It auto-enables
signing only when platform credentials are present. Windows uses Azure Trusted Signing. Without the
core signing credentials, it still releases unsigned artifacts.

See [Release Checklist](../operations/release.md) for the full release/signing setup checklist.

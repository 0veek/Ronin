# Install Ronin

Ronin is a web and desktop GUI for running coding agents on your machine.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the Ronin server.

At least one provider CLI, installed and authenticated. See [Providers](#providers) below.

## Run Without Installing

```bash
npx t3@latest
```

This starts the Ronin server on your machine and opens the local web app. Use
`npx t3@latest --help` for the full CLI reference.

If the web or desktop app shows "Ronin could not load", check your connection and select
**Reload** to try again.

## Open a project in the desktop app

When the Ronin desktop app is running on the same machine, open the current directory with:

```bash
npx t3 app
```

Pass a path to open another directory:

```bash
npx t3 app ../my-project
```

The command adds the directory as a project when needed, focuses the desktop app, and opens a new
thread. It does not launch the desktop app, open a browser, or start a Ronin server. A background
server does not count as the desktop app. The command also rejects SSH sessions because a remote
shell cannot focus a local desktop window. The CLI package and the running desktop app must both
include `t3 app` support.

## Desktop App

Download the latest release from
[GitHub Releases](https://github.com/0veek/Ronin/releases) and pick the file for your machine:

| Platform            | File                    |
| ------------------- | ----------------------- |
| macOS (Apple check) | `*-arm64.dmg`           |
| macOS (Intel)       | `*-x64.dmg`             |
| Linux               | `*-x64.AppImage`        |
| Windows             | `*-x64.exe` (installer) |

Ronin is not in any package registry yet, so there is nothing to `winget`, `brew`, or `yay`.
The app updates itself: it checks for new releases and tells you when one is out. See
[Updating](./updating.md).

## Providers

Ronin drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider    | CLI                                                   | Default binary | Log in with           |
| ----------- | ----------------------------------------------------- | -------------- | --------------------- |
| Codex       | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        | `codex login`         |
| Claude      | [Claude Code](https://claude.com/product/claude-code) | `claude`       | `claude auth login`   |
| Cursor      | [Cursor CLI](https://cursor.com/cli)                  | `cursor-agent` | `agent login`         |
| Grok Build  | [Grok Build CLI](https://x.ai/cli)                    | `grok`         | `grok login`          |
| OpenCode    | [OpenCode](https://opencode.ai)                       | `opencode`     | `opencode auth login` |
| Antigravity | Antigravity CLI                                       | `agy`          | the CLI's own sign-in |
| Droid       | Factory Droid CLI                                     | `droid`        | `droid`               |
| Kilo        | Kilo CLI (`@kilocode/cli`)                            | `kilo`         | the CLI's own sign-in |
| Pi          | Pi (`@earendil-works/pi-coding-agent`)                | `pi`           | the CLI's own sign-in |

Codex, Claude, and Cursor are on by default. Every other provider is off by default; turn one on
in **Settings** → the provider's card when you want to use it.

Each provider has its own page under [Providers](./providers-codex.md) with the details that
differ — what a provider cannot do, how its models are listed, and how it updates.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
Ronin looks for, but authenticate with `agent login`, not `cursor-agent login`.

Run the login command on the machine running the Ronin server, not on the device you browse
from.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started Ronin.

### Windows

Ronin runs natively on Windows. There is no WSL step: it launches the same Windows CLIs you
run in PowerShell or Terminal, including the `.cmd` shims npm installs.

Beyond `PATH`, Ronin looks in the places Windows package managers install CLIs — npm, pnpm,
Volta, Bun, Scoop, Cargo, WinGet, Chocolatey, and `%USERPROFILE%\.local\bin` — so a provider
usually works without any configuration. It also reads the `PATH` your PowerShell profile sets,
which covers version managers such as fnm.

Install a CLI while Ronin is running and it can take up to 30 seconds to appear. If the
installer added a new directory to your `PATH`, restart Ronin — it reads `PATH` at launch, so a
brand new entry only counts from the next one.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
Ronin. You can install Ronin, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next Steps

- [Permission modes](./permission-modes.md): how much Ronin asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
- [Keeping Ronin in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service

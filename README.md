<p align="center">
  <img src="assets/prod/logo.svg" width="112" height="112" alt="Ronin" />
</p>

<h1 align="center">Ronin</h1>

<p align="center">
  <strong>浪人</strong> · a masterless samurai<br/>
  <em>Your agents. Your machine. No master but you.</em>
</p>

<p align="center">
  <a href="#the-good-stuff">Features</a> ·
  <a href="#gallery">Gallery</a> ·
  <a href="#run-it">Run it</a> ·
  <a href="#documentation">Docs</a>
</p>

---

**One desktop app for every coding agent you pay for.**

Codex, Claude Code, Cursor, Grok Build, OpenCode, Antigravity, Droid, Kilo, Pi — nine CLIs, one dark-first Electron workspace on **Linux, Windows, and macOS**. Chat, terminal, preview, git, pull requests, stats, themes. Bring your own subscriptions. Ronin sells you nothing and phones home to no one.

If the CLI works in a terminal, Ronin can drive it.

---

## The good stuff

### 🔄 Switch providers mid-thread

Start with Codex, hit a wall, hand the thread to Claude. Same history, same checkpoints, same working directory.

An agent that's been here before **resumes its own session**. A newcomer gets a brief built from the thread. Switch back later and it picks up where it left off — no copy-paste, ever. ([docs](./docs/user/switching-providers.md))

### 🥊 Get a second opinion

Same prompt, two (or more) models, each in its own worktree. Press **Compare**, pick who should answer, and read them as ordinary threads with chips to jump between. Keep the one you like; delete the rest. ([docs](./docs/user/second-opinion.md))

### 💬 Ask on the side

Select the passage you're stuck on. A chip appears — **Ask on the side** opens a fresh thread on exactly that text, same project, same checkout. The main thread never learns you asked. ([docs](./docs/user/side-chats.md))

### 📌 Capture as you read

Agents leave work behind in the transcript — "this helper could go," "these two want merging." Select it and press **Capture**. Ronin files a draft thread, ready on every device, and you stay where you were reading. ([docs](./docs/user/captured-tasks.md))

### 📋 A board, not just a list

Six lanes — Draft, Up Next, Working, Needs You, Snoozed, Done. Drag to settle, snooze, or pick the next thing. The sidebar and the board never disagree. ([docs](./docs/user/board.md))

### ▶️ Replay a turn

Come back to a twenty-minute turn and press **replay**. The prompt, each tool call, and the reply play back in order, pauses compressed so you see the rhythm without sitting through the dead air. ([docs](./docs/user/turn-replay.md))

### 📊 Stats that count everything

Reads each provider's **own session transcripts** — every token, including turns you ran in a bare terminal, on every connected machine. Real costs (Grok's exact figure, not an estimate), cache savings, per-model breakdowns, an hourly chart, and a sidebar meter that shows **when your window resets, to the minute**. ([docs](./docs/user/usage.md))

### ⏳ Hit a limit? Ronin waits

A spent five-hour window isn't a failure you can act on. Ronin parks the message, counts down above the composer, and **sends it the moment the window resets**. Cancel it, fire it early, or walk away. ([docs](./docs/user/quota-resume.md))

### 🖼 Previews, inline

When an agent writes HTML — a coverage report, a chart, a mockup — Ronin renders it **in the transcript**. Sandboxed. Relative assets load. No "open this link." ([docs](./docs/user/inline-previews.md))

### 🔀 Git as a first-class citizen

- **Checkpoints** after every turn — diff or restore anything an agent did
- **Commit, branch, discard, worktrees** in the topbar
- **Pull requests** across every connected server — review, react, edit in place

### 🎨 Themes that go deep

Tsukimi, Aizome, Urushi, the pure-black **OLED Void** family — plus **Open VSX theme search**. Pull almost any VS Code theme straight in. Import your own. Light and dark stay intact.

### 🧰 Skills once, every agent

Drop a `SKILL.md` in `~/.ronin/skills` and **every provider can use it**. Slash commands — `/clear`, `/compact`, `/model`, `/review`, `/fork` — work the same way, next to each CLI's native ones. ([skills](./docs/user/agent-skills.md) · [commands](./docs/user/slash-commands.md))

### ⏰ Work that runs without you

Save a prompt, pick a schedule, walk away. Each run is a **real thread** you can read afterwards, defaulting to its own worktree so unattended edits never land in your checkout. ([docs](./docs/user/automations.md))

### 📱 Remote from anywhere

```bash
npx t3 pair --tailscale
```

Scan the QR. Your phone is driving the same threads, over your tailnet, on hardware you own. LAN and SSH work too. ([docs](./docs/user/remote-access.md))

### And the rest

- **Since you last looked** — what finished, what's still running, what's waiting on you ([docs](./docs/user/digest.md))
- **Needs you** — a sidebar queue, and a dock badge, for anything that stopped until you answer
- **Agent notifications** — a system ping when a turn finishes, fails, or waits for approval
- **Native on Windows** — no WSL; the same CLIs you run in PowerShell
- **Live browser preview** — tabs, navigation, screenshots, recordings
- **Permission modes** — decide how much rope each agent gets
- **Transcript export** — Markdown or JSON
- **Editor hand-off** — opens any file in the editor you actually use

---

## Gallery

<p align="center">
  <img src="Screenshots/Code.png" alt="Ronin workspace — new thread composer, slim sidebar, git actions in the top bar" width="920" />
</p>
<p align="center"><sub><strong>Workspace</strong> — centered composer, resizable sidebar, project-aware threads, source control in the title bar.</sub></p>

<br/>

<p align="center">
  <img src="Screenshots/Usage.png" alt="Ronin Stats page — theme-aware provider charts, cost and token breakdowns" width="920" />
</p>
<p align="center"><sub><strong>Stats</strong> — spend and tokens by provider and model, theme-aware charts, cache savings, hourly resolution.</sub></p>

<br/>

<p align="center">
  <img src="Screenshots/Themes.png" alt="Ronin Appearance settings — color scheme, built-in themes including OLED Void, Open VSX search" width="920" />
</p>
<p align="center"><sub><strong>Appearance</strong> — system / light / dark, first-party themes, OLED blacks, Open VSX theme search.</sub></p>

---

## Run it

> [!IMPORTANT]
> Install and authenticate at least one provider first:
>
> | Provider    | Install                                                     | Auth                        |
> | ----------- | ----------------------------------------------------------- | --------------------------- |
> | Codex       | [Codex CLI](https://developers.openai.com/codex/cli)        | `codex login`               |
> | Claude      | [Claude Code](https://claude.com/product/claude-code)       | `claude auth login`         |
> | Cursor      | [Cursor CLI](https://cursor.com/cli)                        | `agent login`               |
> | Grok Build  | [Grok Build CLI](https://x.ai/cli)                          | `grok login`                |
> | OpenCode    | [OpenCode](https://opencode.ai)                             | `opencode auth login`       |
> | Antigravity | [Antigravity CLI](https://antigravity.google) (`agy`)       | sign in via `agy`           |
> | Droid       | [Factory Droid](https://docs.factory.ai/droid-cli/overview) | `droid` / `FACTORY_API_KEY` |
> | Kilo        | [Kilo CLI](https://kilo.ai/cli)                             | `kilo` auth                 |
> | Pi          | [Pi](https://pi.dev/)                                       | `pi`                        |

### Desktop

Download the latest build from [Releases](https://github.com/0veek/Ronin/releases). The app updates itself.

Or build from source:

```bash
# Node 22.16+ / 23.11+ / 24.10+
curl -fsSL https://vite.plus | bash   # install vp (macOS/Linux)

vp i
vp run dev            # server + web
# or
vp run dev:desktop    # Electron shell
```

```bash
vp run build:desktop
vp run dist:desktop:linux          # Linux AppImage
vp run dist:desktop:win            # Windows installer (NSIS)
vp run dist:desktop:dmg:arm64      # macOS
```

Artifacts ship as `Ronin-${version}-${arch}.${ext}`. On Windows, Ronin runs native CLIs — no WSL. ([install docs](./docs/user/install.md))

---

## Documentation

| Audience           | Start here                                                             |
| ------------------ | ---------------------------------------------------------------------- |
| Using Ronin        | [docs/user/install.md](./docs/user/install.md)                         |
| Keybindings        | [docs/user/keybindings.md](./docs/user/keybindings.md)                 |
| Switching provider | [docs/user/switching-providers.md](./docs/user/switching-providers.md) |
| Second opinion     | [docs/user/second-opinion.md](./docs/user/second-opinion.md)           |
| Side chats         | [docs/user/side-chats.md](./docs/user/side-chats.md)                   |
| Board              | [docs/user/board.md](./docs/user/board.md)                             |
| Automations        | [docs/user/automations.md](./docs/user/automations.md)                 |
| Stats & usage      | [docs/user/usage.md](./docs/user/usage.md)                             |
| Remote / Tailscale | [docs/user/remote-access.md](./docs/user/remote-access.md)             |

Full tree: [docs/](./docs).

---

Built on [T3 Code](https://github.com/pingdotgg/t3code).

Early. Expect bugs. Prefer small fixes over grand PRs unless we ask. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

---

<p align="center">
  <sub>浪人 — cut free. Keep the blade sharp.</sub>
</p>

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
  <a href="#documentation">Docs</a> ·
  <a href="#lineage">Lineage</a>
</p>

---

**One desktop app for every coding agent you pay for.**

Codex, Claude Code, Cursor, Grok Build, OpenCode, Antigravity, Droid, Kilo, Pi — nine CLIs, one dark-first Electron workspace. Chat, terminal, preview, git, pull requests, stats, themes. Bring your own subscriptions; Ronin sells you nothing and phones home to no one. Everything runs on your machine, and the whole thing is open source.

If the CLI works in a terminal, Ronin can drive it.

---

## The good stuff

### 🔄 Switch providers mid-thread

The feature no other harness has: **hand a live conversation to a different agent and it keeps going.** Start with Codex, hit a wall, hand the thread to Claude — same history, same checkpoints, same working directory.

- An agent that's been in the thread before **resumes its own session** and catches up on what it missed.
- A newcomer gets **a brief built from the thread itself** — the conversation so far, the branch, the files already changed.
- The transcript marks every handover, and each provider keeps its own place in the thread, so switching back later resumes rather than re-briefs.

No copy-pasting context between terminals. Ever again. ([docs](./docs/user/switching-providers.md))

### 📊 Stats that count everything

The Stats page reads each provider CLI's **own session transcripts** — so every token is counted, including the turns you ran in a bare terminal, on every connected machine, deduplicated across environments. API-equivalent cost, cache savings, per-model breakdowns, and an hourly-resolution chart for the last 24 hours.

Every provider owns one color across the whole page — chart, share bars, tables — in a palette validated for color-blind safety in light and dark alike. Grok even records its **exact** per-turn cost in an undocumented tick format; we reverse-engineered it, so that dollar figure is real, not an estimate.

And in your peripheral vision: the sidebar meter shows how much of each subscription window is left and **when it resets, to the minute** — so you know if you can keep working for the next hour without opening anything.

### 🔀 Git as a first-class citizen

Not a plugin. Not a tab you forget exists.

- **Checkpoints** — every turn ends with a hidden git ref, so you can diff or restore anything an agent did.
- **Commit, branch, discard, worktrees** — right in the workspace topbar.
- **Pull requests** — list them across every connected server, filter, react, edit in place, review diffs without leaving the app.

### 🎨 Themes that go deep

First-party themes (Tsukimi, Aizome, Urushi, the pure-black **OLED Void** family) — plus **Open VSX theme search**: pull almost any VS Code theme straight into Ronin. Import your own, tune the typography, keep light and dark mode intact per theme.

### 🧰 Skills and slash commands, portable across agents

Drop a `SKILL.md` in `~/.ronin/skills` once and **every provider can use it** — Codex, Claude, Grok, all of them. Same for slash commands: `/clear`, `/compact`, `/model`, `/review`, `/fork`, `/status` and friends work everywhere, alongside each provider's native commands. ([skills](./docs/user/agent-skills.md) · [commands](./docs/user/slash-commands.md))

### 📱 Remote from anywhere

The server speaks typed WebSockets, and pairing is one command:

```bash
npx t3 pair --tailscale
```

Scan the QR code and your phone is driving the same threads, over your tailnet, end-to-end on hardware you own. LAN and SSH work too. ([docs](./docs/user/remote-access.md))

### ⚡ Performance without compromise

No GPU-pegging animations, no token-by-token repaint storms, no lying spinners. Buffered assistant output, careful WebSocket payloads, lists that stay fast at thousands of threads. Ronin's users drive agents all day and notice a dropped frame — so we don't drop them.

### And the rest

- **Live preview** — tabs, navigation, screenshots, recordings of the app your agent is building
- **Composer-first workspace** — "What should we build?" with provider, model, effort and plan controls in one card
- **Markdown that renders** — images, diffs, code, all inline in the transcript
- **Editor hand-off** — Ronin finds your installed editors and opens any file where you actually work
- **Permission modes** — decide how much rope each agent gets ([docs](./docs/user/permission-modes.md))

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

## How it's built

```
┌─────────────────────────────────────────────────────────┐
│  Ronin (Electron)                                       │
│  ┌──────────┐  ┌────────────────────────────────────┐   │
│  │ Sidebar  │  │ Workspace topbar · git · panels    │   │
│  │ Threads  │  │ Chat · composer · terminal         │   │
│  │ PRs ·    │  │ Stats · Settings · OLED themes     │   │
│  │ Usage    │  └──────────────────▲─────────────────┘   │
│  └────┬─────┘                     │                     │
│       │ typed WS / IPC            │                     │
│  ┌────▼───────────────────────────┴─────────────────┐   │
│  │  Server · event-sourced · provider adapters      │   │
│  │  checkpoints · reactors · receipts               │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

An event-sourced Node server wraps the provider CLIs as subprocesses; per-provider adapters translate their native protocols into one orchestration model. Commands become events, events become the UI you see, and every turn checkpoints. The desktop shell embeds the web renderer — which is also how your phone connects remotely. Deep dive: [docs/internals/overview.md](./docs/internals/overview.md).

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

### From source

```bash
# Node 22.16+ / 23.11+ / 24.10+
curl -fsSL https://vite.plus | bash   # install vp (macOS/Linux)

vp i
vp run dev            # server + web
# or
vp run dev:desktop    # Electron shell
```

Ports are worktree-stable; read the `[dev-runner]` line for the real URL. Pairing needs the **full URL including the token**.

### Desktop artifact

```bash
vp run build:desktop
vp run dist:desktop:linux          # primary path
vp run dist:desktop:dmg:arm64      # macOS
```

Artifacts ship as `Ronin-${version}-${arch}.${ext}`. Linux-first, Mac supported.

---

## Documentation

| Audience           | Start here                                                             |
| ------------------ | ---------------------------------------------------------------------- |
| Using Ronin        | [docs/user/install.md](./docs/user/install.md)                         |
| Keybindings        | [docs/user/keybindings.md](./docs/user/keybindings.md)                 |
| Switching provider | [docs/user/switching-providers.md](./docs/user/switching-providers.md) |
| Agent skills       | [docs/user/agent-skills.md](./docs/user/agent-skills.md)               |
| Slash commands     | [docs/user/slash-commands.md](./docs/user/slash-commands.md)           |
| Source control     | [docs/user/source-control.md](./docs/user/source-control.md)           |
| Stats & usage      | [docs/user/usage.md](./docs/user/usage.md)                             |
| Remote / Tailscale | [docs/user/remote-access.md](./docs/user/remote-access.md)             |
| Architecture       | [docs/internals/overview.md](./docs/internals/overview.md)             |
| Glossary           | [docs/internals/glossary.md](./docs/internals/glossary.md)             |

Full tree: [docs/](./docs).

---

## Lineage

Ronin is a **fork of [T3 Code](https://github.com/pingdotgg/t3code)** by Theo and the T3 tools team — the event-sourced server, multi-provider adapters, and remote-ready architecture come from that excellent foundation. Ronin is the **masterless cut**: desktop-only, no hosted relay, no WSL orchestration, no mobile surface — a thinner blade with a full UI pass on top.

Some later surfaces — portable agent skills, composer slash commands, and the Antigravity / Droid / Kilo / Pi providers — were adapted from **[Synara](https://github.com/Emanuele-web04/synara)** by Emanuele.

```
upstream  →  pingdotgg/t3code
reference →  Emanuele-web04/synara
this fork →  0veek/Ronin
```

Curious exactly what was cut and why? The commit history tells the whole story.

---

## Status

Early. Expect bugs. Prefer small fixes over grand PRs unless we ask.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

---

<p align="center">
  <sub>浪人 — cut free. Keep the blade sharp.</sub>
</p>

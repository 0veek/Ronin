<p align="center">
  <img src="assets/prod/logo.svg" width="112" height="112" alt="Ronin" />
</p>

<h1 align="center">Ronin</h1>

<p align="center">
  <strong>浪人</strong> · a masterless samurai<br/>
  <em>Your agents. Your machine. No master but you.</em>
</p>

<p align="center">
  <a href="#how-ronin-differs-from-t3-code">Why Ronin</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#run-it">Run it</a> ·
  <a href="#documentation">Docs</a>
</p>

---

Ronin is a **lean desktop harness** for coding agents.

It wraps the CLIs you already pay for — Codex, Claude Code, Cursor, Grok Build, OpenCode — in a fast Electron shell with a real chat UI, terminal, preview, and **source control**. Bring your own subscription. Nothing is sold here.

This tree is a **fork of [T3 Code](https://github.com/pingdotgg/t3code)** — same event-sourced server, same multi-provider adapters, same remote-ready websocket core — re-cut for people who want the blade without the scabbard.

---

## How Ronin differs from T3 Code

T3 Code is an excellent open product with a wide surface. Ronin is that product after a deliberate **cut**.

|                     | **T3 Code**                                       | **Ronin**                                                              |
| ------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| **Identity**        | Broad agent control surface                       | Desktop-first, fork with a sharper edge                                |
| **Product surface** | Desktop + local web + cloud/Connect paths         | Desktop + local server/renderer — no hosted Connect                    |
| **Windows / WSL**   | Dual backend, WSL distro orchestration            | Native backends only — **no WSL dual-mode**                            |
| **Preview**         | Element pick, PiP, Playwright automation          | Tabs, navigate, screenshot, recording — **no pick/PiP/Playwright fat** |
| **Themes**          | Managed palettes                                  | Managed + **deep OLED** (Void, Azure, Phosphor, Plasma…)               |
| **Git**             | Full source control                               | **Kept** — checkpoints, diffs, branches, PR flows                      |
| **Packaging**       | Multi-platform release matrix incl. WSL prebuilds | **Linux-first**, Mac supported; Windows shell without WSL cargo        |
| **Philosophy**      | Feature-rich open default                         | _Measure twice, cut once_ — keep what earns its weight                 |

### What we cut

- **T3 Connect / hosted relay** — no cloud pairing product surface, no Clerk-shaped hosted path
- **WSL as a second OS inside the app** — no `wsl.exe` orchestrator, no distro picker, no dual Windows+Linux backend
- **Playwright preview automation** — no injected browser automation, no element-pick preload, no picture-in-picture guest window
- **Surface area that only existed to serve the above** — packaging prebuilds, settings toggles, splash states, dead IPC

### What we keep (on purpose)

- **Git features** — checkpoints, restore, diffs, worktrees, source control UI
- **Multi-provider agents** — Codex · Claude · Cursor · Grok · OpenCode
- **Remote-ready architecture** — local, LAN, Tailscale/SSH environments
- **Performance posture** — no continuous GPU-burning chrome; careful about websocket payload and render cost
- **Open source** — forkable, inspectable, yours

> Ronin is not “T3 Code but worse.” It is **T3 Code with the masterless cut**: fewer doors, same forge.

---

## What you get

```
┌─────────────────────────────────────────────────────────┐
│  Ronin (Electron)                                       │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ Chat · Terminal │  │ Preview · Diffs · Settings   │  │
│  │ Threads · Git   │  │ OLED themes · Keybindings    │  │
│  └────────┬────────┘  └──────────────▲───────────────┘  │
│           │  typed WS / IPC          │                  │
│  ┌────────▼──────────────────────────┴───────────────┐  │
│  │  Server  ·  event-sourced  ·  provider adapters   │  │
│  │  checkpoints  ·  reactors  ·  receipts            │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- **Desktop app** — primary surface (Electron embeds the web renderer)
- **Local server** — `t3` CLI / Node backend on your machine
- **Your providers** — if the CLI works in a terminal, Ronin can drive it
- **Source control** — first-class git, not an afterthought

---

## Run it

> [!IMPORTANT]
> Install and authenticate at least one provider first:
>
> | Provider   | Install                                               | Auth                  |
> | ---------- | ----------------------------------------------------- | --------------------- |
> | Codex      | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex login`         |
> | Claude     | [Claude Code](https://claude.com/product/claude-code) | `claude auth login`   |
> | Cursor     | [Cursor CLI](https://cursor.com/cli)                  | `agent login`         |
> | Grok Build | [Grok Build CLI](https://x.ai/cli)                    | `grok login`          |
> | OpenCode   | [OpenCode](https://opencode.ai)                       | `opencode auth login` |

### From this fork (recommended)

```bash
# Node 22.16+ / 23.11+ / 24.10+
curl -fsSL https://vite.plus | bash   # install vp (macOS/Linux)

vp i
vp run dev            # server + web
# or
vp run dev:desktop    # Electron shell
```

Ports are worktree-stable; read the `[dev-runner]` line for the real URL. The web UI needs a **pairing URL** (token included) from the server output — bare origin is not enough.

### Local web without a full clone

Upstream’s one-liner still boots the shared stack:

```bash
npx t3@latest
```

Use that for a quick feel of the harness; **Ronin-specific cuts and branding live in this repo**.

### Desktop artifact (packaged)

```bash
vp run build:desktop
# Linux AppImage (primary packaging path)
vp run dist:desktop:linux
# macOS
vp run dist:desktop:dmg:arm64
```

---

## Themes

Ronin ships dark-first palettes and **OLED pure-black** options — Void, Azure, Phosphor, Plasma — for late nights and true-black panels. Glass works best when the compositor cooperates; on Wayland+Vulkan, desktop softens the path so backdrop blur does not fall over.

---

## Documentation

| Audience           | Start here                                                   |
| ------------------ | ------------------------------------------------------------ |
| Using Ronin        | [docs/user/install.md](./docs/user/install.md)               |
| Keybindings        | [docs/user/keybindings.md](./docs/user/keybindings.md)       |
| Source control     | [docs/user/source-control.md](./docs/user/source-control.md) |
| Remote / Tailscale | [docs/user/remote-access.md](./docs/user/remote-access.md)   |
| Architecture       | [docs/internals/overview.md](./docs/internals/overview.md)   |
| Glossary           | [docs/internals/glossary.md](./docs/internals/glossary.md)   |

Full tree: [docs/](./docs).

---

## Status

Early. Expect bugs. Prefer small fixes over grand PRs unless we ask.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

---

## Lineage

Ronin stands on **[T3 Code](https://github.com/pingdotgg/t3code)** by Theo and the T3 tools team — open architecture, provider adapters, and a desktop product that already refused to ship slop.

We keep that soul. We discard the weight that does not serve a **masterless desktop**.

```
upstream  →  pingdotgg/t3code
this fork →  0veek/t3code  (Ronin)
```

---

<p align="center">
  <sub>浪人 — cut free. Keep the blade sharp.</sub>
</p>

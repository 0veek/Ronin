# Antigravity

Antigravity is Google's coding-agent CLI (`agy`). Ronin starts a print-mode session with `agy -p` and streams the reply into the thread.

## Install

Install the Antigravity CLI so `agy` is on your PATH. In Settings, the provider card can stay like this:

```text
Display name: Antigravity
Binary path: agy
```

Turn the provider on, then pick **Antigravity** in the model picker. Models come from `agy models`, so the list follows whatever the installed CLI offers — including one entry per reasoning effort, such as **Gemini 3.7 Flash (High)** and **Gemini 3.7 Flash (Low)**. Hide the variants you never reach for from the provider's model list in Settings.

A custom model has to be an id Antigravity knows, the left-hand column of `agy models` — `gemini-3.7-flash-high`, not `Gemini 3.7 Flash`.

## Access

Print mode cannot pause to ask, so Antigravity answers its own permission prompts:

| Access                  | What Antigravity does                                               |
| :---------------------- | :------------------------------------------------------------------ |
| Full access, Auto       | Runs every tool without asking.                                     |
| Auto-accept edits       | Applies edits; commands that would need approval are declined.      |
| Supervised              | Declines anything that needs approval, and says so in the work log. |
| Plan (interaction mode) | Plans without making changes.                                       |

A supervised turn can therefore end with the agent explaining what it was not allowed to do rather than doing it. Use Full access when a turn needs to run tools unattended.

## Continuity

Each turn runs a fresh `agy` process, and Ronin reconnects it to the conversation the thread started, so follow-up messages keep the earlier context.

Switching model applies to the next message in the same conversation. Because the model rides the spawn line of each turn rather than being fixed when the conversation opens, changing it costs nothing and loses nothing. The same is true of handing a thread to Antigravity from another provider, or away from it.

## Git and pull-request text

Antigravity can write commit messages, pull-request titles and bodies, branch names, and thread titles. Those run as their own sandboxed `agy` print-mode call, so a commit message can never edit your working tree.

## Updates

The provider card offers **Update**, which runs `agy update`. Antigravity ships a downloaded binary rather than a package Ronin can query, so the card cannot tell you in advance that a new version is waiting — run the update when you want to pick one up. See [Updating](./updating.md).

## Skills

Antigravity reads workspace customizations from `.agents/` at your repository root and machine-local ones from `~/.gemini/config/`. Skills in those places show up in Ronin's skills list for this provider.

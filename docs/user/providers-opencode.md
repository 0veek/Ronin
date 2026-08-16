# OpenCode

OpenCode is an open-source coding agent that brings its own upstream model providers. Ronin runs
its server and streams the conversation into the thread. For first-time setup, see
[Install Ronin](./install.md).

## Install

Install [OpenCode](https://opencode.ai) so `opencode` is on your PATH, then connect at least one
upstream provider:

```bash
opencode auth login
```

Ronin needs OpenCode `1.14.19` or newer; older versions are reported on the provider card. In
Settings, the provider card can stay like this:

```text
Display name: OpenCode
Binary path: opencode
```

## Upstream providers

OpenCode is the one provider whose card is about _other_ providers. It reports how many upstream
providers are connected, and the card stays on **Needs attention** while that count is zero —
OpenCode itself is installed and running, but no model can answer yet. Run `opencode auth login`
for each provider you want, then refresh.

Model slugs are namespaced by their upstream, like `openai/gpt-5`, and the list comes from
OpenCode's own catalog. Switching model applies to the next message in the same conversation.

## Updates

Ronin checks the `opencode-ai` package for new versions and offers **Update** on the provider card.
Which command it runs follows how you installed it — the native `opencode upgrade`, Homebrew, or
your package manager's global install. See [Updating](./updating.md).

## Skills

OpenCode reads skills from `~/.config/opencode/skills` and from `.opencode/` at your repository
root. Skills in those places show up in Ronin's skills list for this provider.

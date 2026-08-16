# Cursor

Cursor Agent is Anysphere's coding-agent CLI. Ronin talks to it over ACP and streams the
conversation into the thread. For first-time setup, see [Install Ronin](./install.md).

## Install

Install the [Cursor CLI](https://cursor.com/cli), which provides the `cursor-agent` binary Ronin
looks for. Authenticate with a different command name:

```bash
agent login
```

That mismatch — install `cursor-agent`, log in with `agent` — is the one thing worth remembering
about Cursor. Run the login on the machine running the Ronin server, not the device you browse
from. In Settings, the provider card can stay like this:

```text
Display name: Cursor
Binary path: cursor-agent
```

The card names the account it found — **Authenticated · &lt;plan&gt;** with the signed-in email. If it
reads **Not authenticated**, run `agent login` and refresh the provider.

## Models

The model list comes from Cursor itself, so it follows what your account can reach rather than a
list Ronin ships. Models that support them also carry their own reasoning, context-window, and fast
toggles, which appear beside the model in the picker.

Switching model applies to the next message in the same conversation.

## Access

Cursor supports Ronin's interaction modes, so a thread can be put in Plan mode without restarting
it. See [Permission modes](./permission-modes.md).

## Updates

The provider card offers **Update**, which runs `cursor-agent update`. Cursor ships a downloaded
binary rather than a package Ronin can query, so the card cannot tell you in advance that a new
version is waiting. See [Updating](./updating.md).

## Skills

Cursor reads skills from `~/.cursor/skills-cursor` and `~/.cursor/skills`, and from `.cursor/` at
your repository root. Skills in those places show up in Ronin's skills list for this provider.

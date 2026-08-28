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

## Server authentication

Without a server URL, Ronin starts a local OpenCode server. The process inherits
`OPENCODE_SERVER_PASSWORD` from the environment. A password in the provider settings overrides that
environment value for both the local process and Ronin.

With a server URL, Ronin connects to that external server and uses only the password in the
provider settings. It does not send a local `OPENCODE_SERVER_PASSWORD` to an external server.
OpenCode uses this password for HTTP Basic authentication.

Ronin uses the OpenCode setup on the connected environment. With a remote environment, its OpenCode
login and configuration apply, not the setup on the machine you are sitting at.

## Refresh the model list

Ronin loads the model list when an enabled OpenCode provider starts and keeps the list in its
cache. Reconnecting a client or using a refresh control asks OpenCode for the list again. The
periodic provider health setting does not refresh OpenCode's catalog.

After changing an OpenCode login or configuration outside Ronin, open **Settings** →
**Providers**, select the environment, and choose **Refresh provider status**. Changing the
provider's configuration in Ronin also replaces that provider connection.

OpenCode reads credential changes on each model-list request. Native OpenCode configuration files
can stay cached while the local helper is running. The helper closes after 30 seconds with no
model-list or text-generation work. Refresh after that idle period to start a new helper and read
the file changes. Repeated refreshes or active helper work can extend this wait.

Ronin does not own an external OpenCode server. Native configuration changes on that server can
require its own reload or restart before a refresh returns the new list.

If a refresh fails, Ronin keeps the last known models, slash commands, and skills. Fix the
connection, then refresh again. A successful refresh can remove entries that OpenCode no longer
offers.

## Continue an existing thread

An existing thread keeps its selected model and options when that model is temporarily absent from
the catalog. The model picker shows an **Unavailable** row and keeps saved option values visible
until the model metadata returns. Ronin does not switch the thread to the first model in the list.

The stored selection does not guarantee that OpenCode can still run the model. If the provider
rejects it, select an available model before trying again.

## Permission modes

**Auto-accept edits** lets OpenCode apply file changes without asking and keeps every other gate
up, so commands, web access and work outside the workspace still stop for approval. OpenCode has
no equivalent of **Auto**, so that mode asks like **Supervised**. See
[Permission modes](./permission-modes.md).

## Updates

Ronin checks the `opencode-ai` package for new versions and offers **Update** on the provider card.
Which command it runs follows how you installed it — the native `opencode upgrade`, Homebrew, or
your package manager's global install. See [Updating](./updating.md).

## Skills

OpenCode reads skills from `~/.config/opencode/skills` and from `.opencode/` at your repository
root. Skills in those places show up in Ronin's skills list for this provider.

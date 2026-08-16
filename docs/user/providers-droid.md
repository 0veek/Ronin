# Droid

Droid is Factory's coding agent. Ronin talks to it over ACP with `droid exec --output-format acp`.

## Install

Install the Factory Droid CLI so `droid` is on your PATH. Authenticate locally:

```bash
droid
```

Or set `FACTORY_API_KEY`. In Settings, the provider card can stay like this:

```text
Display name: Droid
Binary path: droid
```

Turn the provider on, then pick **Droid** in the model picker. The live model list comes from Droid's ACP session.

Switching model applies to the next message in the same conversation, and a thread can be handed to Droid from another provider or away from it.

## Updates

Droid ships as the `droid` npm package, so Ronin checks for new versions and offers **Update** on the provider card. See [Updating](./updating.md).

## Skills

Droid reads skills from `~/.factory/skills` and from `.factory/` at your repository root. Skills in those places show up in Ronin's skills list for this provider.

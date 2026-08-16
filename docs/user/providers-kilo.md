# Kilo

Kilo speaks the same server API as OpenCode. Ronin reuses that runtime with Kilo's `kilo` binary and `kilo server listening` startup line.

## Install

Install the Kilo CLI so `kilo` is on your PATH. In Settings, the provider card can stay like this:

```text
Display name: Kilo
Binary path: kilo
Server URL: empty
```

Leave the server URL blank so Ronin starts a local Kilo server when you open a thread. Set a URL only if you already have a Kilo server running.

## Updates

Kilo ships as the `@kilocode/cli` package, so Ronin checks for new versions and offers **Update** on the provider card. See [Updating](./updating.md).

## Skills

Kilo reads skills from `~/.kilo/skills` and from `.kilo/` at your repository root. Skills in those places show up in Ronin's skills list for this provider.

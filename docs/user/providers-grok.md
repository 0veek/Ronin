# Grok

Grok Build is xAI's coding-agent CLI (`grok`). Ronin runs it as an agent process and streams the
conversation into the thread. For first-time setup, see [Install Ronin](./install.md).

## Install

Install the [Grok Build CLI](https://x.ai/cli) so `grok` is on your PATH, then sign in on the
machine running the Ronin server:

```bash
grok login
```

An `XAI_API_KEY` in the server's environment works instead of a login. In Settings, the provider
card can stay like this:

```text
Display name: Grok
Binary path: grok
```

Turn the provider on, then pick **Grok** in the model picker.

The provider card names which credential it found — **Authenticated · CLI login** or
**Authenticated · API key**. If it reads **Not authenticated**, run `grok login` and refresh the
provider; Grok cannot sign in from inside Ronin, because its login opens a browser.

## Models

The model list comes from the CLI itself, so it follows whatever your installed Grok Build offers
rather than a list Ronin ships. Each model brings its own reasoning-effort menu — Grok 4.6 offers
Extra High, Grok 4.5 does not.

A custom model has to be an id Grok Build knows. Retired ids keep working: a thread saved against
`grok-build` or `grok-4.3` resolves forward to the current model instead of silently running
something else.

## Changing model and reasoning effort mid-thread

Changing the **model** applies to the next message in the same conversation — nothing restarts and
nothing is lost.

Changing the **reasoning effort** restarts Grok, because the CLI reads that setting once when the
process starts. Ronin hands the new process the conversation it was already having, so the thread
continues; expect the next reply to take a moment longer to begin.

## Updates

Grok Build ships as a global npm package, so Ronin checks for new versions and offers **Update**
on the provider card like it does for Codex and Claude. See [Updating](./updating.md).

## Skills

Ronin asks the CLI for its own skill catalog rather than scanning folders, so the `$` picker shows
exactly what Grok would run: skills from `~/.grok/skills` and from `.grok/` at your repository
root, plus installed plugin skills, and with anything you have disabled in Grok's own settings left
out. Skills Grok marks as not user-invocable are listed but cannot be picked.

An older Grok Build that cannot report its catalog simply contributes no skills. Nothing else about
the provider changes.

## Permission modes

Ronin puts the thread's permission mode on Grok's command line, so a thread behaves the way its
mode reads even if your own Grok config is set to approve everything. **Supervised** asks,
**Auto-accept edits** accepts edits, **Auto** runs Grok's own auto mode, and **Full access** starts
Grok with always-approve.

On an approval, **Always allow this session** remembers that one command or tool input for the rest
of the session. Anything else still asks. It is not a shortcut to **Full access**.

## Usage

Grok reports the exact cost of every turn, so the Stats page shows its spend as measured rather
than estimated. Totals come from the session records Grok writes to disk, so a turn that never
finished writing one does not appear. See [Usage](./usage.md).

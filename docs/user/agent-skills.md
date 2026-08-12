# Agent skills

Skills are reusable `SKILL.md` workflows. Ronin discovers them from every configured provider and from a portable folder that works across providers.

## Portable skills

Put a folder containing `SKILL.md` in `~/.ronin/skills`. Those skills show up for every provider. If Codex, Claude, or another provider already has a skill with the same name, that native copy is used and Ronin's copy is the fallback.

Open **Settings → Agent skills** to see every discovered skill, where it came from, and whether it is enabled. Turning a skill off hides it from the `/` and `$` pickers. Restore defaults re-enables every skill.

## Using a skill

Type `/` or `$` in the composer and pick a skill. Ronin inserts `$name`. Providers that understand that skill natively load it themselves. For everyone else, Ronin inlines the skill instructions into the turn so the agent still follows them.

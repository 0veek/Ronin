---
name: ponytail-help
description: Quick-reference card for all ponytail modes, skills, and commands. One-shot display, not a persistent mode. Trigger: /ponytail-help, "ponytail help", "what ponytail commands", "how do I use ponytail".
---

# Ponytail Help

Display this reference card when invoked. One-shot, do NOT change mode,
write flag files, or persist anything.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | `/ponytail lite` | Build what's asked, name the lazier alternative in one line. |
| **Full** | `/ponytail` | The ladder enforced: YAGNI → stdlib → native → one line → minimum. Default. |
| **Ultra** | `/ponytail ultra` | YAGNI extremist. Deletion before addition. Challenges requirements before building. |

Level sticks until changed or the thread ends.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | `/ponytail` | Lazy mode itself. Simplest solution that works. |
| **ponytail-review** | `/ponytail-review` | Over-engineering review: `L42: yagni: factory, one product. Inline.` |
| **ponytail-audit** | `/ponytail-audit` | Whole-repo over-engineering audit: ranked list of what to delete. |
| **ponytail-debt** | `/ponytail-debt` | Harvest `ponytail:` shortcut comments into a tracked ledger. |
| **ponytail-gain** | `/ponytail-gain` | Measured-impact scoreboard: less code, less cost, more speed. |
| **ponytail-help** | `/ponytail-help` | This card. |

Ronin ships all six. Name one as `$ponytail` or `/ponytail` in the composer and
it works the same on every provider.

## Deactivate

Say "stop ponytail" or "normal mode". Resume anytime with `/ponytail`.
`/ponytail off` also works.

## In Ronin

Ponytail ships with Ronin, so there is nothing to install and no default mode
to configure. It never activates on its own: a skill runs only for the message
that names it, so lazy mode starts at `/ponytail` and lasts as long as the
thread keeps it. Turn the pack off entirely in **Settings → Agent skills**.

Upstream ponytail also ships as a standalone plugin with a persistent default
mode and a status badge. That is a separate install, outside Ronin.

## More

Full docs + examples: https://github.com/DietrichGebert/ponytail

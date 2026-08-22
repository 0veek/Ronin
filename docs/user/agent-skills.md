# Agent skills

Skills are reusable `SKILL.md` workflows. Ronin discovers them from every configured provider, from a portable folder that works across providers, and from the skills Ronin ships with.

## Portable skills

Put a folder containing `SKILL.md` in `~/.ronin/skills`. Those skills show up for every provider. If Codex, Claude, or another provider already has a skill with the same name, that native copy is used and Ronin's copy is the fallback.

Open **Settings → Agent skills** to see every discovered skill, where it came from, and whether it is enabled. Turning a skill off hides it from the `/` and `$` pickers and prevents Ronin from loading it into a turn. Restore defaults re-enables every skill.

## Built-in skills

Ronin ships with [Matt Pocock's skills](https://github.com/mattpocock/skills): engineering workflows such as `tdd`, `implement`, `triage`, `to-spec`, and `diagnosing-bugs`, plus thinking-and-writing skills such as `grilling`, `handoff`, and `teach`. They are enabled out of the box and work on every provider.

Ronin also ships [ponytail](https://github.com/DietrichGebert/ponytail), which puts a lazy senior developer in the chair: `$ponytail` makes the agent reach for the standard library and the platform before it writes anything custom, at `lite`, `full`, or `ultra` intensity. `$ponytail-review` and `$ponytail-audit` hunt over-engineering in a diff or across the repo, `$ponytail-debt` collects the shortcuts it left behind, and `$ponytail-help` is the reference card. Like every built-in, it stays out of the way until you name it — the agent does not get lazy on its own.

They sit at the bottom of **Settings → Agent skills** under **Built-in skills**, where each has its own switch and the section header can turn the whole set on or off. Built-ins have the lowest precedence: if you keep your own `tdd` in `~/.ronin/skills`, or your provider ships one, yours is the copy that runs.

Several built-ins are named after everyday words, so they only run when you name them as `$tdd` or `/tdd`. Writing "implement the login form" does not pull in the `implement` skill; `$implement the login form` does. Skills you installed yourself keep the looser match, where naming the skill in a sentence is enough.

Run `/setup-ronin-skills` once in a project to tell those skills which issue tracker you use, which labels you triage with, and where to save the documents they produce. When you are not sure which one fits the job in front of you, ask `$ask-ronin` — it routes between the rest.

## Using a skill

Type `/` or `$` in the composer and pick a skill. Ronin inserts `$name`. You can also name a skill directly, such as “run t3-sync skill.” Ronin resolves the enabled skill for the active project and provider instance, then supplies its instructions to providers that cannot load that copy natively. Portable skills therefore behave the same when you switch providers.

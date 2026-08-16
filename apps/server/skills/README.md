# Built-in skills

Skill packs Ronin ships with. Every folder here is a namespace holding one
directory per skill, exactly as an agent expects to find it: a `SKILL.md` with
YAML frontmatter plus whatever supporting files that skill references.

Discovery treats this tree as the lowest-precedence skill root, so a skill a
user drops in `~/.ronin/skills`, or one a provider already ships natively, wins
over the built-in copy of the same name. Every built-in skill is enabled out of
the box and can be turned off per skill in **Settings → Agent skills**.

`vp run --filter t3 build` copies this tree to `apps/server/dist/skills`, which
is what ships in the npm package and inside the desktop app.

## Packs

| Pack         | Source                                                                           | License |
| ------------ | -------------------------------------------------------------------------------- | ------- |
| `mattpocock` | [mattpocock/skills](https://github.com/mattpocock/skills) `068b6e0` (2026-08-15) | MIT     |

## Local changes

Packs are otherwise copied verbatim, so anything we change upstream's copy of is
listed here and has to be reapplied after a refresh:

- `mattpocock/ask-ronin` is upstream's `ask-matt`, renamed in its folder name,
  its `name:` frontmatter, its `# Ask Ronin` heading, and the `display_name` in
  `agents/openai.yaml`. It routes between the built-in skills, so it answers as
  the app the user is in.
- `mattpocock/setup-ronin-skills` is upstream's `setup-matt-pocock-skills`,
  renamed in the same four places. Six other skills tell the user to run it when
  a repo has no tracker configured, so the rename also has to be reapplied to
  every `/setup-ronin-skills` mention across the pack.

## Updating a vendored pack

Vendored packs are copied verbatim so upstream fixes stay a re-copy rather than
a merge. To refresh one:

1. Clone upstream at the tag or commit you want.
2. Replace the pack directory with the upstream skill folders (`mattpocock`
   flattens upstream's `skills/engineering` and `skills/productivity` into one
   namespace — discovery only walks two levels deep).
3. Keep the upstream `LICENSE` next to the skills.
4. Reapply everything under **Local changes** above.
5. Update the commit in the table above.
6. Run `vp test run apps/server/src/provider/bundledSkills.test.ts` — it fails
   on missing frontmatter, duplicate names, a name that disagrees with its
   folder, or a local rename that a refresh dropped.

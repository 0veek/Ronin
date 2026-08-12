# Slash commands

Type `/` in the composer to browse built-in commands, provider skills, and the selected provider's own commands.

## Built-in

- `/clear` starts a fresh thread in the current project.
- `/compact` asks the current provider to free context, or tells you when it already does that automatically.
- `/model` opens the model picker for this thread.
- `/plan` and `/default` switch plan mode when that beta setting is on.
- `/review` drafts a review prompt for uncommitted changes or the branch diff. You can also send `/review base` or `/review focus on auth`.
- `/fork` starts a new thread in the same project. Choose the current checkout or a new worktree, or send `/fork local` / `/fork worktree`.
- `/side` starts a parallel thread in the same project.
- `/status` shows this thread's context window and the environment's subscription quota.

If the selected provider already owns a command of the same name, Ronin leaves that native command alone. Claude's `/status` and `/clear` keep their provider meaning.

## Skills

Provider skills appear under **Skills** in the `/` menu. You can still insert a skill with `$name`. Manage portable skills and enable/disable them from [Agent skills](./agent-skills.md).

## Provider commands

Commands the selected provider reports stay in the **Provider** group and send as ordinary `/name` text.

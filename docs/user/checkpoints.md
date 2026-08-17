# Checkpoints and restoring

Every turn ends with a checkpoint: a snapshot of your working tree stored as a hidden Git ref.
Checkpoints are what let Ronin show you the diff for a turn, and what let you put the workspace
back the way it was before an agent went the wrong way.

Checkpoints do not touch your branch, your commits, or your staged changes. They live outside the
normal Git history, so nothing an agent does shows up in `git log` until you commit it yourself.

## Restoring a turn

Restoring rewinds two things at once: the files on disk go back to the checkpoint, and the
conversation is rolled back so the agent's own memory matches what it can see. Checkpoints from
later turns are dropped, because the work they described no longer exists.

## What restoring throws away

Restoring makes the working tree match the checkpoint exactly. Files you or an agent created after
that point are not in the checkpoint, so they are removed.

That work is not lost. Immediately before restoring, Ronin saves the current state of the
workspace so it can be recovered:

```bash
# See what was saved, for the thread you restored
git show refs/t3/checkpoints/<thread>/revert-undo --stat

# Read one file back
git show refs/t3/checkpoints/<thread>/revert-undo:path/to/file

# Put the whole workspace back as it was before the restore
git restore --source refs/t3/checkpoints/<thread>/revert-undo --worktree -- .
```

Copy the thread ID from the thread's menu (**Copy thread ID**) to find the ref for a specific
thread, or list them all with `git for-each-ref refs/t3/checkpoints`.

Each thread keeps one of these. Restoring the same thread again replaces it, so recover before you
restore that thread a second time.

Files ignored by Git — `node_modules`, build output, `.env` — are neither captured by checkpoints
nor removed by restoring. They are left exactly as they are.

## Requirements

Checkpoints need a Git repository. Projects that are not Git repositories run normally but have no
checkpoints, no per-turn diffs, and no restore.

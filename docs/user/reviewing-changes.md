# Reviewing changes

The diff panel is where you read what an agent did and decide what to keep. It shows one scope at a
time, picked from the menu at the top left.

## Scopes

- **Working tree** — everything you have not committed yet, staged or not. This is the default
  reading of "what changed".
- **Staged** — only what the next commit would take.
- **Branch changes** — your branch compared against its base. Pick a different base from the
  selector beside the scope menu.
- **Latest turn** or a specific **Turn** — the checkpoint diff for one turn of the conversation. See
  [Checkpoints and restoring](./checkpoints.md).

## Keeping some changes and dropping others

An agent usually touches a file in several places, and you rarely want all of it or none of it.
Hover any line in **Working tree** and a small pill appears in the gutter:

- **Comment** — start a review comment on the line or on the range you selected. Unchanged.
- **Stage hunk** — put just that block of changes in the index.
- **Revert hunk** — throw that block away, in both the index and the working tree.

The same actions sit next to the filename in each file's header, where they act on the whole file.
Reverting a whole file asks first; reverting a single hunk does not, because you were already
pointing at it.

In the **Staged** scope, the pill offers **Unstage hunk** instead, and the file header offers
**Unstage file**.

Two kinds of file have no hunk actions, on purpose:

- **Binary files**, which have no text hunks to slice.
- **Files Git is not tracking yet.** They have no committed version to fall back on, so reverting
  one would delete work outright. Use the file list in the commit dialog to decide whether a new
  file goes in.

If the file changed underneath you between the diff being drawn and the action being run, nothing is
applied and Ronin says the diff moved on. Refresh and try again.

## What a commit takes

If anything is staged, committing takes exactly that and leaves the rest of your work in the working
tree — the same thing `git commit` does in a terminal. The commit dialog says so when it applies.

If nothing is staged, committing takes everything, which is the usual case. Picking specific files
in the commit dialog still overrides both: those files are what gets committed.

# Getting a second opinion

You hold subscriptions to more than one coding agent. That is the whole reason Ronin exists, and it
means you can ask a question Ronin is uniquely able to answer: _what would the other one have done?_

Write your prompt in the composer. A **compare** button appears next to the mic as soon as there is
something to send — press it, pick the models you want to hear from, and press **Compare**. Each one
answers the same prompt in its own thread, and each thread gets its own worktree.

The button is only there while the composer has text, because an empty composer has nothing to
compare. The command palette (**Get a second opinion**) does the same thing if you prefer the
keyboard.

## Why worktrees

Two agents editing one checkout produce a blend of two attempts and prove nothing about either. So
every entrant gets its own checkout, cut from the branch you had selected, with the project's setup
script run in it. Their edits never touch each other or the tree you are working in.

That is also why a comparison is only offered where a worktree can be made: pick a base branch
first, and Ronin will cut the rest.

## Reading the answers

Every racing thread carries a row of chips above its transcript — one per entrant, with a status
dot and the model's name. Click one to read that answer instead. The thread you already know how to
read _is_ the comparison surface; there is no separate screen to learn.

From any entrant you can open its diff, replay its turn, or keep reading. The threads are ordinary
threads in every other respect.

## Picking a winner

There is no "winner" button, on purpose. Keeping an answer means doing what you would do with any
thread you like: open its diff, commit from it, or open a pull request. The others stay where they
are until you settle or delete them, because a comparison you cannot go back and re-read is not
worth having run.

Deleting an entrant does not affect its rivals — they are grouped, not nested, and no entrant is
the original.

## Limits

- Between two and four models per comparison. Each entrant is a real agent burning a real
  subscription window, and past a handful the results stop being readable anyway.
- One model per entrant. The same model twice tells you nothing; the same model on two different
  provider instances is a fair race and is allowed.
- Entrants start one after another rather than all at once, because each one cuts a git worktree in
  your repository and firing several at the same `.git` at once is how you get lock contention.

## Binding a key

Comparison has no default shortcut. Bind one in **Settings → Keybindings** — search for
**Chat: Second Opinion**. From the keyboard it uses whatever is in the composer, the same as the
button.

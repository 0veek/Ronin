# Since you last looked

Agents run while you do not watch them — overnight, on a schedule, in four worktrees at once. The
sidebar and the [board](board.md) both answer _what is everything doing right now_. Neither answers
the question you actually have when you sit back down: **what changed, and what is stuck?**

Open **Since you last looked** from the command palette.

## What it tells you

Three lists, in the order you can act on them:

- **Waiting on you** — threads that stopped and cannot go on without you, longest-waiting first,
  each showing how long it has been sitting there. This is the only part nothing else will resolve.
- **Still working** — agents currently running, so you know whether to wait or to go get coffee.
- **Finished** — turns that completed since your last digest, newest first. News rather than work.

A thread appears in exactly one list. One that finished a turn and then raised its hand is news for
one reason only — that it is waiting — so it is filed under **Waiting on you** and the counts stay
honest.

Archived threads are left out. You already filed them away.

Click any row to go straight to that thread.

## The mark

A digest reports from the last time you read one _on this device_. That mark is per-device and not
synced: the phone in your pocket last looked at a different time than the machine on your desk, and
the digest is only useful if it answers for the device asking.

It advances when you **close** the digest, not when you open it — a digest glanced at and dismissed
still reports the same news next time, so nothing you meant to come back to disappears because a
dialog flashed past.

On a device that has never opened one, the digest reports from when the app started rather than
from the beginning of history.

## Binding a key

No default shortcut. Bind one in **Settings → Keybindings** — search for **Digest: Show**.

## Related

For a recurring _prompt_ rather than a summary — "every weekday at 09:00, triage the open PRs" —
you want an [automation](automations.md) instead. The digest reports on Ronin's own state; an
automation puts an agent to work.

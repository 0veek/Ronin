# Automations

An automation is a saved prompt plus a rule for when to send it. When it fires, it opens an ordinary
thread in the project and starts an ordinary turn — so everything you already know about threads
applies to it: the sidebar, checkpoints, diffs, switching provider mid-thread, all of it.

Manage them in **Settings → Automations**.

## Creating one

Each automation needs a name, a project, a prompt, and a schedule.

**Repeats** offers three shapes:

| Shape            | Means                                                                  |
| ---------------- | ---------------------------------------------------------------------- |
| At a time of day | Runs at a wall-clock time on the days you pick. No day picked = daily. |
| On an interval   | Runs every N minutes, counted from the last run. Minimum 15 minutes.   |
| Once             | Runs a single time, then pauses itself.                                |

Times are the machine's local time, so "every weekday at 09:00" stays at nine through a
daylight-saving change rather than drifting an hour.

**Runs in** decides where the work lands:

- **A new worktree** (the default) gives each run its own checkout. Unattended edits never touch the
  tree you are working in.
- **The current checkout** runs in the project directory itself. Use it for read-only work —
  summaries, triage, reports.

## Watching them

Each row shows its schedule in words and when it goes next. The switch pauses an automation without
deleting it; the play button runs it immediately (which also re-anchors an interval schedule from
now).

**Recent runs** below lists what actually happened, newest first, with a link into the thread each
run opened. A run that did not start says why.

## What it does when nobody is home

- **A run the machine slept through still happens**, as long as it is less than two hours late. That
  is what makes a morning job worth setting.
- **A run more than two hours late is skipped**, and the skip is logged. A laptop that was shut for a
  week comes back and runs the next scheduled job, not every one it missed.
- **A late interval fires once, not once per missed window.** Coming back from a suspend does not
  produce a queue of stale runs.
- **Automations stop when Ronin stops.** They are not a system cron; the app has to be running.
- **Three strikes on the same thread.** Unrelated to automations, but worth knowing: a run that hits
  a spent quota window is queued by
  [resume after a limit resets](./quota-resume.md) like any other turn.

## Turning it off

Pausing keeps the automation and its history. Deleting removes both, and does not touch any threads
it already created.

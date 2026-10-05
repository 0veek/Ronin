# Automations

An automation is a saved prompt plus a rule for when to send it. When it fires, it opens an ordinary
thread in the project and starts an ordinary turn — so everything you already know about threads
applies to it: the sidebar, checkpoints, diffs, switching provider mid-thread, all of it.

Manage them in **Settings → Automations**.

Use **Machine** to manage automations on any connected environment, including machines reached
over your local network, Tailscale, or SSH. The project picker, available models, schedules, and
recent runs all belong to the selected machine. Opening **New automation** from a thread or the
command palette selects that thread's machine and project.

Save or cancel an open draft before switching machines. A disconnected machine keeps running its
saved schedules while its server is running; reconnect to change them. A connection with read-only
access can show schedules and history but cannot create, change, or run them.

## Starting from a recipe

Choose a recipe to open an editable draft with a prompt and suggested schedule:

| Recipe            | Suggested schedule | Work                                                                           |
| ----------------- | ------------------ | ------------------------------------------------------------------------------ |
| Morning brief     | Weekdays at 09:00  | Summarize recent changes, risks, and next steps in the current checkout.       |
| Regression patrol | Weekdays at 16:00  | Investigate recent changes and fix one evidenced regression in a new worktree. |
| Test gap finder   | Mondays at 10:00   | Add meaningful coverage for one behavior in a new worktree.                    |
| Weekly changelog  | Fridays at 16:00   | Write a readable update from the week's commits in the current checkout.       |

You can also choose a recipe in an empty **New automation** draft. Customize the prompt, project,
model, and schedule before saving. Choosing a recipe does not save or run it; **Save automation**
enables its schedule. The brief and changelog prompts ask the agent to keep the checkout read-only;
they use the same permissions as an ordinary automation.

## Creating one

Each automation needs a name, a project, a prompt, and a schedule. You can start one from
**Settings → Automations**, from the clock in a thread's title bar, or from the command
palette (**New automation**).

Opening **New automation** again on the same machine keeps your current draft. Finish or cancel
that draft before starting another. Names can contain up to 120 characters and prompts up to
20,000 characters.

**Model** chooses which provider and model runs the prompt. The default is the project's
default — the same one a new thread would use. Pin a specific model when the job should
keep that provider even if the project default later changes.
If the project has no default model, choose a model before saving. An unavailable pinned provider
stays visible as unavailable; choosing another model or **Use project default** changes the selection.

**Repeats** offers three shapes:

| Shape            | Means                                                                  |
| ---------------- | ---------------------------------------------------------------------- |
| At a time of day | Runs at a wall-clock time on the days you pick. No day picked = daily. |
| On an interval   | Runs every N minutes, counted from the last run. Minimum 15 minutes.   |
| Once             | Runs a single time, then pauses itself.                                |

Times are the machine's local time, so "every weekday at 09:00" stays at nine through a
daylight-saving change rather than drifting an hour.

A one-time schedule shows the date and time on the device you are using. Editing its name or
prompt keeps the scheduled instant, including when you edit from another time zone.

**On failure** decides how many times a run can fail to start before the schedule pauses
itself. The default is three; you can stop after one, after five, or keep retrying. A
successful start resets the count. Hitting the limit turns the automation off and says why
— turning the switch back on is the only way out, and a manual rerun keeps that evidence
until you do.

**Runs in** decides where the work lands:

- **A new worktree** (the default) gives each run its own checkout. Unattended edits never touch the
  tree you are working in.
- **The current checkout** runs in the project directory itself. Use it for read-only work —
  summaries, triage, reports.

## Watching them

Each row shows its schedule in words and when it goes next. A row that hit its failure
limit says so instead of "Paused". The switch pauses an automation without deleting it; the
play button runs it immediately (which also re-anchors an interval schedule from now).
While a row action is pending, its controls wait for the response so repeated clicks cannot start
extra runs or conflict with an edit. Other automations remain available.

**Recent runs** below lists what actually happened, newest first, with a link into the thread each
run opened. A run that did not start says why.

## Reusing an automation

The **Duplicate** button opens a new draft with the same prompt, schedule, model, work location, and
failure policy. Give it a new name or choose another project on the same machine before saving.
The original automation and its history stay as they are. A copied one-time automation requires
a new date and time, so an old scheduled instant cannot accidentally run again.

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

If a run is being prepared, pausing or deleting waits for that preparation to finish. Your change
then takes effect for future runs. A failed save leaves your draft open so you can retry.

# Build systems

A build system is a team you define for a project: one model leads, the others take roles.
It is not the default way a thread works. You create a team, then launch it on a task when
you want several providers on the same problem.

Manage them in **Settings → Build systems**.

## Creating one

Each team needs a name, a project, a lead model, and any teammates you want. You can start
one from **Settings → Build systems** or from the command palette (**New build system**).

**Orchestrator** is the lead. It does not edit files. It decides what happens next, hands a
piece of work to a teammate, reads what came back, and either delegates again, asks you a
question, or finishes.

**Teammates** are roles. Each has a name (the lead delegates by that name), a model, optional
standing instructions, and an optional **Ask first** gate. A gated role pauses the run until
you approve or decline the task.

A team can have up to six teammates. Two roles cannot share a name.

## Running one

**Run a build system** from the command palette, from Settings, or from its keyboard shortcut
if you have bound one. Pick the team and write the task.

The lead opens an ordinary thread. Each teammate gets its own thread the first time it is
asked to work, in the same worktree as the lead, so a file one of them writes is a file the
next one sees. Only one agent runs at a time.

A bar above the transcript names every role. Click a chip to jump to that thread. Cancel
stops the run; the threads stay, and you can keep talking to them as ordinary threads.

While a run is active the composer on those threads is locked. Cancel if you want to take
over.

## When it needs you

- **Ask first.** A gated role was requested. Approve to let it start, or decline with a
  note the lead will read.
- **The team needs an answer.** The lead asked a question it cannot decide. Reply, and it
  continues.

A run waiting on you also surfaces the lead thread in the sidebar's needs-you list.

## What stops a run

- The lead declares the work done.
- You cancel it.
- The lead fails to produce a usable next step after two reminders.
- A teammate fails twice in a row.
- The team hits its delegation cap (twenty by default; you can raise it).
- The app restarts while a model is still working — that run is marked failed rather than
  left half-watched.

Deleting a team is blocked while it still has a live run. Cancel first. Deleting a team
does not delete its threads or its run history.

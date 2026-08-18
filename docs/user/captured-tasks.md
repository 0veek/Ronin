# Captured tasks

Agents finish turns with work they noticed but did not do. "The legacy shim could go now." "These
two helpers want merging." It is a real task, and by the next turn it has scrolled away.

**Select the sentence and press Capture.** Ronin files it as a task in the same project and leaves
you exactly where you were reading.

Three ways in, all the same verb:

| Way                                   | Captures                          |
| ------------------------------------- | --------------------------------- |
| Select text → **Capture** on the chip | the passage you selected          |
| Command palette → "Capture as task"   | the selection, or the last answer |
| Your own shortcut (see below)         | the selection, or the last answer |

A capture never navigates. The toast confirms what was filed and offers **Open** for the times you
did mean to go there now.

## Where it lands

A captured task is an ordinary thread that has not run yet, so it appears:

- in the **Draft** lane of the [board](board.md), marked to show it is loaded and ready, rather
  than an empty thread someone opened and abandoned
- in the sidebar, under its project
- on **every device you are connected from** — the task lives on the thread, not in one client's
  local drafts, so capturing at your desk puts it on your phone too

Its title is the first line of what you captured, so the board reads as a list of things to do.

## Running one

Open it and the captured text is already in the composer. Edit it, add to it, pick a different
model — it is a normal thread from here. Press enter and it runs like any other turn.

The task starts with no checkout of its own. Whichever branch or worktree the passage came from may
well be gone by the time you get to it, so the thread picks up the project's default when it
actually runs rather than pointing at a stale tree.

Once you send, the captured prompt is spent: the transcript is the record from then on, and the
thread stops being a task and starts being a conversation.

## Throwing one away

Right-click the thread — in the sidebar or from the chat header menu — and choose **Discard
captured task**. That clears the prompt and leaves the thread, which by then may have a name and a
place on the board worth keeping. To get rid of both, delete the thread as usual.

## Binding a key

Capture has no default shortcut, because the obvious ones are already taken by browsers and would
break for anyone reaching Ronin over the network. Bind your own in **Settings → Keybindings** —
search for **Chat: Capture Task**.

With a shortcut bound, a live selection wins; press it with nothing selected and Ronin captures the
most recent finished answer, which is usually the one you just read.

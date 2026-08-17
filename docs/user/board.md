# Board

The board shows every thread laid out by what it is doing right now. Open it from the board icon
in the sidebar footer, from the command palette, or with `mod+shift+b`.

It reads the same threads as the sidebar and applies the same rules, so the two never disagree.
The board is the wide view: six lanes side by side instead of one column, and you move work
between them by dragging.

## The lanes

- **Draft** — threads you created but never ran.
- **Up Next** — open work you have not settled yet. Most threads live here between turns.
- **Working** — an agent is running, or background work is still alive after the turn finished.
- **Needs You** — the agent has stopped and cannot go on without you: waiting for approval, waiting
  on an answer, or stopped by an error. Listed longest-waiting first, like the sidebar's needs-you
  block.
- **Snoozed** — threads hidden until their wake time, ordered by when they come back.
- **Done** — settled threads.

Pinned threads float to the top of whichever lane they are in, carrying a pin badge, and keep the
order you arranged in the sidebar.

Collapse any lane with the chevron in its header. Collapsed lanes, the project filter, and the
Draft lane's manual order are remembered.

## Dragging a card

A drag runs a real command, so what you do on the board shows up everywhere else, including on your
other connected devices.

- Drop on **Done** to settle a thread. Drag it back out to un-settle it.
- Drop on **Snoozed** to pick a wake time. Drag it out, or drop it anywhere else, to wake it.
- Drop on **Working** to open that thread's chat with the composer ready. The board never sends a
  prompt for you — you press enter.

**Working** and **Needs You** follow the agent, not you: nothing you drag can make an agent start
running or make it blocked. Dropping on **Working** opens the chat instead of pretending the card
will stay put, and **Needs You** declines drops outright.

A lane also declines a drop the thread itself cannot accept right now — you cannot snooze away a
thread that is waiting on your approval, or settle one that is still running. The lane says so
while you drag, rather than failing after you let go.

Settling and snoozing both offer an undo in the toast that follows, however you triggered them.

If an environment's server is older than these features, its threads never land in Snoozed or Done,
and those lanes decline drops from them rather than failing after the fact. Update the Ronin server
in that environment to use them.

## Filtering to one project

The picker above the lanes narrows the board to a single project, and **All projects** brings
everything back. When more than one project is shown, each card names the project it belongs to.

You can open the board already filtered: use the board icon beside a project in the sidebar's
project picker, or **Open board in...** in the command palette.

## Right-click a card

The context menu on a card offers open, settle or un-settle, snooze or wake, and pin or unpin —
the same verbs as the drags, for when you would rather not drag.

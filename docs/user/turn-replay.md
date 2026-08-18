# Replaying a turn

You come back to a thread that ran for twenty minutes while you were away. The transcript shows
everything at once, which is the wrong shape for the question you actually have: _what did it do,
and in what order?_

Open the changed-files card at the end of any turn and press the **replay** button next to
**Open diff**. The turn plays back a step at a time — the prompt, each tool call, the reply — with
the pauses between them marked.

## Reading it

Each row is one step: who acted, what they did, and the time on the turn's own clock. Underneath a
step, `waited 2m 14s` marks a real gap — a test run, a long think — so you can see where the time
actually went rather than guessing from a wall of rows.

- **Play / pause** steps through on its own.
- **Drag the scrubber** to go straight to a moment.
- At the end, the button becomes **replay from the start**.

Playback is not real time. A turn is mostly waiting, and sitting through the real two minutes of a
test run teaches you nothing, so long gaps are compressed while short ones keep their true length.
The rhythm of the turn survives — burst, pause, burst — without the dead air. The clock beside each
step is always the real one.

## What it covers

A replay is built from the turn's own messages and work log, so it shows what Ronin recorded: the
prompt that opened the turn, the tools the agent ran, and its replies. Plans are left out — a plan
is about a turn rather than a step inside one.

Turns with only one recorded step have no order to show, so they offer no replay button.

Nothing is fetched to build a replay. It reads what the client already has, which is why it opens
instantly and works the same over a remote connection.

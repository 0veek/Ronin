# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, Ronin keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

Press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to start it in
the background. Ronin opens another new thread and shows an **Open** action for the thread that
started. The new thread keeps the selected workspace mode and base branch. If **New worktree** is
selected, each background thread creates its own worktree.

## Image attachments

On environments that support direct uploads, images upload as soon as you add them. The send
button becomes available once every upload finishes. A failed upload can be retried or removed.
Older environments still send the image with the message.

## Reading width

**Settings → Appearance → Chat width** sets how wide the transcript and composer grow:
Standard (the default reading column), Wide, or Full window. The command palette's **Cycle
chat width** walks those three in order. You can bind it under **Settings → Keybindings**
(`chat.cycleWidth`).

## Seeing an answer's markdown

Hover a finished answer and the row under it gains a **Show markdown source** button, next to Copy
and Ask on the side. It swaps the rendered answer for the raw markdown the agent actually wrote,
which is what you want when a table came out wrong, a code fence did not close, or you are about to
paste the text somewhere else. Press it again to go back.

The choice is per message and lasts as long as the app is open. Streaming answers do not offer it:
the source of half an answer is a moving target.

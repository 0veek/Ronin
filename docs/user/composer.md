# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, Ronin keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

Press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to start it in
the background. Ronin opens another new thread and shows an **Open** action for the thread that
started. The new thread keeps the selected workspace mode and base branch. If **New worktree** is
selected, each background thread creates its own worktree.

## Attachments

You can attach images up to 10 MB. On environments that support file uploads, you can also attach
videos, text files, PDFs, ZIP archives, and other files. Each file can be up to the limit advertised
by the environment, capped at 50 MB. Each message can contain up to eight attachments in total.
Files upload directly to the environment, where your agent can read, copy, or edit them by their
file path.

Attachments upload as soon as you add them. The send button becomes available once every upload
finishes. A failed upload can be retried or removed. Older environments still send the image with
the message.

Select a video attachment before or after sending to play it with the browser's built-in controls.
Playback depends on the video formats and codecs that the browser supports.

If you reload before a file finishes uploading, the draft keeps the file's name and shows **Attach
again** next to it. Attach the file again or remove it, then send.

HEIC and HEIF photos are converted to JPEG automatically when you drag them into the composer or
paste them into a message.

## Model defaults

T3 Code remembers the last provider, model, and model options you selected and reuses that
selection for new threads. A model configured in a project's settings overrides the remembered
selection for that project; resetting the project setting returns it to the remembered selection.

Model options shown as provider defaults remain display values until you choose them in T3 Code.
T3 Code only sends options you selected explicitly, so an unset reasoning level or service tier can
still come from the provider's own configuration.

## Model defaults

Ronin remembers the last provider, model, and model options you selected and reuses that selection
for new threads. A model configured in a project's settings overrides the remembered selection for
that project; resetting the project setting returns it to the remembered selection.

Model options shown as provider defaults remain display values until you choose them in Ronin.
Ronin only sends options you selected explicitly, so an unset reasoning level or service tier can
still come from the provider's own configuration.

## Quote an assistant response

Select text in an assistant response, then choose **Cite in composer** from the menu that appears
when you release the selection. This inserts an inline quote chip at your cursor and opens an
optional comment bubble beside the selected text; press `Enter` or choose **Save** to attach the
comment, or leave it blank to keep just the quote. You can type before and after the chip, such as a
quote followed by "what do you mean?". A selection must stay within one response and fit in 8,000
characters.

The chip shows your comment when it has one, or a short quote preview otherwise. Use the pencil
button to add or change the comment, and the remove button to delete the quote and its comment from
the draft. Copying, reloading, and restoring a stashed prompt keep each comment with its quote, and
sending tells the agent which words were quoted and which comment you wrote. The quoted text and
comment count toward the message limit.

Select a chip in the composer or a sent message to open the source thread, scroll to the response,
and highlight the quoted passage — including in older history. The highlight pulses, holds for a
moment, then fades on its own; press `Escape` to stop the navigation or clear it early. If the
source is unavailable or its text has changed, the saved quote stays readable and Ronin shows a
warning.

## Changing projects

On web and desktop, changing the project from a new thread keeps the current environment when that
project exists there. If it does not, Ronin selects another environment that has the project.

## Notices above the composer

When more than one notice is waiting, the extras peek out above the front one. Hover over the peek
to reveal them, or focus **Show other notices** with `Tab` and press `Enter` or `Space` to move into
the stack. Press `Escape` to close it and return focus to that control. On a touchscreen, tap the
peek to open the stack. Interacting with the front notice or the composer closes it again.

## Prompt stash

Use the stash shortcut, `mod+s` by default, to stash the current prompt and its attachments
after all file uploads finish. Restore the entry later from the stash menu. Stashes that contain
files must be restored in the environment where those files were uploaded. Stashed files stay
uploaded on the server for 24 hours. If you restore an entry after that, the file comes back with
**Attach again** next to it. Attach the file again or remove it, then send.

## Commands and skills

Type `/` for commands and `$` for skills. A skill token runs the skill wherever it sits in your
message: Ronin sends it to each provider in the form that provider runs, so the text before and
after the token is kept. Skills that only you may start, and never the agent on its own, work the
same way. A skill you switched off in the provider's settings does not appear in either menu.

Provider commands such as `/compact` only run when they open the message, so the `/` menu offers
them only there. Ronin's own commands, such as `/model` and `/plan`, and skills stay available on
any line.

In a thread with prior conversation context, send `/compact` to reduce context usage. The context
meter offers the same action, and the work log records token counts when the provider reports them.

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

## HTML and PDF files in the file viewer

The file viewer shows HTML and PDF files in your workspace as a rendered page. Use the source
toggle in the viewer's header to switch an HTML file between the page and its markup; the choice
persists like the rendered-Markdown toggle. A link to a line always opens the source. HTML runs in
an isolated frame with no access to your Ronin session. On desktop, the integrated browser remains
available from the same header for a full browser view.

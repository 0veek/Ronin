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

## Custom models

On web and desktop, use Settings → Providers → **Models** to add an unlisted model with a custom
name and options. Only options supported by the provider integration affect turns. Antigravity
uses its account catalog and does not support custom models.

## Model defaults

T3 Code remembers the last provider, model, and model options you selected and reuses that
selection for new threads. A model configured in a project's settings overrides the remembered
selection for that project; resetting the project setting returns it to the remembered selection.

Model options shown as provider defaults remain display values until you choose them in T3 Code.
T3 Code only sends options you selected explicitly, so an unset reasoning level or service tier can
still come from the provider's own configuration.

## Model defaults

The chip shows your comment when it has one, or a short quote preview otherwise. Use the pencil
button to add or change the comment. To remove the citation, place the caret beside its chip and
delete it like other inline context. Copying, reloading, and restoring a
[stashed prompt](#prompt-stash) keep each comment
with its quote, and sending tells the agent which words were quoted and which comment you wrote.
The quoted text and comment count toward the message limit.

Mobile displays saved quotes and comments, but does not create citations or
navigate to their sources.

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

## Edit an earlier prompt

On web and desktop, choose **Edit from here** beneath a sent message to rewind
the conversation to before that message. Choose **Revert and keep changes** to
leave workspace files as they are, or **Revert files too** to restore them as well.
The selected prompt and its attachments return to the composer for editing and
resending. Any unsent draft stays above the restored prompt.

This removes the selected message and later conversation from the active thread
and provider history. It does not undo external actions or separate provider
memory. The action is available only when the provider supports rewind.

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

## Context in your message

Context you attach lands where your cursor is, as a chip inside your text: a terminal excerpt,
a review comment from a diff or file, a preview annotation, or a file. You can type before and
after a chip, move it by cutting and pasting, and delete it like a character. Hover a chip for
its brief details. Select a terminal excerpt to open its captured output, or select a review
comment, picked element, or preview annotation to open its full details. Chips read as "Terminal
excerpt, Terminal 1 lines 3-4" and similar to screen readers.

A pull request appears as its icon and number. Its color reflects whether it was open, draft,
merged, or closed when it was attached. Select it to inspect the captured title and branches,
then choose **Open pull request** to visit the pull request. On web and desktop, type `#` to browse the newest
pull requests in the current project's repository. Continue typing digits to filter the recent list
by any part of its pull request numbers. A complete number is also resolved directly, even when that
pull request is older than the recent list. Type a single word after `#` to search pull requests in
the repository by text. Choose a result to insert it as a chip.

Images keep their thumbnail shelf above the text and also get a chip at your cursor, so you can
say exactly which image you mean. Deleting an image chip leaves the image on the shelf; removing
the thumbnail asks first when the image is still mentioned in your text, then removes both. Files
exist only as chips: deleting a file's last chip removes the file from the message.

Copy text that holds chips and paste it into another draft, in the same thread or another one,
and the chips come along with what they point to. Images and files are fetched again from the
environment they came from; while that happens the chip shows a dashed outline, and if it cannot
complete T3 Code tells you and leaves the chip for you to remove or replace. A chip whose
context is no longer available shows the same dashed outline; hover it for what to do.

Copying a message with the copy button, or copying text out of it, gives other apps readable
Markdown with a link in place of each chip. Older messages that were sent before chips still
show their context. Stashing a prompt keeps its chips and what they point to; restoring brings
them back.

On mobile, tap a chip to inspect its content. File references open the current file; attached
files show the copy that was attached to the message.

## Attached files

Select a file chip in your draft or a sent message to preview it. Code and JSON use syntax
highlighting; Markdown, HTML, CSV, and TSV offer rendered and raw views. Audio files have
playback controls. Large text files show a limited preview; save the file to read it in full.

On web and desktop, files open beside the conversation with the same controls as a workspace
file: a header row with the view toggle, **Copy contents** and **Save file**. On mobile, documents
open in the same file screen as workspace files; its menu holds **Copy contents**, **Save or
share** and **Open in file viewer**. Pictures, videos and PDFs keep their native viewers, and
other document formats such as Word or Pages open in the device's own viewer when it has one.
If nothing on the device can show a format, save or share it to open it elsewhere.

## Images and videos in messages

## Seeing an answer's markdown

Hover a finished answer and the row under it gains a **Show markdown source** button, next to Copy
and Ask on the side. It swaps the rendered answer for the raw markdown the agent actually wrote,
which is what you want when a table came out wrong, a code fence did not close, or you are about to
paste the text somewhere else. Press it again to go back.

The choice is per message and lasts as long as the app is open. Streaming answers do not offer it:
the source of half an answer is a moving target.

## HTML and PDF files in the file viewer

On web and desktop, HTML and PDF files open as rendered pages. Switch an HTML
file to source view to read its markup; a link to a specific line opens source
automatically. HTML previews cannot access your T3 Code session.

On mobile, select a PDF attachment or link to open it. iOS uses the native viewer;
Android opens a compatible installed file viewer.

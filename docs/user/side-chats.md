# Side chats

Sometimes you want to ask about an answer without the question becoming part of the conversation.
"What does that flag actually do?" is worth asking, and worth keeping out of the context the agent
carries into its next twenty turns.

**Select the part you have a question about.** A small **Ask on the side** chip appears over the
selection; press it and Ronin opens a new thread in the same project and the same checkout, with
just that passage quoted into the composer.

Three ways in, all the same verb:

| Way                                 | Seeds the side chat with          |
| ----------------------------------- | --------------------------------- |
| Select text → chip                  | the passage you selected          |
| `⌘⇧A` / `Ctrl⇧A`                    | the selection, or the last answer |
| Command palette → "Ask on the side" | the selection, or the last answer |

There is also a button in the hover row of a completed answer, next to Copy.

## What carries over, and what does not

- **The passage you selected** is quoted into the composer. You can see it, edit it, or delete it
  before sending — nothing is carried invisibly. Selecting a sentence beats quoting a whole answer,
  which is why selection is the primary way in.
- **The checkout** is the same one the parent thread runs in, so you are asking about the tree the
  answer was about. No second worktree is created.
- **Nothing else.** The side chat starts with no transcript. That is the point.

## Finding your way back

- The side chat's breadcrumb shows the thread it came from. Click it to go back.
- In the sidebar, side chats file directly under their parent rather than sorting in by timestamp.
- A side chat is a real thread. Rename it, pin it, settle it, or delete it like any other. Deleting
  the parent does not delete it.

## Inline previews

Related, and often useful in a side chat: when an agent writes an HTML file and links to it on its
own line, Ronin renders the page inline in the transcript instead of a link you have to click. See
[inline previews](./inline-previews.md).

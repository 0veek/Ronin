# Inline previews

When an agent builds something you are meant to look at — a coverage report, a chart, a mockup — it
writes an HTML file and tells you where it went. Ronin renders that page in the transcript instead of
leaving you a link to click.

A paragraph that is **nothing but a link to a local HTML file** becomes a preview card:

```markdown
I've written the coverage report:

[Coverage report](coverage/index.html)
```

The card shows the page in a frame, with a header carrying the filename, a reload button, and an
action to open the file in the side panel. Collapse it with the chevron if it is in your way.

## What qualifies

- The link must be the whole paragraph. A link inside a sentence stays an ordinary link — an iframe
  erupting mid-sentence would be worse than the click it saved.
- The file must be local and end in `.html` or `.htm`. Remote pages are not framed; use the browser
  panel for those.
- Relative assets work. The page's own stylesheets, scripts, images, and fonts load normally.

## Safety

The frame runs with an opaque origin. Scripts inside the page work, but the page cannot reach
Ronin's own DOM, storage, or cookies, and it cannot read anything about your session. Files are
served through the same signed workspace endpoint the rest of the app uses, which refuses anything
outside the thread's workspace.

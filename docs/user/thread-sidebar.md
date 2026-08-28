# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
`mod+shift+p` pins or unpins the thread you have open. Pinned threads are shown independently of
their project, including when you connect to more than one environment.

Pinned threads follow the auto-settle policy in **Settings** → **General**. Choose exactly one
policy: settle when a pull request merges or closes, settle after a configurable period of
inactivity, or never auto-settle. **Never** leaves every automatic path off, so threads settle only
when you choose **Settle**. The pin marker stays on the row, and the thread returns to the pinned
section when it is unsettled.

When you un-settle a thread, it returns to the top of the active list so you can find it right
away. Its timestamps do not change. Other threads keep their positions.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. The thread settles when the linked pull request merges or closes only when the
pull-request policy is selected. Right-click the same link and choose **Unlink from thread** to
remove it. If T3 Code cannot determine when a pull request entered its terminal state, it keeps the
thread active.

Drag a pinned thread to change its position. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the Ronin server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

For the same threads laid out by what they are doing, side by side, see the
[board](board.md).

## Needs you

Threads that have stopped and cannot go on without you gather in a **Needs you** block at the top
of the sidebar: an agent waiting for approval, one that asked a question, one that hit an error, and
the lead thread of a [build system](build-systems.md) that is waiting for you to approve a gated
role or answer a question. They are listed longest-waiting first, so the thread that has been stuck
the longest is always the one at the top.

The block covers every environment you are connected to, and it follows your project filter — narrow
to one project and it shows only that project's blocked work. It appears when something needs you
and disappears on its own when nothing does, so there is nothing to dismiss.

Snoozing still wins. A thread you have snoozed stays on the snoozed shelf until it wakes, even if an
agent is waiting on it, because snoozing is you saying you will deal with it later.

## Finding archived threads

The command palette searches the titles and messages of your live threads. Archived threads are
left out on purpose, so searching while you work stays focused on what is still open.

To search what you have archived, open **Settings → Archive**. The search box there matches both
thread titles and the messages inside them, and shows the matching line underneath each result so
you can tell why it matched. Unarchive from the same row to bring a thread back.

## Exporting a conversation

Right-click a thread — in the sidebar or from the chat header menu — and choose **Export
conversation** to save the transcript as Markdown or JSON. Markdown is for reading and sharing;
JSON keeps the message roles, timestamps, and which provider wrote each reply.

The file is built from the transcript your client already has, so exporting works the same over a
remote connection and never writes anything on the machine running the agent. A reply that is still
being written is left out, and the entry only appears once a thread's transcript is open.

## Settling threads

Threads on closed pull requests always settle automatically. Merged pull requests also settle by
default; turn off **Auto-settle merged threads** in **Settings → General** if merged work should
remain active. The separate inactivity setting controls whether quiet threads settle after a chosen
number of days.

## Sidebar glass

The sidebar is drawn as a pane of frosted glass, lit from the wordmark at the top. Each theme casts
its own tint through the material, so the glass changes colour when you change themes.

On macOS and Windows 11 the sidebar also picks up the system's own background blur, so your desktop
shows faintly through it. Turn on **Reduce transparency** in your operating system's accessibility
settings to make the sidebar solid again; the lighting and texture stay, only the see-through part
goes away. Other platforms draw the glass without the system blur, and look the same either way.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by Ronin.

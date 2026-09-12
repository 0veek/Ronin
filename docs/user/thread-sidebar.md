# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
`mod+shift+p` pins or unpins the thread you have open. Pinned threads are shown independently of
their project, including when you connect to more than one environment.

To require confirmation before unpinning, enable **Settings** → **General** → **Unpin
confirmation**. The confirmation applies to the sidebar controls, thread menus, and the
`mod+shift+p` shortcut.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled. The pin marker stays on the row, and
the thread returns to the pinned section when it is unsettled.

Each server stores its own copy of the automatic settlement settings and checks them even when no
web or desktop client is connected. By default, it settles threads after three days without activity
and when their pull request merges. An eligible idle thread also settles when its pull request
closes. An open pull request blocks inactivity settlement. Active work, pending input, and live
background work keep the thread active. Ronin settles from a closed or merged pull request only when
its timestamp is not older than the user's latest activity. If that timestamp is not available, the
inactivity rule still applies. A manual un-settle also keeps the thread active.

**Settled** lists threads by when their work finished, newest first. A thread you settle yourself
sorts by the moment you settled it. A thread that settled on its own sorts by its last message or
turn, not by when the server noticed it was inactive.

Change these rules in **Settings > General**. The change is written to every environment you are
connected to at that moment. An environment that is offline keeps its old value. When a connected
environment holds a different value, **Settings > General** shows a warning that names it. Choose
**Apply to all** to write your current values to every connected environment. The same applies to
the new-thread workspace mode and the source control writing style.

A settings change affects future settlement and does not reopen a settled thread. Settings saved by
older clients on one device no longer control this behavior. Manually settling an idle thread
dismisses unanswered async questions without sending an answer or restarting the agent.

When you un-settle a thread, it returns to the top of the active list so you can find it right
away. Its timestamps do not change. Other threads keep their positions.

A thread whose composer holds unsent text or attachments shows an amber tint and a pen icon in the
sidebar, the same marks a new-thread draft uses. On web and desktop, hover the row and choose the
**X** to discard that draft without opening the thread.

On web and desktop, you can also drag files from your computer onto any thread row. The thread
opens with the files attached in its composer, ready for your next message. The same per-message
limits apply as when you [attach files directly](composer.md#attach-files).

The server finds the PR for each unsettled thread's saved branch, even when your
apps are closed. Settled threads keep their saved links. Update the server if
automatic branch links do not appear.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar, or to select a different PR. The thread settles when the linked pull request merges if **Auto-settle merged
threads** is enabled. Right-click the same link and choose **Unlink from thread** to return to the
branch PR, if one exists.

On web and desktop, pinning or unpinning a thread keeps the sidebar at your current
scroll position instead of following the thread to its new place in the list.

Pinning does not prevent automatic settlement. Settling a thread removes its pin.

On web and desktop, drag a thread between sections to change its state. Drag a thread up into
the pinned section to pin it at the spot you drop it; drag a pinned thread down into the active
list to unpin it. Dragging a thread onto the **Settled** header settles it, and dragging a settled
thread into the active list un-settles it. A snoozed thread can be dragged out of the snoozed
shelf, which wakes it, but threads cannot be dragged into the shelf because snoozing needs a wake
time. **Needs you** is the same kind of shelf: you can drag a blocked thread out of it, but you
cannot drop into it. Dragging a pinned thread out of the pinned section does not ask for unpin
confirmation.

Pinned and active boundary labels appear only while dragging, without moving the rows. The other
rows slide aside to show where the thread will land. When you cross into another section, the
dragged thread shows the action the drop performs, with its icon: **Pin**, **Unpin**, **Settle**,
**Un-settle**, or **Wake**. Its status and hover actions hide during the drag. A pinned thread
keeps its pin only while it stays in the pinned section; once it leaves, the badge takes over.
Reordering within the same section shows no badge. When there are no pins, drag to the top edge
to pin a thread. Section labels stay readable for the whole drag, and the section the thread is
over takes the accent color. Section labels also identify empty sections and a collapsed settled
shelf.

Drag within the pinned or active section to change its order. Other rows slide aside to show the
spot where the thread will land. Drops into either section keep the position you choose. The
server saves the order, so it survives a refresh and appears on your other connected devices.

The list also animates section changes made with thread actions such as **Pin**, **Settle**, and
**Snooze**. These transitions respect your system's reduced-motion preference. While dragging,
rows follow the insertion gap without replaying a second transition after the drop.

New threads appear above the active threads you have arranged. Settling clears a thread's active
position, so using **Un-settle** returns it to the top. Pinning and snoozing preserve its active
position until you move it again. Thread activity does not change the order. The settled shelf
continues to use settlement time.

If dragging is unavailable for one environment, update the Ronin server running in that
environment. Pinned and active reordering require server support. Older servers can still pin and
unpin threads, but do not understand synced ordering; their pinned threads keep the default
newest-first order below the ones you have arranged.

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

## Panel motion

The main sidebar, right panel, and terminal drawer open and close immediately by default. Under
**Settings → Appearance → Motion**, move the **Panel animations** slider above 0 ms to add motion.
The duration can be set up to 400 ms. Clicking the preview replays all three panel transitions; at
0 ms, it snaps between the same open and closed states.

## Environment icons

When you are connected to more than one environment, every thread that lives somewhere other than
the machine you are on wears a small icon for that machine at the end of its row: a server, a cloud
VM, a desktop, a laptop, a Mac mini, or a Mac Studio. In a browser session, where every environment
is remote, each row wears its machine so you can tell them apart at a glance. The same icon appears
wherever an environment is named: the thread tooltip, the command palette, the "Run on" picker, the
pull request server filter, the provider settings device tabs, and the environment lists under
**Settings → Connections**.

Servers pick the icon themselves from the hardware they run on. A Mac reports its model, a Linux
machine reports its chassis type and whether it is a virtual machine, and anything without a usable
signal shows a generic server. To override it, open **Settings → Connections** and choose an icon
for that environment; **Automatic** goes back to what the server detected. The choice is stored on
that server, so every device that connects to it sees the same icon.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by Ronin.

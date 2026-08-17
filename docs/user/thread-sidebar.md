# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the Ronin server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Needs you

Threads that have stopped and cannot go on without you gather in a **Needs you** block at the top
of the sidebar: an agent waiting for approval, one that asked a question, and one that hit an error.
They are listed longest-waiting first, so the thread that has been stuck the longest is always the
one at the top.

The block covers every environment you are connected to, and it follows your project filter — narrow
to one project and it shows only that project's blocked work. It appears when something needs you
and disappears on its own when nothing does, so there is nothing to dismiss.

Snoozing still wins. A thread you have snoozed stays on the snoozed shelf until it wakes, even if an
agent is waiting on it, because snoozing is you saying you will deal with it later.

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
pill** fallback because their colors are not controlled by T3 Code.

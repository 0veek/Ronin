# Agent notifications

Ronin notifies you when an agent needs you and the app is in the background: a turn finished, a
turn failed, or an agent stopped to wait for an approval. Clicking the notification brings Ronin
back and lands on the thread that asked. When many threads settle at once — a fan-out finishing, a
laptop waking from sleep — they collapse into a single summary instead of stacking.

Notifications only fire while Ronin is not the focused window. While you're looking at the app, the
sidebar's working indicators already tell the story, so nothing pings. Returning to the app clears
whatever is still sitting in the system tray, and stopping a turn yourself never notifies — you
were there.

The toggle lives in **Settings → General → Agent notifications**, and it is per device: each
desktop, phone, or browser connected to your environments decides for itself whether it pings. The
desktop app can notify out of the box; a browser will ask for notification permission the first
time you flip the toggle on, and the switch only reads as on once that permission is granted.

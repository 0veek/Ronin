# Pi

Pi is the `@earendil-works/pi-coding-agent` coding agent. Ronin loads that library when you start a Pi thread and keeps the session on disk so you can resume it.

## Install

Install the Pi CLI so `pi` is on your PATH, or install the library that ships with it. In Settings, the provider card can stay like this:

```text
Display name: Pi
Binary path: pi
Agent directory: empty
```

Leave the agent directory blank for Pi's default. Turn the provider on, then pick **Pi** in the model picker. The live model list comes from Pi's own catalog once a session starts.

The provider card reports on the Pi library, because that is what a thread actually runs — Ronin loads it in this environment rather than spawning the `pi` binary. The binary path is only used to read a version for the card, so a missing `pi` on your PATH does not stop Pi from working, and a `pi` on your PATH does not mean the library is installed. If the card says the coding agent is not installed, add `@earendil-works/pi-coding-agent` to this environment; you do not need to restart Ronin afterwards.

## Permissions

Pi runs in-process and cannot pause to ask before it acts, so it does not support Supervised mode. A thread set to **Supervised** will refuse to start a Pi session and tell you to switch to **Full access**. See [Permission modes](./permission-modes.md).

## Attachments

Pi takes text prompts only. Attaching an image to a Pi thread is refused rather than sent, so the agent never answers about a picture it could not see.

## Text generation

Pi cannot write commit messages, PR titles and bodies, branch names, or thread titles. If Pi is the only provider you have enabled, Ronin leaves those to whichever other provider you turn on — enable a second provider if you want them generated.

# Antigravity

Antigravity is Google's coding-agent CLI (`agy`). Ronin starts a print-mode session with `agy -p` and streams the reply into the thread.

## Install

Install the Antigravity CLI so `agy` is on your PATH. In Settings, the provider card can stay like this:

```text
Display name: Antigravity
Binary path: agy
```

Turn the provider on, then pick **Antigravity** in the model picker. Models come from `agy models`, so the list follows whatever the installed CLI offers — including one entry per reasoning effort, such as **Gemini 3.7 Flash (High)** and **Gemini 3.7 Flash (Low)**. Hide the variants you never reach for from the provider's model list in Settings.

A custom model has to be an id Antigravity knows, the left-hand column of `agy models` — `gemini-3.7-flash-high`, not `Gemini 3.7 Flash`.

Print mode cannot pause for interactive approvals. Use Full access if a turn needs to run tools without asking.

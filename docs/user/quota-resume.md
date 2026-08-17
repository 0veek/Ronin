# Resume after a limit resets

When a turn stops because your Claude, Codex, or Grok subscription window is spent, Ronin keeps your
message instead of leaving a dead turn behind. A banner appears above the composer with a countdown,
and when the window resets your message sends itself.

This only covers subscription windows running out. An authentication failure, a billing problem, or
a prompt that was too long still fails the way it always has — waiting would not help.

## The banner

```
⏳  Codex 5-hour limit reached — resuming in 42m
    Your last message is queued and sends itself when the window resets.
                                            [Resume now]  [Cancel]
```

- **Resume now** sends the message immediately, without waiting. Useful when you know the window
  turned over early, or you have switched accounts.
- **Cancel** drops the queued message. The failed turn stays in the thread, and nothing sends.

Hovering the title shows the provider's own words, so you can tell a five-hour cap from a weekly one.

Sending a new message, archiving the thread, or deleting it also cancels the queued turn — the thread
moving on always wins over a wait.

## How long Ronin waits

**Settings → General → Resume after limit resets** sets the ceiling:

| Option              | Behaviour                                                       |
| ------------------- | --------------------------------------------------------------- |
| Never               | Turns off queuing entirely. Quota failures stay plain failures. |
| Wait up to 6 hours  | The default. Covers a five-hour window comfortably.             |
| Wait up to 24 hours | Adds most overnight waits.                                      |
| Wait however long   | No ceiling, including weekly and monthly caps.                  |

A reset further out than your ceiling is not queued, but the banner still appears with **Resume now**
so the message is not silently lost.

## What it does not do

- **Queued turns do not survive a restart.** Quitting Ronin clears them. A relaunch days later
  replaying old prompts into a workspace that has moved on would be worse than forgetting them.
- **One turn per thread.** A second quota failure on the same thread replaces the first.
- **It gives up after three attempts.** If the provider still refuses right after a reset, the window
  is not the real problem.
- **Only Claude, Codex, and Grok.** Those are the providers whose reset times Ronin can read.

Related: [Review usage](./usage.md) for what your windows currently look like.

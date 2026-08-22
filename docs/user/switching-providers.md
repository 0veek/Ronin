# Switching providers mid-thread

You can move a thread to a different provider without starting over. Open the model picker in the
composer and choose an instance belonging to another provider; Ronin asks you to confirm, then hands
the conversation over on your next message.

The old provider stops at that point. The new one picks the thread up when you send, and a line in
the transcript marks where the handover happened.

## What the new provider knows

It depends on whether that provider has worked on this thread before.

- **It has been here.** Ronin resumes its own session, so it still remembers everything it did, and
  it only has to catch up on what happened while it was away.
- **It is new to the thread.** It starts fresh and reads a brief written from the thread itself: the
  conversation so far, who said what, what each turn actually did — commands run, files edited, what
  failed — plus the working directory, the branch, the files the work has touched, and the plan if
  one was proposed. Attachments are named, so a turn that was a screenshot is not a blank.

Either way the handover line tells you which one happened. Very long conversations are compressed to
fit the new provider's input limit: the latest turns stay in full, older ones shrink to a one-line
summary, and only when even that will not fit are the oldest dropped. Your original request is
pinned and never dropped, because it is the one thing the rest of the thread is for. The handover
line reports what was carried — how many turns went over in full, how many were summarized, and how
many were left out — so you can tell at a glance whether the new provider has the whole picture.

Switching back later is fine. Each provider keeps its own place in the thread, so returning to one
you used earlier resumes its session rather than re-briefing it.

## When you can't switch

The picker refuses a switch while work is in flight, because the outgoing provider would be cut off
mid-task:

- **A turn is running.** Interrupt it first.
- **A permission prompt or a question is waiting.** Answer it first — it belongs to the provider
  that asked, and the new one has no way to respond to it.

Choosing a different model on the _same_ provider is not a handover and needs no confirmation, and
neither is moving between two instances that share a session — two Codex instances pointing at the
same home directory, for example.

## Things worth knowing

- The model is part of the switch. Providers do not share model names, so picking the target
  provider also means picking one of its models.
- Nothing is deleted. The transcript, the checkpoints, and the diffs stay exactly as they were.
- The new provider writes code its own way and may not carry every detail of the plan so far, so
  later edits can drift from the approach already in your files. The confirmation says as much.
- The brief is built from the thread's own record, so it costs no extra model call.
- Interrupting a turn does not confuse the handover. Ronin remembers that the provider had already
  read that message, so coming back to it later does not hand it the same request twice.

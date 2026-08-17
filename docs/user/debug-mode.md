# Debug mode

Debug mode points the agent at a defect and holds it to evidence: reproduce the failure, find the root cause, fix that, then verify the symptom is actually gone.

Use it when something is broken and you want the cause rather than a guess.

## Turning it on

Pick **Debug** from the mode control in the composer footer, or send `/debug`. Send `/default` — or pick **Build** — to go back.

The mode sticks to the thread, so every turn stays in debug until you change it. It survives restarts and follows the thread when you switch providers.

## What changes

Ronin adds a standing instruction to each turn asking the agent to:

- Read the real current state before editing, and collect the actual logs, errors, and stack traces.
- Form testable hypotheses and narrow them with evidence.
- Fix the smallest root cause instead of masking the symptom.
- Add or update a regression test when practical, then run a real verification before claiming the bug is fixed.
- Ask you for a reproduction step, log, or browser state it cannot reach itself, and stop rather than guess.

## What does not change

Debug mode grants no extra access. Your [permission mode](./permission-modes.md) is untouched, so a supervised thread still asks before commands and edits.

It is also not [plan mode](./composer.md): the agent edits and runs commands as it normally would. Switching from plan straight to debug lifts plan's restrictions.

## Provider support

Debug mode works with every provider, because it is carried by the instructions Ronin sends rather than a provider's own mode. Unlike plan mode, it does not depend on a beta setting or on the provider exposing a native mode.

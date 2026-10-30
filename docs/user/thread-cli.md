# Control threads from scripts

Use `t3 thread` while Ronin is running on the same environment. Run it over SSH
to control threads on another machine. Commands use that environment's projects,
credentials, and provider subscriptions. They do not start a server or a provider
when Ronin is closed. Use `--base-dir` when the running server uses a custom T3 home.

```sh
t3 thread list --project .
t3 thread start . "Explain the failing tests"
t3 thread send THREAD_ID "Check the Windows case too"
t3 thread show THREAD_ID --messages 20
```

Pass a project id or a path inside a project. Nested projects use the closest
containing project. New threads use the project's default model and Ronin's
normal new-thread permission mode. Override the model with both
`--provider INSTANCE_ID --model MODEL`. A project without a default model needs
these flags. `--title` sets the thread title.

To prepare an isolated checkout, use `--worktree BASE_REF`; optionally add
`--branch NEW_BRANCH`. Ronin runs the project's worktree setup script as usual.

Messages sent to an existing thread always queue. They do not interrupt an agent,
answer a question, or decline an approval. Existing thread permissions and
interaction mode remain in effect. Open Ronin to answer pending requests or
release a queue held after a restart.

Use `-` as the message to read standard input:

```sh
git diff | t3 thread start . - --wait --json
```

`--wait` on `start` or `send` prints the final assistant reply for that submission,
following automatic restart continuations when present. It does not wait for
unrelated later messages. It exits with 0 on completion, 1 on failure or a stopped
run, and 2 when a person must answer in Ronin. Automatic restart continuation
remains off by default. A lost connection ends the command with an error; the
accepted message remains in Ronin.

Every command supports `--json` for scripts. Wait results include `threadId`,
`messageId`, `runId`, `status`, and `text`, including unsuccessful run outcomes.
Without `--wait`, `start` and `send` print the thread id immediately. `show`
defaults to the latest 10 messages and accepts 1–1,000.

Each command uses a temporary authenticated session, revoked when the command
finishes or is interrupted.

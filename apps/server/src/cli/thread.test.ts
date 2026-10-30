import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthSessionId,
  CommandId,
  MessageId,
  OrchestrationProjectShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as TestConsole from "effect/testing/TestConsole";
import * as NetService from "@t3tools/shared/Net";
import { Command } from "effect/unstable/cli";
import {
  queuedThreadCommand,
  printThreadOutcome,
  resolveThreadProject,
  threadCommand,
  waitForMessage,
  withThreadSession,
} from "./thread.ts";
import { EnvironmentAuth } from "../auth/EnvironmentAuth.ts";

const threadId = ThreadId.make("thread-cli");
const messageId = MessageId.make("message-cli");
const now = "2026-10-29T00:00:00.000Z";
const decodeProject = Schema.decodeUnknownSync(OrchestrationProjectShell);
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const project = (id: string, root: string) =>
  decodeProject({
    id,
    workspaceRoot: root,
    title: id,
    defaultModelSelection: null,
    scripts: [],
    createdAt: now,
    updatedAt: now,
  });

it("queues sends while preserving the thread's permissions and interaction mode", () => {
  assert.deepStrictEqual(
    queuedThreadCommand(
      { id: threadId, runtimeMode: "approval-required", interactionMode: "plan" },
      "follow up",
      CommandId.make("send-command"),
      messageId,
      now,
    ),
    {
      type: "thread.turn.start",
      commandId: CommandId.make("send-command"),
      threadId,
      message: { messageId, role: "user", text: "follow up", attachments: [] },
      dispatchMode: "queue",
      runtimeMode: "approval-required",
      interactionMode: "plan",
      createdAt: now,
    },
  );
});

it.effect("wait returns the exact submitted message's result across long-poll slices", () =>
  Effect.gen(function* () {
    const results = [
      { threadId, messageId, runId: null, status: "pending" as const, text: "" },
      { threadId, messageId, runId: null, status: "completed" as const, text: "final answer" },
    ];
    let calls = 0;
    const result = yield* waitForMessage(() => Effect.sync(() => results[calls++]!));
    assert.strictEqual(calls, 2);
    assert.strictEqual(result.text, "final answer");
  }),
);

it.effect("wait returns needs_input without another wait request", () =>
  Effect.gen(function* () {
    let calls = 0;
    const result = yield* waitForMessage(() =>
      Effect.sync(() => {
        calls++;
        return { threadId, messageId, runId: null, status: "needs_input" as const, text: "" };
      }),
    );
    assert.strictEqual(result.status, "needs_input");
    assert.strictEqual(calls, 1);
  }),
);

it.effect("prints recoverable JSON and distinct exit codes for failed and blocked runs", () =>
  Effect.gen(function* () {
    const blocked = yield* printThreadOutcome(
      { threadId, messageId, runId: null, status: "needs_input", text: "" },
      true,
    ).pipe(Effect.result);
    assert.strictEqual(blocked._tag, "Failure");
    if (blocked._tag === "Failure") assert.strictEqual(blocked.failure.exitCode, 2);
    const failed = yield* printThreadOutcome(
      {
        threadId,
        messageId,
        runId: null,
        status: "failed",
        text: "partial reply",
        error: "Provider stopped",
      },
      true,
    ).pipe(Effect.result);
    assert.strictEqual(failed._tag, "Failure");
    if (failed._tag === "Failure") assert.strictEqual(failed.failure.exitCode, 1);
    const lines = yield* TestConsole.logLines;
    assert.strictEqual(lines.length, 2);
    assert.deepStrictEqual(decodeJson(lines[1]), {
      threadId,
      messageId,
      runId: null,
      status: "failed",
      text: "partial reply",
      error: "Provider stopped",
    });
  }).pipe(Effect.provide(TestConsole.layer)),
);

it.layer(NodeServices.layer)("CLI project resolution", (it) => {
  it.effect("rejects a missing server without starting one or printing JSON success", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      const result = yield* Command.runWith(threadCommand, { version: "test" })([
        "list",
        "--base-dir",
        root,
        "--json",
      ]).pipe(Effect.result, Effect.provide(NetService.layer));
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure")
        assert.include(String(result.failure), "No running Ronin server");
      assert.deepStrictEqual(yield* TestConsole.logLines, []);
    }).pipe(Effect.provide(TestConsole.layer)),
  );
  it.effect("resolves ids and the deepest containing root, including symlinks", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${root}/nested/src`, { recursive: true });
      yield* fs.symlink(`${root}/nested`, `${root}/alias`);
      const projects = [project("parent", root), project("nested", `${root}/nested`)];
      assert.strictEqual(
        (yield* resolveThreadProject(projects, `${root}/alias/src`)).id,
        ProjectId.make("nested"),
      );
      assert.strictEqual(
        (yield* resolveThreadProject(projects, "parent")).id,
        ProjectId.make("parent"),
      );
      assert.strictEqual(
        (yield* Effect.result(resolveThreadProject(projects, `${root}-other`)))._tag,
        "Failure",
      );
    }),
  );
});

it.effect("revokes the temporary session after success, failure, and interruption", () =>
  Effect.gen(function* () {
    const revoked: string[] = [];
    const layer = Layer.mock(EnvironmentAuth)({
      issueSession: () =>
        Effect.succeed({
          sessionId: AuthSessionId.make("temporary-session"),
          token: "temporary-token",
          method: "bearer-access-token",
          scopes: [],
          subject: "test",
          client: { deviceType: "bot", label: "test" },
          expiresAt: DateTime.makeUnsafe(now),
        }),
      revokeSession: (id) =>
        Effect.sync(() => {
          revoked.push(id);
          return true;
        }),
    });
    yield* Effect.gen(function* () {
      const auth = yield* EnvironmentAuth;
      assert.strictEqual(
        yield* withThreadSession(auth, (token) => Effect.succeed(token)),
        "temporary-token",
      );
      yield* withThreadSession(auth, () => Effect.fail("test failure")).pipe(Effect.result);
      yield* withThreadSession(auth, () => Effect.interrupt).pipe(Effect.exit);
    }).pipe(Effect.provide(layer));
    assert.deepStrictEqual(revoked, [
      "temporary-session",
      "temporary-session",
      "temporary-session",
    ]);
  }),
);

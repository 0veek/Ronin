// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import { assert, it } from "@effect/vitest";
import { RuntimeTaskId, ThreadId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { afterAll } from "vite-plus/test";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { readWorkflowConversation } from "./workflowConversationQuery.ts";
import { readContainedWorkflowFile } from "./workflowFileRead.ts";

const configDir = NodeFS.mkdtempSync(
  NodePath.join(NodeOS.tmpdir(), "ronin-workflow-conversation-"),
);
const transcriptDir = NodePath.join(configDir, "projects", "workspace", "workflow");
NodeFS.mkdirSync(transcriptDir, { recursive: true });
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const transcript =
  ["First answer", "Second answer"]
    .map((text, index) =>
      encode({
        type: "assistant",
        message: { id: `answer-${index}`, content: [{ type: "text", text }] },
      }),
    )
    .join("\n") + "\n";
NodeFS.writeFileSync(NodePath.join(transcriptDir, "agent-member.jsonl"), transcript);
afterAll(() => NodeFS.rmSync(configDir, { recursive: true, force: true }));
const input = {
  threadId: ThreadId.make("thread"),
  taskId: RuntimeTaskId.make("workflow:wf:0"),
  workflowAgentId: "member",
  attempt: 1,
};
const activity = (payload: Record<string, unknown>) =>
  ({ payload }) as unknown as OrchestrationThreadActivity;

it.effect.each([
  "full",
  "missing-file",
  "stale-at-open",
  "retry-during-read",
  "other-thread",
] as const)("loads only the selected persisted workflow attempt: %s", (scenario) =>
  Effect.gen(function* () {
    let reads = 0;
    const layer = Layer.mock(ProjectionSnapshotQuery)({
      getTaskActivity: ({ threadId, taskId }) =>
        Effect.sync(() => {
          if (threadId !== input.threadId) return Option.none();
          if (taskId === "workflow")
            return Option.some(activity({ runHandles: { transcriptDir } }));
          reads++;
          return Option.some(
            activity({
              parentAgentId: "workflow",
              workflowAgentId: scenario === "missing-file" ? "missing" : "member",
              workflowConfigDir: configDir,
              attempt:
                scenario === "stale-at-open" || (scenario === "retry-during-read" && reads > 1)
                  ? 2
                  : 1,
              promptPreview: "  Review checkout\n",
              resultPreview: "Answer excerpt",
            }),
          );
        }),
    });
    const request = {
      ...input,
      ...(scenario === "missing-file" ? { workflowAgentId: "missing" } : {}),
      ...(scenario === "other-thread" ? { threadId: ThreadId.make("other") } : {}),
    };
    const result = yield* Effect.exit(
      readWorkflowConversation(request).pipe(Effect.provide(layer)),
    );
    if (scenario === "full" || scenario === "missing-file") {
      assert.equal(result._tag, "Success");
      if (result._tag !== "Success") return;
      assert.equal(result.value.prompt, "  Review checkout\n");
      assert.deepEqual(
        result.value.answers,
        scenario === "full" ? ["First answer", "Second answer"] : ["Answer excerpt"],
      );
      assert.equal(result.value.partial, scenario !== "full");
    } else assert.equal(result._tag, "Failure");
  }),
);

it.effect("rejects paths outside the configured projects root", () =>
  Effect.gen(function* () {
    const outside = NodePath.join(configDir, "outside.jsonl");
    NodeFS.writeFileSync(outside, transcript);
    const invalid = yield* Effect.flip(
      readContainedWorkflowFile({ path: outside, extension: ".jsonl", configDir, byteCap: 100 }),
    );
    assert.equal(invalid.reason, "outside-root");
    const relative = yield* Effect.flip(
      readContainedWorkflowFile({
        path: "member.jsonl",
        extension: ".jsonl",
        configDir,
        byteCap: 100,
      }),
    );
    assert.equal(relative.reason, "invalid-path");
  }),
);

it.effect.skipIf(!symlinksSupported)(
  "rejects a transcript symlink escaping the configured root",
  () =>
    Effect.gen(function* () {
      const link = NodePath.join(transcriptDir, "escape.jsonl");
      const outside = NodePath.join(configDir, "escape-target.jsonl");
      NodeFS.writeFileSync(outside, transcript);
      NodeFS.symlinkSync(outside, link);
      const error = yield* Effect.flip(
        readContainedWorkflowFile({ path: link, extension: ".jsonl", configDir, byteCap: 100 }),
      );
      assert.equal(error.reason, "outside-root");
    }),
);

it.effect.skipIf(HostProcessPlatform.defaultValue() === "win32")(
  "rejects a FIFO without waiting for a writer",
  () =>
    Effect.gen(function* () {
      const fifo = NodePath.join(transcriptDir, "pipe.jsonl");
      NodeChildProcess.execFileSync("mkfifo", [fifo]);
      const error = yield* Effect.flip(
        readContainedWorkflowFile({ path: fifo, extension: ".jsonl", configDir, byteCap: 100 }),
      );
      assert.equal(error.reason, "not-regular-file");
    }),
);

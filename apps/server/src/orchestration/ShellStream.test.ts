import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { skipUnchangedThreadShells } from "./ShellStream.ts";

const thread: OrchestrationThreadShell = {
  id: ThreadId.make("shell-refresh"),
  projectId: ProjectId.make("project"),
  title: "Shell refresh",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  pullRequests: [],
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  session: null,
};
const update = (sequence: number, value = thread): OrchestrationShellStreamItem => ({
  kind: "thread-upserted",
  sequence,
  thread: value,
});

it.effect(
  "drops timestamp-only refreshes while delivering input, metadata, and removal changes",
  () =>
    Effect.gen(function* () {
      const events: OrchestrationShellStreamItem[] = [
        update(1),
        update(2, { ...thread, updatedAt: "2026-10-06T00:00:01.000Z" }),
        update(3, { ...thread, hasPendingUserInput: true }),
        update(4, { ...thread, title: "Renamed" }),
        { kind: "synchronized" },
        { kind: "thread-removed", sequence: 5, threadId: thread.id },
        update(6),
      ];
      const received = yield* Stream.fromIterable(events).pipe(
        skipUnchangedThreadShells,
        Stream.runCollect,
      );
      assert.deepEqual(received, [events[0], ...events.slice(2)]);
    }),
);

it.effect("resends an unchanged shell after five seconds and starts each subscription fresh", () =>
  Effect.gen(function* () {
    const stream = Stream.fromIterable([1, 2, 3, 4]).pipe(
      Stream.mapEffect((sequence) =>
        Effect.gen(function* () {
          if (sequence === 2) yield* TestClock.adjust("4999 millis");
          if (sequence === 3) yield* TestClock.adjust("1 millis");
          return update(sequence);
        }),
      ),
      skipUnchangedThreadShells,
    );
    for (let subscription = 0; subscription < 2; subscription++) {
      const received = yield* Stream.runCollect(stream);
      assert.deepEqual(
        received.map((event) => ("sequence" in event ? event.sequence : null)),
        [1, 3],
      );
    }
  }),
);

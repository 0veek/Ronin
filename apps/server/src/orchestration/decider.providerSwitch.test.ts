import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

// The decider's clock is the Effect test clock, pinned to the epoch, so every
// timestamp below is relative to 1970-01-01T00:00:00.000Z.
const NOW = "1970-01-01T00:00:00.000Z";
const CODEX = ProviderInstanceId.make("codex-personal");
const CLAUDE = ProviderInstanceId.make("claude-work");

interface ThreadOverrides {
  readonly instanceId?: ProviderInstanceId;
  readonly session?: OrchestrationSession | null;
  readonly activities?: OrchestrationThread["activities"];
  readonly messages?: OrchestrationThread["messages"];
  readonly latestTurn?: OrchestrationThread["latestTurn"];
  readonly archivedAt?: string | null;
}

function makeReadModel(overrides: ThreadOverrides = {}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: overrides.instanceId ?? CODEX, model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: overrides.latestTurn ?? null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: overrides.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
        messages: overrides.messages ?? [],
        proposedPlans: [],
        activities: overrides.activities ?? [],
        checkpoints: [],
        session: overrides.session ?? null,
      },
    ],
    updatedAt: NOW,
  };
}

function makeSession(
  status: OrchestrationSession["status"],
  instanceId: ProviderInstanceId | null = CODEX,
): OrchestrationSession {
  return {
    threadId: ThreadId.make("thread-1"),
    status,
    providerName: "Codex",
    ...(instanceId === null ? {} : { providerInstanceId: instanceId }),
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
  };
}

// A thread that has actually been used: without history a switch is a plain
// retarget with nothing to hand over.
const HISTORY: OrchestrationThread["messages"] = [
  {
    id: MessageId.make("message-1"),
    role: "user",
    text: "Ship the migration",
    turnId: null,
    streaming: false,
    createdAt: "1969-12-01T00:00:00.000Z",
    updatedAt: "1969-12-01T00:00:00.000Z",
  },
];

function switchCommand(
  commandId: string,
  instanceId: ProviderInstanceId,
): Extract<
  Parameters<typeof decideOrchestrationCommand>[0]["command"],
  { type: "thread.provider.switch" }
> {
  return {
    type: "thread.provider.switch",
    commandId: CommandId.make(commandId),
    threadId: ThreadId.make("thread-1"),
    modelSelection: { instanceId, model: "claude-opus-5" },
    createdAt: NOW,
  };
}

it.layer(NodeServices.layer)("provider switch decider", (it) => {
  it.effect("emits a switch naming the instance being handed off from", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch", CLAUDE),
        readModel: makeReadModel({ session: makeSession("idle"), messages: HISTORY }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.provider-switched");
      if (events[0]?.type === "thread.provider-switched") {
        const payload = events[0].payload;
        expect(payload.fromInstanceId).toBe(CODEX);
        expect(payload.fromProviderName).toBe("Codex");
        expect(payload.toInstanceId).toBe(CLAUDE);
        expect(payload.modelSelection).toEqual({ instanceId: CLAUDE, model: "claude-opus-5" });
        // The switch instant is the transcript boundary; sorting keys on
        // updatedAt, so the two must agree.
        expect(payload.switchedAt).toBe(payload.updatedAt);
      }
    }),
  );

  it.effect("falls back to the thread's own selection when no session has bound yet", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-unbound", CLAUDE),
        readModel: makeReadModel({ messages: HISTORY }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events[0]?.type).toBe("thread.provider-switched");
      if (events[0]?.type === "thread.provider-switched") {
        expect(events[0].payload.fromInstanceId).toBe(CODEX);
        // Only a live session knows the provider's display name.
        expect(events[0].payload.fromProviderName).toBeNull();
      }
    }),
  );

  it.effect("rejects switching under a live session", () =>
    Effect.gen(function* () {
      for (const status of ["starting", "running"] as const) {
        const error = yield* decideOrchestrationCommand({
          command: switchCommand(`cmd-switch-live-${status}`, CLAUDE),
          readModel: makeReadModel({ session: makeSession(status), messages: HISTORY }),
        }).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
      }
    }),
  );

  it.effect("rejects switching while an approval is still open", () =>
    Effect.gen(function* () {
      const activity = (
        kind: string,
        requestId: string,
      ): OrchestrationThread["activities"][number] =>
        ({
          id: EventId.make(`activity-${requestId}-${kind}`),
          tone: "approval" as const,
          kind,
          summary: kind,
          payload: { requestId },
          turnId: null,
          createdAt: NOW,
        }) as OrchestrationThread["activities"][number];

      const error = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-approval", CLAUDE),
        readModel: makeReadModel({
          messages: HISTORY,
          activities: [activity("approval.requested", "req-1")],
        }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");

      // Resolved: the outgoing provider has nothing left to answer.
      const resolved = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-approval-resolved", CLAUDE),
        readModel: makeReadModel({
          messages: HISTORY,
          activities: [
            activity("approval.requested", "req-1"),
            activity("approval.resolved", "req-1"),
          ],
        }),
      });
      const events = Array.isArray(resolved) ? resolved : [resolved];
      expect(events[0]?.type).toBe("thread.provider-switched");
    }),
  );

  it.effect("rejects switching while a turn start is still queued", () =>
    Effect.gen(function* () {
      const queuedMessage = (createdAt: string): OrchestrationThread["messages"][number] => ({
        id: MessageId.make("message-queued"),
        role: "user",
        text: "Continue",
        turnId: null,
        streaming: false,
        createdAt,
        updatedAt: createdAt,
      });

      // Inside the adoption window: the turn is already on its way to the old
      // provider even though session is still null.
      const error = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-queued", CLAUDE),
        readModel: makeReadModel({ messages: [queuedMessage("1969-12-31T23:59:30.000Z")] }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");

      // Long past the window: an old thread whose last user message postdates
      // its turn timestamps must not be blocked forever.
      const stale = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-stale", CLAUDE),
        readModel: makeReadModel({ messages: [queuedMessage("1969-12-01T00:00:00.000Z")] }),
      });
      const events = Array.isArray(stale) ? stale : [stale];
      expect(events[0]?.type).toBe("thread.provider-switched");
    }),
  );

  it.effect("rejects retargeting the instance the thread is already on", () =>
    Effect.gen(function* () {
      // Bound by a live-enough session.
      const boundError = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-same-session", CODEX),
        readModel: makeReadModel({ session: makeSession("idle"), messages: HISTORY }),
      }).pipe(Effect.flip);
      expect(boundError._tag).toBe("OrchestrationCommandInvariantError");

      // Bound only by the thread's selection.
      const selectionError = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-same-selection", CODEX),
        readModel: makeReadModel({ messages: HISTORY }),
      }).pipe(Effect.flip);
      expect(selectionError._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("treats a retired session as history, so switching back is allowed", () =>
    Effect.gen(function* () {
      // The thread started on Codex, was handed to Claude, and the user is now
      // switching back. Codex's session is stopped: reading its instance here
      // would read as a same-instance retarget and reject the switch.
      const result = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-back", CODEX),
        readModel: makeReadModel({
          instanceId: CLAUDE,
          session: makeSession("stopped", CODEX),
          messages: HISTORY,
        }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events[0]?.type).toBe("thread.provider-switched");
      if (events[0]?.type === "thread.provider-switched") {
        expect(events[0].payload.fromInstanceId).toBe(CLAUDE);
        expect(events[0].payload.fromProviderName).toBeNull();
        expect(events[0].payload.toInstanceId).toBe(CODEX);
      }
    }),
  );

  it.effect("has nothing to hand off on a thread that never started", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-fresh", CLAUDE),
        readModel: makeReadModel(),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events[0]?.type).toBe("thread.provider-switched");
      if (events[0]?.type === "thread.provider-switched") {
        expect(events[0].payload.fromInstanceId).toBeNull();
      }

      // With no history there is no binding to collide with, so even a
      // same-instance switch is just a retarget rather than an invariant break.
      const sameInstance = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-fresh-same", CODEX),
        readModel: makeReadModel(),
      });
      const sameEvents = Array.isArray(sameInstance) ? sameInstance : [sameInstance];
      expect(sameEvents[0]?.type).toBe("thread.provider-switched");
    }),
  );

  it.effect("rejects switching an archived thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: switchCommand("cmd-switch-archived", CLAUDE),
        readModel: makeReadModel({ archivedAt: NOW, messages: HISTORY }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});

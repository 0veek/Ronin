import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { NotificationHandler } from "@muse-code/sdk";
import {
  ApprovalRequestId,
  MuseSettings,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import type { MuseSdkHostOptions } from "../museSdk.ts";
import type { MuseSdkHost } from "../museSdk.ts";
import { makeMuseAdapter } from "./MuseAdapter.ts";

const settings = Schema.decodeSync(MuseSettings)({ enabled: true });
const threadId = ThreadId.make("muse-test");
function fixture() {
  let handler: NotificationHandler = () => {};
  let counter = 0;
  const emit = (method: string, params: Record<string, unknown>) =>
    handler({ jsonrpc: "2.0", method, params: { sessionId: "native-1", ...params } });
  const command = vi.fn(
    async (method: string, _params: Record<string, unknown>, options?: { commandId?: string }) => {
      if (method === "session/start" || method === "session/resume")
        return { session: { sessionId: "native-1" } };
      if (method === "turn/start") return { turnId: options?.commandId };
      if (method === "session/compact") return { status: "accepted" };
      return {};
    },
  );
  const host: MuseSdkHost = {
    connection: {
      command,
      request: vi.fn(async () => ({ session: { sessionId: "native-1" }, history: { items: [] } })),
      mintCommandId: () => `native-${++counter}`,
      onNotification: (listener) => {
        handler = listener;
      },
      onProtocolError: () => {},
      onServerRequest: () => {},
      closed: new Promise(() => {}),
    },
    initializeResult: { grantedCapabilities: ["sessionMcp"] },
    exited: new Promise(() => {}),
    close: vi.fn(async () => {}),
  };
  return { host, emit, command, createHost: async () => host };
}
const layer = ServerConfig.layerTest(process.cwd(), { prefix: "ronin-muse-adapter-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
it.layer(layer)("MuseAdapter", (it) => {
  it.effect("keeps Windows launcher cwd plain and pins turns to a verbatim workspace root", () =>
    Effect.gen(function* () {
      const mock = fixture();
      let hostCwd: string | undefined;
      const adapter = yield* makeMuseAdapter(settings, {
        createHost: async (options: MuseSdkHostOptions) => {
          hostCwd = options.cwd;
          return mock.host;
        },
      });
      yield* adapter.startSession({ threadId, cwd: "C:\\work\\repo", runtimeMode: "full-access" });
      yield* adapter.sendTurn({ threadId, input: "Work" });
      expect(hostCwd).toBe("C:\\work\\repo");
      expect(
        mock.command.mock.calls.find(([method]) => method === "turn/start")?.[1].workspaceRoots,
      ).toEqual(["\\\\?\\C:\\work\\repo"]);
    }).pipe(Effect.provideService(HostProcessPlatform, "win32")),
  );

  it.effect("approves a late workflow request in Full access using Muse's one-time choice", () =>
    Effect.gen(function* () {
      const mock = fixture();
      const adapter = yield* makeMuseAdapter(settings, { createHost: mock.createHost });
      const completed = yield* Deferred.make<void>();
      const decided = yield* Deferred.make<Record<string, unknown>>();
      const observer = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        event.type === "turn.completed"
          ? Deferred.succeed(completed, undefined).pipe(Effect.asVoid)
          : Effect.void,
      ).pipe(Effect.forkChild);
      yield* adapter.startSession({ threadId, runtimeMode: "full-access" });
      const { turnId } = yield* adapter.sendTurn({ threadId, input: "Run workflow" });
      mock.emit("turn/completed", { turnId, terminal: "completed" });
      yield* Deferred.await(completed);
      mock.command.mockImplementation((method, params) => {
        if (method === "approval/decide") Deferred.doneUnsafe(decided, Effect.succeed(params));
        return Promise.resolve({});
      });
      mock.emit("approval/requested", {
        approvalId: "late-approval",
        turnId: "child-run",
        subagentOrigin: { subagentId: "child" },
        currentRequirementId: { approvalId: "late-approval", sourceIndex: 2 },
        subject: { kind: "shell", command: "git status" },
        availableChoices: [
          { choiceId: "once", label: "Allow once", decision: "approved", scope: "once" },
        ],
      });
      expect(yield* Deferred.await(decided)).toMatchObject({
        approvalId: "late-approval",
        choiceId: "once",
        requirementId: { approvalId: "late-approval", sourceIndex: 2 },
      });
      yield* adapter.stopSession(threadId);
      yield* Fiber.interrupt(observer);
    }),
  );
  it.effect("switches a resumed named model back to the catalog default", () =>
    Effect.gen(function* () {
      const mock = fixture();
      const adapter = yield* makeMuseAdapter(settings, {
        createHost: mock.createHost,
        modelCatalog: Effect.succeed([
          {
            slug: "default-model",
            name: "Default model",
            isDefault: true,
            isCustom: false,
            capabilities: { optionDescriptors: [] },
          },
        ]),
      });
      yield* adapter.startSession({
        threadId,
        runtimeMode: "full-access",
        resumeCursor: { sessionId: "native-1" },
        modelSelection: { instanceId: ProviderInstanceId.make("muse"), model: "named-model" },
      });
      yield* adapter.sendTurn({
        threadId,
        input: "Use the default",
        modelSelection: { instanceId: ProviderInstanceId.make("muse"), model: "default" },
      });
      expect(mock.command).toHaveBeenCalledWith(
        "session/setModel",
        expect.objectContaining({ model: { providerId: "meta", modelId: "default-model" } }),
        expect.anything(),
      );
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect.each(["completed", "failed"] as const)(
    "waits for native compaction and reports %s accurately",
    (status) =>
      Effect.gen(function* () {
        const mock = fixture();
        const adapter = yield* makeMuseAdapter(settings, { createHost: mock.createHost });
        const completed = yield* Deferred.make<void>();
        const events: ProviderRuntimeEvent[] = [];
        const observer = yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.gen(function* () {
            events.push(event);
            if (event.type === "turn.completed") yield* Deferred.succeed(completed, undefined);
          }),
        ).pipe(Effect.forkChild);
        yield* adapter.startSession({ threadId, runtimeMode: "full-access" });
        yield* adapter.compaction.start(threadId);
        expect((yield* adapter.listSessions())[0]?.status).toBe("running");
        const turnId = (yield* adapter.listSessions())[0]?.activeTurnId;
        mock.emit("item/completed", {
          item: { itemId: "compaction", kind: "compaction", revision: 1, status, turnId },
        });
        yield* Deferred.await(completed);
        expect(events.find((event) => event.type === "turn.completed")?.payload).toMatchObject({
          state: status,
        });
        expect(
          events.some(
            (event) => event.type === "thread.state.changed" && event.payload.state === "compacted",
          ),
        ).toBe(status === "completed");
        yield* adapter.stopSession(threadId);
        yield* Fiber.interrupt(observer);
      }),
  );
  it.effect("keeps observing workflow agents after the root turn completes", () =>
    Effect.gen(function* () {
      const mock = fixture();
      const adapter = yield* makeMuseAdapter(settings, { createHost: mock.createHost });
      const completed = yield* Deferred.make<void>();
      const events: ProviderRuntimeEvent[] = [];
      const observer = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.gen(function* () {
          events.push(event);
          if (event.type === "task.completed") yield* Deferred.succeed(completed, undefined);
        }),
      ).pipe(Effect.forkChild);
      yield* adapter.startSession({ threadId, runtimeMode: "full-access" });
      const { turnId } = yield* adapter.sendTurn({ threadId, input: "Delegate" });
      const item = {
        itemId: "workflow",
        kind: "workflow",
        revision: 1,
        status: "inProgress",
        turnId,
        entryId: "review",
        children: [{ childId: "reviewer", attempt: 1, status: "running", label: "Reviewer" }],
      };
      mock.emit("item/started", { item });
      mock.emit("turn/completed", { turnId, terminal: "completed" });
      mock.emit("item/completed", {
        item: {
          ...item,
          revision: 2,
          status: "completed",
          children: [{ ...item.children[0], terminal: "completed" }],
        },
      });
      yield* Deferred.await(completed);
      expect(events.filter((event) => event.type === "task.started")).toHaveLength(1);
      const task = events.find((event) => event.type === "task.completed");
      expect(task?.turnId).toBe(turnId);
      expect(task?.payload).toMatchObject({
        status: "completed",
        title: "Reviewer",
        workflowName: "review",
      });
      yield* adapter.stopSession(threadId);
      yield* Fiber.interrupt(observer);
    }),
  );
  it.effect(
    "streams revisions once, completes the native turn, and preserves its resume identity",
    () =>
      Effect.gen(function* () {
        const mock = fixture();
        const adapter = yield* makeMuseAdapter(settings, { createHost: mock.createHost });
        const completed = yield* Deferred.make<void>();
        const events: ProviderRuntimeEvent[] = [];
        const observer = yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Effect.gen(function* () {
            events.push(event);
            if (event.type === "turn.completed") yield* Deferred.succeed(completed, undefined);
          }),
        ).pipe(Effect.forkChild);
        const session = yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
        expect(mock.command.mock.calls[0]?.[1]).toMatchObject({
          permissionProfile: ":ask-me",
          approvalMode: "promptUnmatched",
        });
        expect(session.resumeCursor).toEqual({ sessionId: "native-1" });
        const { turnId } = yield* adapter.sendTurn({ threadId, input: "Hello" });
        const item = {
          itemId: "answer",
          kind: "agentMessage",
          revision: 1,
          status: "inProgress",
          turnId,
          text: "Hello",
        };
        mock.emit("item/started", { item });
        mock.emit("item/updated", { item });
        mock.emit("item/delta", { itemId: "answer", delta: " world" });
        mock.emit("item/completed", {
          item: { ...item, revision: 2, status: "completed", text: "Hello world" },
        });
        mock.emit("turn/completed", { turnId, terminal: "completed" });
        yield* Deferred.await(completed);
        expect(
          events
            .filter((e) => e.type === "content.delta")
            .map((e) => e.payload.delta)
            .join(""),
        ).toBe("Hello world");
        expect(events.filter((e) => e.type === "item.completed")).toHaveLength(1);
        expect((yield* adapter.listSessions())[0]?.status).toBe("ready");
        expect((yield* adapter.rollbackThread(threadId, 1).pipe(Effect.flip))._tag).toBe(
          "ProviderOperationUnsupportedError",
        );
        yield* adapter.stopSession(threadId);
        expect(mock.host.close).toHaveBeenCalledOnce();
        yield* Fiber.interrupt(observer);
      }),
  );
  it.effect("keeps a workflow child's approval answerable after its root turn ends", () =>
    Effect.gen(function* () {
      const mock = fixture();
      const adapter = yield* makeMuseAdapter(settings, { createHost: mock.createHost });
      const opened = yield* Deferred.make<ProviderRuntimeEvent>();
      const completed = yield* Deferred.make<void>();
      const observer = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        event.type === "request.opened"
          ? Deferred.succeed(opened, event).pipe(Effect.asVoid)
          : event.type === "turn.completed"
            ? Deferred.succeed(completed, undefined).pipe(Effect.asVoid)
            : Effect.void,
      ).pipe(Effect.forkChild);
      yield* adapter.startSession({ threadId, runtimeMode: "approval-required" });
      const { turnId } = yield* adapter.sendTurn({ threadId, input: "Run a workflow" });
      mock.emit("approval/requested", {
        approvalId: "approval-1",
        turnId: "child-turn",
        subagentOrigin: { subagentId: "child" },
        currentRequirementId: { approvalId: "approval-1", sourceIndex: 3 },
        subject: { kind: "shell", command: "git status" },
        availableChoices: [
          { choiceId: "one-time", label: "Allow once", decision: "approved", scope: "once" },
        ],
      });
      expect((yield* Deferred.await(opened)).turnId).toBeUndefined();
      mock.emit("turn/completed", { turnId, terminal: "completed" });
      yield* Deferred.await(completed);
      yield* adapter.respondToRequest(threadId, ApprovalRequestId.make("approval-1"), "accept");
      expect(mock.command).toHaveBeenLastCalledWith(
        "approval/decide",
        {
          sessionId: "native-1",
          approvalId: "approval-1",
          requirementId: { approvalId: "approval-1", sourceIndex: 3 },
          choiceId: "one-time",
        },
        { maxAttempts: 1 },
      );
      yield* adapter.stopSession(threadId);
      yield* Fiber.interrupt(observer);
    }),
  );
  it.effect(
    "resumes with the requested approval mode and rejects an unexpected native identity",
    () =>
      Effect.gen(function* () {
        const mock = fixture();
        const adapter = yield* makeMuseAdapter(settings, { createHost: mock.createHost });
        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
          resumeCursor: { sessionId: "native-1" },
        });
        expect(mock.command.mock.calls[0]?.[1]).toMatchObject({
          permissionProfile: ":unrestricted",
        });
        expect(mock.command).toHaveBeenCalledWith(
          "session/setApprovalMode",
          { sessionId: "native-1", mode: "allowAll" },
          { maxAttempts: 1 },
        );
        yield* adapter.stopSession(threadId);
        const bad = fixture();
        bad.command.mockImplementation(async () => ({ session: { sessionId: "another-session" } }));
        const other = yield* makeMuseAdapter(settings, { createHost: bad.createHost });
        expect(
          (yield* other
            .startSession({ threadId, runtimeMode: "approval-required" })
            .pipe(Effect.flip))._tag,
        ).toBe("ProviderAdapterRequestError");
        expect(bad.host.close).toHaveBeenCalledOnce();
        expect(yield* other.hasSession(threadId)).toBe(false);
      }),
  );
});

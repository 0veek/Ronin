import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import * as DesktopIpc from "./DesktopIpc.ts";

const invokeMethod: DesktopIpc.DesktopIpcMethod<never, never> = {
  channel: "desktop.test.invoke",
  handler: () => Effect.void,
};

const syncMethod: DesktopIpc.DesktopSyncIpcMethod<never, never> = {
  channel: "desktop.test.sync",
  handler: () => Effect.void,
};

function makeIpcMain(
  overrides: Partial<DesktopIpc.DesktopIpcMain> = {},
): DesktopIpc.DesktopIpcMain {
  return {
    removeHandler: vi.fn(),
    handle: vi.fn(),
    removeAllListeners: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
}

describe("DesktopIpc", () => {
  it("accepts only the top frame of an owned Ronin application window", () => {
    const mainFrame = { url: "t3code://app/settings" };
    const sender: DesktopIpc.DesktopIpcWebContents = {
      mainFrame,
      getURL: () => mainFrame.url,
      isDestroyed: () => false,
    };
    const owner: DesktopIpc.DesktopIpcOwnerWindow = {
      webContents: sender,
      isDestroyed: () => false,
    };
    const resolveOwner = () => owner;

    assert.isTrue(
      DesktopIpc.isTrustedDesktopIpcSender({
        event: { sender, senderFrame: mainFrame },
        resolveOwner,
      }),
    );
    assert.isFalse(
      DesktopIpc.isTrustedDesktopIpcSender({
        event: { sender, senderFrame: { url: "t3code://app/embedded" } },
        resolveOwner,
      }),
    );
    assert.isFalse(
      DesktopIpc.isTrustedDesktopIpcSender({
        event: { sender, senderFrame: mainFrame },
        resolveOwner: () => null,
      }),
    );

    const foreignFrame = { url: "https://attacker.test" };
    const foreignSender: DesktopIpc.DesktopIpcWebContents = {
      mainFrame: foreignFrame,
      getURL: () => foreignFrame.url,
      isDestroyed: () => false,
    };
    assert.isFalse(
      DesktopIpc.isTrustedDesktopIpcSender({
        event: { sender: foreignSender, senderFrame: foreignFrame },
        resolveOwner: () => ({
          webContents: foreignSender,
          isDestroyed: () => false,
        }),
      }),
    );
  });

  it.effect("rejects an untrusted invoke sender before running the method", () =>
    Effect.gen(function* () {
      let listener: DesktopIpc.DesktopIpcHandleListener | undefined;
      let handled = false;
      const ipcMain = makeIpcMain({
        handle: (_channel, registered) => {
          listener = registered;
        },
      });
      const ipc = DesktopIpc.make(ipcMain, () => false);

      const exit = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* ipc.handle({
            ...invokeMethod,
            handler: () =>
              Effect.sync(() => {
                handled = true;
              }),
          });
          const registered = listener;
          if (!registered) return yield* Effect.die("invoke listener was not registered");
          return yield* Effect.exit(
            Effect.promise(() => Promise.resolve(registered({}, undefined))),
          );
        }),
      );

      assert.isTrue(exit._tag === "Failure");
      assert.isFalse(handled);
      if (exit._tag === "Failure") {
        assert.include(String(Cause.squash(exit.cause)), "Rejected unauthorized IPC sender");
      }
    }),
  );

  it.effect("rejects an untrusted sync sender before running the method", () =>
    Effect.gen(function* () {
      let listener: DesktopIpc.DesktopIpcSyncListener | undefined;
      let handled = false;
      const ipcMain = makeIpcMain({
        on: (_channel, registered) => {
          listener = registered;
        },
      });
      const ipc = DesktopIpc.make(ipcMain, () => false);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* ipc.handleSync({
            ...syncMethod,
            handler: () =>
              Effect.sync(() => {
                handled = true;
              }),
          });
          const registered = listener;
          if (!registered) return yield* Effect.die("sync listener was not registered");
          assert.throws(
            () => registered({ returnValue: undefined }),
            /Rejected unauthorized IPC sender/,
          );
        }),
      );

      assert.isFalse(handled);
    }),
  );

  it.effect("preserves invoke registration context and cause", () =>
    Effect.gen(function* () {
      const cause = new Error("invoke registration failed");
      const ipcMain = makeIpcMain({
        handle: () => {
          throw cause;
        },
      });
      const ipc = DesktopIpc.make(ipcMain);

      const error = yield* Effect.flip(Effect.scoped(ipc.handle(invokeMethod)));

      assert.instanceOf(error, DesktopIpc.DesktopIpcRegistrationError);
      assert.isTrue(DesktopIpc.isDesktopIpcError(error));
      assert.strictEqual(error.handlerKind, "invoke");
      assert.strictEqual(error.channel, invokeMethod.channel);
      assert.strictEqual(error.cause, cause);
      assert.include(error.message, "invoke");
      assert.include(error.message, invokeMethod.channel);
      assert.notInclude(error.message, cause.message);
    }),
  );

  it.effect("preserves sync unregistration context and cause in the finalizer defect", () =>
    Effect.gen(function* () {
      const cause = new Error("sync unregistration failed");
      let removeCount = 0;
      const ipcMain = makeIpcMain({
        removeAllListeners: () => {
          removeCount += 1;
          if (removeCount === 2) throw cause;
        },
      });
      const ipc = DesktopIpc.make(ipcMain);

      const exit = yield* Effect.exit(Effect.scoped(ipc.handleSync(syncMethod)));

      assert.isTrue(exit._tag === "Failure");
      if (exit._tag === "Success") return;
      const error = Cause.squash(exit.cause);
      assert.instanceOf(error, DesktopIpc.DesktopIpcUnregistrationError);
      assert.isTrue(DesktopIpc.isDesktopIpcError(error));
      assert.strictEqual(error.handlerKind, "sync");
      assert.strictEqual(error.channel, syncMethod.channel);
      assert.strictEqual(error.cause, cause);
      assert.notInclude(error.message, cause.message);
    }),
  );
});

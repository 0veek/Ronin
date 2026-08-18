import { afterEach, beforeEach, describe, expect, it, vi } from "@effect/vitest";

import { onRunKeybindingCommand, runKeybindingCommand } from "./keybindingCommandBus";

/**
 * Frames are driven by hand so the handoff window is exercised deterministically
 * rather than by waiting on a real compositor.
 */
let pendingFrames: Array<FrameRequestCallback> = [];

function flushFrame(): void {
  const callbacks = pendingFrames;
  pendingFrames = [];
  for (const callback of callbacks) callback(0);
}

describe("keybindingCommandBus", () => {
  beforeEach(() => {
    pendingFrames = [];
    const eventTarget = new EventTarget();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.assign(eventTarget, {
        requestAnimationFrame: (callback: FrameRequestCallback) => pendingFrames.push(callback),
      }),
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("delivers to a listener that is already subscribed", () => {
    const received: string[] = [];
    const unsubscribe = onRunKeybindingCommand((command, markHandled) => {
      markHandled();
      received.push(command);
    });

    runKeybindingCommand("terminal.toggle");

    expect(received).toEqual(["terminal.toggle"]);
    unsubscribe();
  });

  it("re-offers the command until the owning view subscribes", () => {
    // The palette navigates to the thread route and dispatches before React has
    // mounted ChatView, so the first dispatch has nobody to claim it.
    runKeybindingCommand("terminal.toggle", { awaitHandler: true });

    const received: string[] = [];
    const unsubscribe = onRunKeybindingCommand((command, markHandled) => {
      markHandled();
      received.push(command);
    });

    flushFrame();
    expect(received).toEqual(["terminal.toggle"]);

    // Claimed, so nothing is left scheduled for a later frame.
    flushFrame();
    expect(received).toEqual(["terminal.toggle"]);
    unsubscribe();
  });

  it("gives up rather than firing at an unrelated moment later", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(0);

    runKeybindingCommand("terminal.toggle", { awaitHandler: true });

    // Past the handoff deadline a view that mounts later must not inherit it.
    now.mockReturnValue(5_000);
    flushFrame();

    const received: string[] = [];
    const unsubscribe = onRunKeybindingCommand((command, markHandled) => {
      markHandled();
      received.push(command);
    });

    flushFrame();

    expect(received).toEqual([]);
    unsubscribe();
    now.mockRestore();
  });

  it("does not retry without awaitHandler", () => {
    runKeybindingCommand("terminal.toggle");

    const received: string[] = [];
    const unsubscribe = onRunKeybindingCommand((command, markHandled) => {
      markHandled();
      received.push(command);
    });

    flushFrame();

    expect(received).toEqual([]);
    unsubscribe();
  });
});

// @vitest-environment jsdom
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useComposerTypingGuard } from "./useComposerTypingGuard";

let root: Root;
let host: HTMLDivElement;
let guard: ReturnType<typeof useComposerTypingGuard>;
function Probe({ scope, ids }: { scope: string; ids: string[] }) {
  const value = useComposerTypingGuard(scope, ids);
  useLayoutEffect(() => {
    guard = value;
  });
  return null;
}
function render(ids: string[], scope = "thread-a") {
  act(() => root.render(<Probe scope={scope} ids={ids} />));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("extends the idle deadline with further edits and releases once", () => {
  render([]);
  act(() => {
    guard.onFocus();
    guard.onDraftChange();
  });
  render(["approval"]);
  expect([...guard.heldRequestIds]).toEqual(["approval"]);
  act(() => vi.advanceTimersByTime(1000));
  act(() => guard.onDraftChange());
  act(() => vi.advanceTimersByTime(1499));
  expect([...guard.heldRequestIds]).toEqual(["approval"]);
  act(() => vi.advanceTimersByTime(1));
  expect([...guard.heldRequestIds]).toEqual([]);
  act(() => guard.onDraftChange());
  render(["approval", "question"]);
  expect([...guard.heldRequestIds]).toEqual(["question"]);
});
it.each(["onBlur", "onSend"] as const)("releases on %s and cancels its timer", (event) => {
  render([]);
  act(() => {
    guard.onFocus();
    guard.onDraftChange();
  });
  render(["approval"]);
  act(() => guard[event]());
  expect([...guard.heldRequestIds]).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
it("resets holds and typing history when the thread changes", () => {
  render([]);
  act(() => {
    guard.onFocus();
    guard.onDraftChange();
  });
  render(["approval"]);
  render(["question"], "thread-b");
  expect([...guard.heldRequestIds]).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
  act(() => guard.onDraftChange());
  render(["question", "next"], "thread-b");
  expect([...guard.heldRequestIds]).toEqual(["next"]);
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

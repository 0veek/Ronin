// @vitest-environment jsdom
import { act, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { observeResize } from "./observeResize";

let deliver: ResizeObserverCallback;
let observer: ResizeObserver;
const observed = new Set<Element>();
const stops: Array<() => void> = [];
const disconnect = vi.fn(() => observed.clear());
function entry(target: Element, width: number): ResizeObserverEntry {
  return { target, contentRect: { width, height: 20 } } as ResizeObserverEntry;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        deliver = callback;
        observer = this as unknown as ResizeObserver;
      }
      observe(target: Element) {
        observed.add(target);
      }
      unobserve(target: Element) {
        observed.delete(target);
      }
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it("commits resize-derived state before delivery returns", () => {
  const host = document.createElement("div");
  const measured = document.createElement("div");
  const root = createRoot(host);
  function Probe() {
    const [width, setWidth] = useState(0);
    useLayoutEffect(
      () => observeResize(measured, ([entry]) => setWidth(entry!.contentRect.width)),
      [],
    );
    return <span>{width}</span>;
  }
  act(() => root.render(<Probe />));
  try {
    act(() => {
      deliver([entry(measured, 240)], observer);
      expect(host.textContent).toBe("240");
    });
  } finally {
    act(() => root.unmount());
  }
  expect(observed.size).toBe(0);
});
it("batches all targets once per subscriber and keeps subscriptions independent", () => {
  const first = document.createElement("div");
  const second = document.createElement("div");
  const both = vi.fn();
  const onlyFirst = vi.fn();
  const stopBoth = observeResize([first, second], both);
  const stopFirst = observeResize(first, onlyFirst);
  stops.push(stopBoth, stopFirst);
  deliver([entry(first, 10), entry(second, 20)], observer);
  expect(both).toHaveBeenCalledTimes(1);
  expect(both.mock.calls[0]![0].map((item: ResizeObserverEntry) => item.target)).toEqual([
    first,
    second,
  ]);
  expect(onlyFirst).toHaveBeenCalledTimes(1);
  stopBoth();
  expect([...observed]).toEqual([first]);
  deliver([entry(first, 30)], observer);
  expect(both).toHaveBeenCalledTimes(1);
  expect(onlyFirst).toHaveBeenCalledTimes(2);
  stopFirst();
  stopFirst();
  expect(disconnect).toHaveBeenCalledTimes(1);
});
it("gives a late subscriber its initial size without repeating unchanged work for existing readers", () => {
  const target = document.createElement("div");
  const first = vi.fn();
  const late = vi.fn();
  stops.push(observeResize(target, first));
  deliver([entry(target, 50)], observer);
  stops.push(observeResize(target, late));
  deliver([entry(target, 50)], observer);
  expect(first).toHaveBeenCalledTimes(1);
  expect(late).toHaveBeenCalledTimes(1);
  deliver([entry(target, 70)], observer);
  expect(first).toHaveBeenCalledTimes(2);
  expect(late).toHaveBeenCalledTimes(2);
});
it("skips a subscriber removed by another callback in the same delivery", () => {
  const target = document.createElement("div");
  const removed = vi.fn();
  let stopRemoved = () => {};
  stops.push(observeResize(target, () => stopRemoved()));
  stops.push((stopRemoved = observeResize(target, removed)));
  deliver([entry(target, 50)], observer);
  expect(removed).not.toHaveBeenCalled();
});

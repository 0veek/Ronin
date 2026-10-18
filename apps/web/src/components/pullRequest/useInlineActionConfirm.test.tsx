// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useInlineActionConfirm } from "./useInlineActionConfirm";

let root: Root;
let host: HTMLDivElement;
let portal: HTMLDivElement;
const confirmed = vi.fn();
function Controls({ scope = "pr-a" }: { scope?: string }) {
  const confirm = useInlineActionConfirm(scope);
  const button = (id: string, action: string) => (
    <button id={id} {...confirm.props(action, () => confirmed(action))}>
      {confirm.isArmed(action) ? "Confirm?" : action}
    </button>
  );
  return (
    <>
      {button("merge", "merge")}
      {createPortal(button("close", "close"), portal)}
    </>
  );
}
function render(scope = "pr-a") {
  act(() => root.render(<Controls scope={scope} />));
}
function click(id: string) {
  act(() => document.getElementById(id)!.click());
}
beforeEach(() => {
  vi.useFakeTimers();
  confirmed.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  portal = document.createElement("div");
  document.body.append(host, portal);
  root = createRoot(host);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  portal.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("requires a second activation of the same control, including one in a portal", () => {
  click("merge");
  expect(confirmed).not.toHaveBeenCalled();
  expect(document.getElementById("merge")!.textContent).toBe("Confirm?");
  click("close");
  expect(confirmed).not.toHaveBeenCalled();
  expect(document.getElementById("merge")!.textContent).toBe("merge");
  click("close");
  expect(confirmed.mock.calls).toEqual([["close"]]);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["escape", "outside", "window-blur", "control-blur", "timeout", "scope"])(
  "cancels confirmation on %s",
  (reason) => {
    click("merge");
    act(() => {
      if (reason === "escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      if (reason === "outside")
        document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      if (reason === "window-blur") window.dispatchEvent(new Event("blur"));
      if (reason === "control-blur")
        document
          .getElementById("merge")!
          .dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      if (reason === "timeout") vi.advanceTimersByTime(3000);
    });
    if (reason === "scope") render("pr-b");
    click("merge");
    expect(confirmed).not.toHaveBeenCalled();
    click("merge");
    expect(confirmed.mock.calls).toEqual([["merge"]]);
  },
);
it("cleans up the timeout and listeners on unmount", () => {
  click("merge");
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(confirmed).not.toHaveBeenCalled();
  root = createRoot(host);
});

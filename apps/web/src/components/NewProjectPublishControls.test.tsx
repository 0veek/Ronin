// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { NewProjectPublishControls } from "./NewProjectPublishControls";
const targets = [
  { definition: { kind: "github", label: "GitHub" }, owner: "aveek" },
  { definition: { kind: "gitlab", label: "GitLab" }, owner: "group" },
] as const;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});
it("changes the host through the popup without toggling the enclosing publish row", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const toggle = vi.fn();
  const hostChange = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <div onClick={toggle} onPointerDown={(event) => event.preventDefault()}>
        <NewProjectPublishControls
          targets={targets}
          target={targets[0]}
          checked
          disabled={false}
          onHostChange={hostChange}
        />
      </div>,
    ),
  );
  const trigger = container.querySelector<HTMLButtonElement>(
    '[aria-label="Host for the new repository"]',
  )!;
  await act(async () => trigger.click());
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (option) => option.textContent === "GitLab",
  );
  expect(option).toBeDefined();
  await act(async () => option!.click());
  expect(hostChange).toHaveBeenCalledExactlyOnceWith("gitlab");
  expect(toggle).not.toHaveBeenCalled();
});

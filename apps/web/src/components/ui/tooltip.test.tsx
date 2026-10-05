// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

describe("timeline tooltip scroll dismissal", () => {
  it.each([
    "hover",
    "delayed hover",
    "focus",
    "hover then focus",
    "outside timeline",
    "wheel without scroll",
  ])("handles %s through the real tooltip interactions", async (scenario) => {
    const interaction = scenario;
    vi.unstubAllGlobals();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers();
    const { Tooltip, TooltipTrigger, TooltipPopup, TooltipScrollDismissArea } =
      await vi.importActual<typeof import("./tooltip")>("./tooltip");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onMouseEnter = vi.fn();
    const tooltip = (
      <Tooltip>
        <TooltipTrigger delay={50} onMouseEnter={onMouseEnter}>
          message link
        </TooltipTrigger>
        <TooltipPopup>https://example.com</TooltipPopup>
      </Tooltip>
    );
    try {
      await act(async () => {
        root.render(
          <>
            <TooltipScrollDismissArea>
              <div data-testid="scrollable">
                {interaction === "outside timeline" ? null : tooltip}
              </div>
            </TooltipScrollDismissArea>
            {interaction === "outside timeline" ? tooltip : null}
          </>,
        );
      });
      const trigger = container.querySelector<HTMLButtonElement>("button")!;
      const scrollable = container.querySelector<HTMLElement>('[data-testid="scrollable"]')!;
      await act(async () => {
        if (interaction !== "focus") {
          trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          trigger.dispatchEvent(new MouseEvent("mouseenter"));
          trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        }
        if (interaction === "focus" || interaction === "hover then focus") {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
          trigger.focus();
        }
        if (interaction !== "delayed hover") {
          await vi.advanceTimersByTimeAsync(60);
        }
      });
      expect(onMouseEnter).toHaveBeenCalledTimes(interaction === "focus" ? 0 : 1);
      expect(
        document.querySelector('[data-slot="tooltip-popup"][data-open]')?.textContent ?? null,
      ).toBe(interaction === "delayed hover" ? null : "https://example.com");

      await act(async () => {
        scrollable.dispatchEvent(
          interaction === "wheel without scroll"
            ? new WheelEvent("wheel", { bubbles: true, deltaY: 100 })
            : new Event("scroll"),
        );
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(
        document.querySelector('[data-slot="tooltip-popup"][data-open]')?.textContent ?? null,
      ).toBe(
        interaction === "hover" || interaction === "delayed hover" ? null : "https://example.com",
      );
      if (interaction === "focus" || interaction === "hover then focus") {
        expect(document.activeElement).toBe(trigger);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

import { ipcRenderer } from "electron";
import type { DesktopPreviewAnnotationTheme } from "@t3tools/contracts";

import {
  ANNOTATION_THEME_CHANNEL,
  MOUSE_NAVIGATE_CHANNEL,
  RECORDING_CONTROLLER_CHANNEL,
  RECORDING_CURSOR_CHANNEL,
  RECORDING_INPUT_CHANNEL,
  RECORDING_KEY_CHANNEL,
  RECORDING_POINTER_CHANNEL,
} from "./preview/GuestProtocol.ts";
import { installRecordingCursor } from "./preview/RecordingCursor.ts";
import { DEFAULT_RECORDING_INPUT_OPTIONS } from "./preview/RecordingInput.ts";

let annotationTheme: DesktopPreviewAnnotationTheme | null = null;
let recordingCursor: ReturnType<typeof installRecordingCursor> | null = null;
ipcRenderer.on(
  RECORDING_CURSOR_CHANNEL,
  (_event, active: unknown, inputOptions: unknown, controller: unknown) => {
    if (active === true) {
      const options =
        typeof inputOptions === "object" && inputOptions !== null
          ? {
              showKeyPresses:
                "showKeyPresses" in inputOptions && inputOptions.showKeyPresses === true,
              showMousePresses:
                "showMousePresses" in inputOptions && inputOptions.showMousePresses === true,
            }
          : DEFAULT_RECORDING_INPUT_OPTIONS;
      recordingCursor ??= installRecordingCursor(document, window, options, (input) =>
        ipcRenderer.send(RECORDING_INPUT_CHANNEL, input),
      );
      recordingCursor.setTheme(annotationTheme);
      if (controller === "agent" || controller === "human" || controller === "none") {
        recordingCursor.setController(controller);
      }
    } else {
      recordingCursor?.dispose();
      recordingCursor = null;
    }
  },
);
ipcRenderer.on(RECORDING_CONTROLLER_CHANNEL, (_event, controller: unknown, point: unknown) => {
  const humanPoint =
    typeof point === "object" &&
    point !== null &&
    "x" in point &&
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    "y" in point &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
      ? { x: point.x, y: point.y }
      : undefined;
  if (controller === "agent" || controller === "human" || controller === "none") {
    recordingCursor?.setController(controller, humanPoint);
  }
});
ipcRenderer.on(RECORDING_KEY_CHANNEL, (_event, input: unknown) => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("key" in input) ||
    typeof input.key !== "string"
  ) {
    return;
  }
  recordingCursor?.keyPress({
    key: input.key,
    metaKey: "metaKey" in input && input.metaKey === true,
    ctrlKey: "ctrlKey" in input && input.ctrlKey === true,
    altKey: "altKey" in input && input.altKey === true,
    shiftKey: "shiftKey" in input && input.shiftKey === true,
  });
});
ipcRenderer.on(RECORDING_POINTER_CHANNEL, (_event, point: unknown) => {
  if (
    typeof point === "object" &&
    point !== null &&
    "x" in point &&
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    "y" in point &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
  ) {
    recordingCursor?.move(
      { x: point.x, y: point.y },
      "phase" in point && point.phase === "click" ? "click" : "move",
    );
  }
});
ipcRenderer.on(ANNOTATION_THEME_CHANNEL, (_event, theme: DesktopPreviewAnnotationTheme) => {
  annotationTheme = theme;
  recordingCursor?.setTheme(theme);
});

// Mouse thumb buttons: `button === 3` is Back, `button === 4` is Forward.
const MOUSE_BUTTON_BACK = 3;
const MOUSE_BUTTON_FORWARD = 4;

const navigationDirectionForButton = (button: number): "back" | "forward" | null => {
  if (button === MOUSE_BUTTON_BACK) return "back";
  if (button === MOUSE_BUTTON_FORWARD) return "forward";
  return null;
};

// Chromium routes thumb-button history navigation to the *focused* WebContents,
// so hovering this guest without focusing it sends the host app's router back
// instead of the preview. Suppress Chromium's default here and drive this tab's
// history explicitly so the buttons always navigate the browser the pointer is
// over — never the host app.
const suppressNavigationButton = (event: MouseEvent): void => {
  if (!event.isTrusted || navigationDirectionForButton(event.button) === null) return;
  event.preventDefault();
  event.stopImmediatePropagation();
};

const requestNavigationForButton = (event: MouseEvent): void => {
  if (!event.isTrusted) return;
  const direction = navigationDirectionForButton(event.button);
  if (direction === null) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  ipcRenderer.send(MOUSE_NAVIGATE_CHANNEL, { direction });
};

window.addEventListener("mousedown", suppressNavigationButton, true);
window.addEventListener("mouseup", requestNavigationForButton, true);
window.addEventListener("auxclick", suppressNavigationButton, true);

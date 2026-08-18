import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type * as Electron from "electron";

import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronMenu from "../electron/ElectronMenu.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

export class DesktopApplicationMenuActionError extends Schema.TaggedErrorClass<DesktopApplicationMenuActionError>()(
  "DesktopApplicationMenuActionError",
  {
    action: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop menu action "${this.action}" failed.`;
  }
}

export class DesktopApplicationMenu extends Context.Service<
  DesktopApplicationMenu,
  {
    readonly configure: Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopApplicationMenu") {}

type DesktopApplicationMenuRuntimeServices =
  | DesktopWindow.DesktopWindow
  | ElectronDialog.ElectronDialog
  | ElectronShell.ElectronShell;

/**
 * Documentation the Help menu points at. Kept next to the menu that opens it so
 * a moved page is a one-line change here rather than a hunt through templates.
 */
const DOCUMENTATION_URL = "https://github.com/t3dotgg/ronin";
const ISSUES_URL = "https://github.com/t3dotgg/ronin/issues";

const { logError: logMenuError } = makeComponentLogger("desktop-menu");

const dispatchMenuAction = Effect.fn("desktop.menu.dispatchMenuAction")(function* (
  action: string,
): Effect.fn.Return<void, DesktopWindow.DesktopWindowError, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.dispatchMenuAction(action);
});

const openExternalUrl = Effect.fn("desktop.menu.openExternalUrl")(function* (
  url: string,
): Effect.fn.Return<void, never, ElectronShell.ElectronShell> {
  const shell = yield* ElectronShell.ElectronShell;
  yield* shell.openExternal(url);
});

const zoomMainWindow = Effect.fn("desktop.menu.zoomMainWindow")(function* (
  direction: DesktopWindow.MainWindowZoomDirection,
): Effect.fn.Return<void, never, DesktopWindow.DesktopWindow> {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  yield* desktopWindow.zoomMain(direction);
});

export const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronMenu = yield* ElectronMenu.ElectronMenu;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const appName = yield* electronApp.name;
  const context = yield* Effect.context<DesktopApplicationMenuRuntimeServices>();
  const runPromise = Effect.runPromiseWith(context);

  const runMenuEffect = <E>(
    action: string,
    effect: Effect.Effect<void, E, DesktopApplicationMenuRuntimeServices>,
  ) => {
    void runPromise(
      effect.pipe(
        Effect.annotateLogs({ action }),
        Effect.withSpan("desktop.menu.action"),
        Effect.catchCause((cause) => {
          const error = new DesktopApplicationMenuActionError({ action, cause });
          return logMenuError(error.message, { error });
        }),
      ),
    );
  };

  const configure = Effect.gen(function* () {
    const settingsClick = () => {
      runMenuEffect("open-settings", dispatchMenuAction("open-settings"));
    };
    const zoomClick = (direction: DesktopWindow.MainWindowZoomDirection) => () => {
      runMenuEffect(`zoom-${direction}`, zoomMainWindow(direction));
    };
    /*
      Menu items route through the same action names the command palette and the
      keybindings use, so a destination has one implementation in the renderer no
      matter which of the three surfaces reached it.
    */
    const actionClick = (action: string) => () => {
      runMenuEffect(action, dispatchMenuAction(action));
    };
    const externalClick = (action: string, url: string) => () => {
      runMenuEffect(action, openExternalUrl(url));
    };
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (environment.platform === "darwin") {
      template.push({
        label: appName,
        submenu: [
          { role: "about" },
          { type: "separator" },
          {
            label: "Settings...",
            accelerator: "CmdOrCtrl+,",
            click: settingsClick,
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      });
    }

    template.push(
      {
        label: "File",
        submenu: [
          {
            label: "New Thread",
            accelerator: "CmdOrCtrl+N",
            click: actionClick("new-thread"),
          },
          { type: "separator" as const },
          ...(environment.platform === "darwin"
            ? []
            : [
                {
                  label: "Settings...",
                  accelerator: "CmdOrCtrl+,",
                  click: settingsClick,
                },
                { type: "separator" as const },
              ]),
          { role: environment.platform === "darwin" ? "close" : "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          ...(environment.isDevelopment
            ? ([
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
              ] as const)
            : []),
          /*
            Not the zoom roles: those act on the focused webContents, so with
            an embedded preview WebContentsView focused they zoom the guest
            page and the app UI appears stuck. These always zoom the main
            window (see DesktopWindow.zoomMain).
          */
          { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: zoomClick("reset") },
          { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: zoomClick("in") },
          {
            label: "Zoom In",
            accelerator: "CmdOrCtrl+Plus",
            visible: false,
            click: zoomClick("in"),
          },
          { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: zoomClick("out") },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Go",
        submenu: [
          {
            label: "Command Palette...",
            accelerator: "CmdOrCtrl+K",
            click: actionClick("open-command-palette"),
          },
          { type: "separator" },
          { label: "Threads", click: actionClick("go-threads") },
          { label: "Board", click: actionClick("go-board") },
          { label: "Pull Requests", click: actionClick("go-pull-requests") },
          { label: "Usage", click: actionClick("go-usage") },
        ],
      },
      { role: "windowMenu" },
      {
        role: "help",
        submenu: [
          {
            label: "Keyboard Shortcuts",
            click: actionClick("open-keyboard-shortcuts"),
          },
          { type: "separator" },
          {
            label: "Documentation",
            click: externalClick("open-documentation", DOCUMENTATION_URL),
          },
          {
            label: "Report an Issue",
            click: externalClick("report-issue", ISSUES_URL),
          },
        ],
      },
    );

    yield* electronMenu.setApplicationMenu(template);
  }).pipe(Effect.withSpan("desktop.menu.configure"));

  return DesktopApplicationMenu.of({
    configure,
  });
});

export const layer = Layer.effect(DesktopApplicationMenu, make);

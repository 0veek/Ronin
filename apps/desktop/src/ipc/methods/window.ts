import {
  ContextMenuItemSchema,
  DesktopAppBrandingSchema,
  DesktopEnvironmentBootstrapSchema,
  DesktopThemeSchema,
  EDITORS,
  EditorId,
  PickedThemeFileSchema,
  PickFolderOptionsSchema,
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  REMOTE_CAPABLE_EDITOR_IDS,
  type DesktopEnvironmentBootstrap,
  type PickedThemeFile,
} from "@t3tools/contracts";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as NodeOS from "node:os";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "../../backend/DesktopLocalEnvironmentAuth.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronMenu from "../../electron/ElectronMenu.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const ContextMenuPosition = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

const ContextMenuInput = Schema.Struct({
  items: Schema.Array(ContextMenuItemSchema),
  position: Schema.optionalKey(ContextMenuPosition),
});

function toWebSocketBaseUrl(httpBaseUrl: URL): string {
  const url = new URL(httpBaseUrl.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export const getAppBranding = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_APP_BRANDING_CHANNEL,
  result: Schema.NullOr(DesktopAppBrandingSchema),
  handler: Effect.fn("desktop.ipc.window.getAppBranding")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return environment.branding;
  }),
});

export const getWindowFullscreenState = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_WINDOW_FULLSCREEN_STATE_CHANNEL,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.getWindowFullscreenState")(function* () {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.currentMainOrFirst;
    return Option.isSome(window) && window.value.isFullScreen();
  }),
});

export const getLocalEnvironmentBootstraps = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL,
  result: Schema.Array(DesktopEnvironmentBootstrapSchema),
  handler: Effect.fn("desktop.ipc.window.getLocalEnvironmentBootstraps")(function* () {
    const pool = yield* DesktopBackendPool.DesktopBackendPool;
    const instances = yield* pool.list;
    const bootstraps: DesktopEnvironmentBootstrap[] = [];
    for (const instance of instances) {
      const isPrimary = instance.id === PRIMARY_LOCAL_ENVIRONMENT_ID;
      const config = yield* instance.currentConfig;
      const snapshot = yield* instance.snapshot;
      // A secondary backend that hasn't produced a config yet (mid-registration,
      // before its first start cycle) or that is retrying a *transient* preflight
      // failure is not listening on a port. Surface it as a *pending* bootstrap
      // (null endpoints, no token) so the renderer can show a "Connecting…"
      // indicator while it retries — null endpoints keep the renderer from
      // dialing the dead port.
      if (Option.isNone(config) || Option.isSome(config.value.preflightFailure)) {
        // Skip the primary (same-origin, no "connecting" affordance) and skip a
        // secondary whose preflight failed *fatally* or stopped retrying: an
        // indefinite "Connecting…" would be misleading.
        const fatalPreflight =
          Option.isSome(config) &&
          Option.isSome(config.value.preflightFailure) &&
          config.value.preflightFailure.value.fatal;
        const stoppedPreflight =
          Option.isSome(config) &&
          Option.isSome(config.value.preflightFailure) &&
          (!snapshot.desiredRunning || !snapshot.restartScheduled);
        if (isPrimary || fatalPreflight || stoppedPreflight) continue;
        bootstraps.push({
          id: instance.id,
          label: yield* instance.label,
          runningDistro: null,
          httpBaseUrl: null,
          wsBaseUrl: null,
        });
        continue;
      }
      const { bootstrap, httpBaseUrl } = config.value;
      const runningDistro = config.value.runningDistro ?? null;
      bootstraps.push({
        id: instance.id,
        label: yield* instance.label,
        runningDistro,
        httpBaseUrl: httpBaseUrl.href,
        wsBaseUrl: toWebSocketBaseUrl(httpBaseUrl),
        ...(bootstrap.desktopBootstrapToken
          ? { bootstrapToken: bootstrap.desktopBootstrapToken }
          : {}),
      });
    }
    return bootstraps;
  }),
});

export const getLocalEnvironmentBearerToken = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_BEARER_TOKEN_CHANNEL,
  payload: Schema.Void,
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.window.getLocalEnvironmentBearerToken")(function* () {
    const localAuth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
    return yield* localAuth.getBearerToken;
  }),
});

export const pickFolder = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PICK_FOLDER_CHANNEL,
  payload: Schema.UndefinedOr(PickFolderOptionsSchema),
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.window.pickFolder")(function* (options) {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    // targetEnvironmentId is accepted for schema compatibility but ignored for
    // routing — folder picks always use the native primary-environment dialog.
    void options?.targetEnvironmentId;
    const selectedPath = yield* dialog.pickFolder({
      owner: yield* electronWindow.focusedMainOrFirst,
      defaultPath: environment.resolvePickFolderDefaultPath(options),
    });
    return Option.getOrNull(selectedPath);
  }),
});

export const setTheme = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_THEME_CHANNEL,
  payload: DesktopThemeSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.setTheme")(function* (theme) {
    const electronTheme = yield* ElectronTheme.ElectronTheme;
    yield* electronTheme.setSource(theme);
  }),
});

export const showContextMenu = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CONTEXT_MENU_CHANNEL,
  payload: ContextMenuInput,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.window.showContextMenu")(function* (input) {
    const electronMenu = yield* ElectronMenu.ElectronMenu;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.focusedMainOrFirst;
    if (Option.isNone(window)) {
      return null;
    }

    const selectedItemId = yield* electronMenu.showContextMenu({
      window: window.value,
      items: input.items,
      position: Option.fromNullishOr(input.position),
    });
    return Option.getOrNull(selectedItemId);
  }),
});

export const openExternal = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_EXTERNAL_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.openExternal")(function* (url) {
    const shell = yield* ElectronShell.ElectronShell;
    return yield* shell.openExternal(url);
  }),
});

export const probeRemoteEditors = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PROBE_REMOTE_EDITORS_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Array(EditorId),
  // Probes THIS machine (where the renderer runs) for remote-capable editor
  // CLIs, unlike the server's probe which walks the environment host's PATH.
  // A Finder-launched app can miss PATH entries; an empty result makes the
  // renderer fall back to VS Code only, so that fails soft.
  handler: Effect.fn("desktop.ipc.window.probeRemoteEditors")(function* () {
    const available: Array<EditorId> = [];
    for (const editorId of REMOTE_CAPABLE_EDITOR_IDS) {
      const commands = EDITORS.find((editor) => editor.id === editorId)?.commands;
      if (!commands) continue;
      for (const command of commands) {
        if (yield* isCommandAvailable(command, { env: process.env })) {
          available.push(editorId);
          break;
        }
      }
    }
    return available;
  }),
});

/**
 * Backs notification clicks. The renderer's own `window.focus()` cannot
 * restore a minimized or hidden window, so the click asks the main process to
 * reveal it properly. A missing window is a no-op, not an error: the click
 * may race a quit.
 */
export const focusWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FOCUS_WINDOW_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.focusWindow")(function* () {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.focusedMainOrFirst;
    if (Option.isNone(window)) {
      return;
    }
    yield* electronWindow.reveal(window.value);
  }),
});

/** Theme files are a few KB; anything larger returns empty text and lets the
 *  renderer reject it by size without the contents ever crossing the bridge. */
const PICKED_THEME_FILE_MAX_BYTES = 256 * 1024;

export const pickThemeFiles = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PICK_THEME_FILES_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.NullOr(Schema.Array(PickedThemeFileSchema)),
  handler: Effect.fn("desktop.ipc.window.pickThemeFiles")(function* () {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // The VS Code extensions directory is the same dotfolder on Windows,
    // macOS, and Linux; when it is missing the picker opens wherever the
    // platform would by default.
    const extensionsDir = path.join(NodeOS.homedir(), ".vscode", "extensions");
    const defaultPath = yield* fileSystem
      .exists(extensionsDir)
      .pipe(Effect.orElseSucceed(() => false));
    const paths = yield* dialog.pickFiles({
      owner: yield* electronWindow.focusedMainOrFirst,
      defaultPath: defaultPath ? Option.some(extensionsDir) : Option.none(),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (paths.length === 0) {
      return null;
    }
    return yield* Effect.forEach(paths, (filePath) => {
      const name = path.basename(filePath);
      return Effect.gen(function* () {
        const info = yield* fileSystem.stat(filePath);
        const size = Number(info.size);
        if (size > PICKED_THEME_FILE_MAX_BYTES) {
          return { name, size, text: "" } satisfies PickedThemeFile;
        }
        const text = yield* fileSystem.readFileString(filePath);
        return { name, size, text } satisfies PickedThemeFile;
      }).pipe(
        // An unreadable file degrades to an entry the renderer reports.
        Effect.orElseSucceed((): PickedThemeFile => ({ name, size: 0, text: "" })),
      );
    });
  }),
});

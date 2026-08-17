import { DesktopAppUpdateStateSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAutoUpdate from "../../app/DesktopAutoUpdate.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getAppUpdateState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_APP_UPDATE_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopAppUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.appUpdate.getState")(function* () {
    const autoUpdate = yield* DesktopAutoUpdate.DesktopAutoUpdate;
    return yield* autoUpdate.getState;
  }),
});

export const checkAppUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CHECK_APP_UPDATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopAppUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.appUpdate.check")(function* () {
    const autoUpdate = yield* DesktopAutoUpdate.DesktopAutoUpdate;
    return yield* autoUpdate.check;
  }),
});

export const downloadAppUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.DOWNLOAD_APP_UPDATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopAppUpdateStateSchema,
  handler: Effect.fn("desktop.ipc.appUpdate.download")(function* () {
    const autoUpdate = yield* DesktopAutoUpdate.DesktopAutoUpdate;
    return yield* autoUpdate.download;
  }),
});

export const installAppUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.INSTALL_APP_UPDATE_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.appUpdate.install")(function* () {
    const autoUpdate = yield* DesktopAutoUpdate.DesktopAutoUpdate;
    // Quits the app on success, so this call is not expected to resolve.
    yield* autoUpdate.installAndRestart;
  }),
});

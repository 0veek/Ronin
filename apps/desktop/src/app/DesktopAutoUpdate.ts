import type { DesktopAppUpdateState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

/**
 * Wraps electron-updater so the packaged app can fetch, stage, and install a
 * GitHub release without sending the user to a download page.
 *
 * electron-builder writes the publish config into `app-update.yml` at package
 * time, so nothing here needs to know the repository: whatever
 * `T3CODE_DESKTOP_UPDATE_REPOSITORY` (or `GITHUB_REPOSITORY`) pointed at during
 * the release build is what the app checks.
 */

/** The slice of electron-updater's `autoUpdater` this service drives. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  channel: string | null;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: (event: string, listener: (payload: never) => void) => unknown;
}

export class DesktopAutoUpdate extends Context.Service<
  DesktopAutoUpdate,
  {
    readonly getState: Effect.Effect<DesktopAppUpdateState>;
    readonly check: Effect.Effect<DesktopAppUpdateState>;
    readonly download: Effect.Effect<DesktopAppUpdateState>;
    readonly installAndRestart: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopAutoUpdate") {}

export interface UpdateSupport {
  readonly supported: boolean;
  readonly reason?: string;
}

/**
 * Stand-in for builds that must not self-update, so the caller never has to
 * load electron-updater just to be told it is unsupported.
 */
export const noopUpdater: UpdaterLike = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowDowngrade: false,
  channel: null,
  checkForUpdates: () => Promise.resolve(null),
  downloadUpdate: () => Promise.resolve(null),
  quitAndInstall: () => {},
  on: () => undefined,
};

/**
 * A build another package manager owns must not swap its own binaries out from
 * under that manager. electron-updater already refuses on Linux outside
 * AppImage; deciding it here lets the UI say why instead of failing at download.
 */
export function resolveUpdateSupport(input: {
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly appImagePath: string | undefined;
}): UpdateSupport {
  if (!input.isPackaged) {
    return { supported: false, reason: "Development builds do not update themselves." };
  }
  if (input.platform === "linux" && !input.appImagePath) {
    return {
      supported: false,
      reason: "This Linux build is installed by a package manager, which handles its updates.",
    };
  }
  return { supported: true };
}

export function toErrorMessage(cause: unknown): string {
  const fallback = "The update failed for an unknown reason.";
  if (cause instanceof Error) {
    // Effect.tryPromise wraps the rejection in its own error and keeps the
    // original on `cause`; the inner one is what the user can act on.
    const inner = (cause as { cause?: unknown }).cause;
    if (inner instanceof Error) {
      const innerMessage = inner.message.trim();
      if (innerMessage.length > 0) return innerMessage;
    }
    // A blank Error must not surface as its stringified form ("Error:").
    const message = cause.message.trim();
    return message.length > 0 ? message : fallback;
  }
  const text = String(cause).trim();
  return text.length > 0 ? text : fallback;
}

/**
 * Effect hands `catchCause` a Cause, whose stringified form is an internal
 * dump ("Cause([Fail(UnknownError: ...").  Squash back to the underlying
 * error so the user reads the real failure.
 */
export function causeToErrorMessage(cause: Cause.Cause<unknown>): string {
  return toErrorMessage(Cause.squash(cause));
}

/**
 * electron-builder only writes `app-update.yml` into the package when the build
 * had publish config. Without it the app cannot self-update at all -- that is a
 * property of how it was built, not a failure worth alarming anyone about, so
 * it degrades to the same link-out the web app uses.
 */
export function isMissingUpdateConfig(message: string): boolean {
  return /app-update\.yml/i.test(message) && /ENOENT|no such file/i.test(message);
}

/** Progress arrives off the network and drives a bar, so clamp rather than trust. */
export function normalizePercent(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normalizeBytesPerSecond(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

export const make = Effect.fnUntraced(function* (options: {
  readonly updater: UpdaterLike;
  readonly support: UpdateSupport;
  readonly channel?: string | null;
  readonly onStateChange: (state: DesktopAppUpdateState) => void;
}) {
  const stateRef = yield* Ref.make<DesktopAppUpdateState>(
    options.support.supported
      ? { status: "idle" }
      : {
          status: "unsupported",
          ...(options.support.reason ? { message: options.support.reason } : {}),
        },
  );

  const publish = (next: DesktopAppUpdateState) =>
    Ref.set(stateRef, next).pipe(Effect.andThen(Effect.sync(() => options.onStateChange(next))));

  if (!options.support.supported) {
    const frozen = Ref.get(stateRef);
    return DesktopAutoUpdate.of({
      getState: frozen,
      check: frozen,
      download: frozen,
      installAndRestart: Effect.void,
    });
  }

  const updater = options.updater;
  // Downloading is the user's call: a silent background download spends their
  // bandwidth without asking. Staging an already-downloaded update on quit is
  // free, so that stays on.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  if (options.channel) {
    updater.channel = options.channel;
  }

  // electron-updater is an EventEmitter, so these fire outside the Effect
  // runtime; each handler just writes the Ref and notifies the renderer.
  const emit = (next: DesktopAppUpdateState) => {
    Effect.runSync(publish(next));
  };

  updater.on("update-available", ((info: { version?: string }) => {
    emit({ status: "available", ...(info?.version ? { version: info.version } : {}) });
  }) as (payload: never) => void);
  updater.on("update-not-available", (() => {
    emit({ status: "idle" });
  }) as (payload: never) => void);
  updater.on("download-progress", ((progress: { percent?: number; bytesPerSecond?: number }) => {
    const percent = normalizePercent(progress?.percent);
    const speed = normalizeBytesPerSecond(progress?.bytesPerSecond);
    emit({
      status: "downloading",
      ...(percent !== undefined ? { percent } : {}),
      ...(speed !== undefined ? { bytesPerSecond: speed } : {}),
    });
  }) as (payload: never) => void);
  updater.on("update-downloaded", ((info: { version?: string }) => {
    emit({ status: "ready", ...(info?.version ? { version: info.version } : {}) });
  }) as (payload: never) => void);
  // A build with no embedded update config can never self-update, so report it
  // as unsupported rather than as a failed attempt the user could retry.
  const toFailureState = (message: string): DesktopAppUpdateState =>
    isMissingUpdateConfig(message)
      ? {
          status: "unsupported",
          message: "This build was packaged without update settings.",
        }
      : { status: "error", message };

  updater.on("error", ((cause: unknown) => {
    emit(toFailureState(toErrorMessage(cause)));
  }) as (payload: never) => void);

  const failWith = (cause: Cause.Cause<unknown>) => {
    const next = toFailureState(causeToErrorMessage(cause));
    return publish(next).pipe(Effect.as(next));
  };

  const check = Effect.gen(function* () {
    yield* publish({ status: "checking" });
    return yield* Effect.tryPromise(() => updater.checkForUpdates()).pipe(
      // The update-available / update-not-available listeners set the real
      // state; this only needs to survive a rejected check.
      Effect.andThen(Ref.get(stateRef)),
      Effect.catchCause(failWith),
    );
  });

  const download = Effect.gen(function* () {
    const current = yield* Ref.get(stateRef);
    // Re-downloading would restart the transfer and reset visible progress.
    if (current.status === "downloading" || current.status === "ready") {
      return current;
    }
    yield* publish({
      status: "downloading",
      ...(current.version ? { version: current.version } : {}),
      percent: 0,
    });
    return yield* Effect.tryPromise(() => updater.downloadUpdate()).pipe(
      Effect.andThen(Ref.get(stateRef)),
      Effect.catchCause(failWith),
    );
  });

  const installAndRestart = Effect.gen(function* () {
    const current = yield* Ref.get(stateRef);
    // Quitting before the artifact is staged would close the app for nothing.
    if (current.status !== "ready") {
      return;
    }
    yield* Effect.try(() => {
      updater.quitAndInstall(false, true);
    }).pipe(Effect.catchCause((cause) => failWith(cause).pipe(Effect.asVoid)));
  });

  return DesktopAutoUpdate.of({
    getState: Ref.get(stateRef),
    check,
    download,
    installAndRestart,
  });
});

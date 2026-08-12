import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

export interface DesktopIpcWebContents {
  readonly mainFrame: unknown;
  getURL(): string;
  isDestroyed(): boolean;
}

export interface DesktopIpcSenderFrame {
  readonly url: string;
}

export interface DesktopIpcOwnerWindow {
  readonly webContents: DesktopIpcWebContents;
  isDestroyed(): boolean;
}

export interface DesktopIpcInvokeEvent {
  readonly sender?: DesktopIpcWebContents;
  readonly senderFrame?: DesktopIpcSenderFrame | null;
}

export interface DesktopIpcSyncEvent extends DesktopIpcInvokeEvent {
  returnValue: unknown;
}

export type DesktopIpcSenderAuthorizer = (event: DesktopIpcInvokeEvent) => boolean;

const TRUSTED_DESKTOP_PROTOCOLS = new Set(["t3code:", "t3code-dev:"]);

export function isTrustedDesktopIpcSender(input: {
  readonly event: DesktopIpcInvokeEvent;
  readonly resolveOwner: (sender: DesktopIpcWebContents) => DesktopIpcOwnerWindow | null;
}): boolean {
  try {
    const { sender, senderFrame } = input.event;
    if (!sender || !senderFrame || sender.isDestroyed() || senderFrame !== sender.mainFrame) {
      return false;
    }
    const owner = input.resolveOwner(sender);
    if (!owner || owner.isDestroyed() || owner.webContents !== sender) {
      return false;
    }
    const url = new URL(senderFrame.url || sender.getURL());
    return (
      TRUSTED_DESKTOP_PROTOCOLS.has(url.protocol) &&
      url.hostname === "app" &&
      url.username === "" &&
      url.password === "" &&
      url.port === ""
    );
  } catch {
    return false;
  }
}

export type DesktopIpcHandleListener = (
  event: DesktopIpcInvokeEvent,
  raw: unknown,
) => unknown | Promise<unknown>;

export type DesktopIpcSyncListener = (event: DesktopIpcSyncEvent) => void;

export interface DesktopIpcMain {
  removeHandler(channel: string): void;
  handle(channel: string, listener: DesktopIpcHandleListener): void;
  removeAllListeners(channel: string): void;
  on(channel: string, listener: DesktopIpcSyncListener): void;
}

export class DesktopIpcRegistrationError extends Schema.TaggedErrorClass<DesktopIpcRegistrationError>()(
  "DesktopIpcRegistrationError",
  {
    handlerKind: Schema.Literals(["invoke", "sync"]),
    channel: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to register the ${this.handlerKind} IPC handler for ${this.channel}.`;
  }
}

export class DesktopIpcUnregistrationError extends Schema.TaggedErrorClass<DesktopIpcUnregistrationError>()(
  "DesktopIpcUnregistrationError",
  {
    handlerKind: Schema.Literals(["invoke", "sync"]),
    channel: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister the ${this.handlerKind} IPC handler for ${this.channel}.`;
  }
}

export class DesktopIpcUnauthorizedSenderError extends Schema.TaggedErrorClass<DesktopIpcUnauthorizedSenderError>()(
  "DesktopIpcUnauthorizedSenderError",
  {
    channel: Schema.String,
  },
) {
  override get message(): string {
    return `Rejected unauthorized IPC sender for ${this.channel}.`;
  }
}

export const DesktopIpcError = Schema.Union([
  DesktopIpcRegistrationError,
  DesktopIpcUnregistrationError,
]);
export type DesktopIpcError = typeof DesktopIpcError.Type;
export const isDesktopIpcError = Schema.is(DesktopIpcError);

export interface DesktopIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: (raw: unknown) => Effect.Effect<unknown, E, R>;
}

export interface DesktopSyncIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: () => Effect.Effect<unknown, E, R>;
}

export class DesktopIpc extends Context.Service<
  DesktopIpc,
  {
    readonly handle: <E, R>(
      input: DesktopIpcMethod<E, R>,
    ) => Effect.Effect<void, DesktopIpcRegistrationError, R | Scope.Scope>;
    readonly handleSync: <E, R>(
      input: DesktopSyncIpcMethod<E, R>,
    ) => Effect.Effect<void, DesktopIpcRegistrationError, R | Scope.Scope>;
  }
>()("@t3tools/desktop/ipc/DesktopIpc") {}

export const make = (
  ipcMain: DesktopIpcMain,
  isTrustedSender: DesktopIpcSenderAuthorizer = () => false,
): DesktopIpc["Service"] =>
  DesktopIpc.of({
    handle: Effect.fn("desktop.ipc.registerInvoke")(function* <E, R>({
      channel,
      handler,
    }: DesktopIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            ipcMain.removeHandler(channel);
            ipcMain.handle(channel, (event, raw) =>
              runPromise(
                Effect.gen(function* () {
                  yield* Effect.annotateCurrentSpan({ channel });
                  if (!isTrustedSender(event)) {
                    return yield* new DesktopIpcUnauthorizedSenderError({ channel });
                  }
                  return yield* handler(raw);
                }).pipe(Effect.annotateLogs({ channel }), Effect.withSpan("desktop.ipc.invoke")),
              ),
            );
          },
          catch: (cause) =>
            new DesktopIpcRegistrationError({ handlerKind: "invoke", channel, cause }),
        }),
        () =>
          Effect.try({
            try: () => ipcMain.removeHandler(channel),
            catch: (cause) =>
              new DesktopIpcUnregistrationError({ handlerKind: "invoke", channel, cause }),
          }).pipe(Effect.orDie),
      );
    }),

    handleSync: Effect.fn("desktop.ipc.registerSync")(function* <E, R>({
      channel,
      handler,
    }: DesktopSyncIpcMethod<E, R>) {
      yield* Effect.annotateCurrentSpan({ channel });
      const context = yield* Effect.context<R>();
      const runSync = Effect.runSyncWith(context);

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            ipcMain.removeAllListeners(channel);
            ipcMain.on(channel, (event) => {
              event.returnValue = runSync(
                Effect.gen(function* () {
                  yield* Effect.annotateCurrentSpan({ channel });
                  if (!isTrustedSender(event)) {
                    return yield* new DesktopIpcUnauthorizedSenderError({ channel });
                  }
                  return yield* handler();
                }).pipe(
                  Effect.annotateLogs({ channel }),
                  Effect.withSpan("desktop.ipc.invokeSync"),
                ),
              );
            });
          },
          catch: (cause) =>
            new DesktopIpcRegistrationError({ handlerKind: "sync", channel, cause }),
        }),
        () =>
          Effect.try({
            try: () => ipcMain.removeAllListeners(channel),
            catch: (cause) =>
              new DesktopIpcUnregistrationError({ handlerKind: "sync", channel, cause }),
          }).pipe(Effect.orDie),
      );
    }),
  });

export const layer = (ipcMain: DesktopIpcMain, isTrustedSender: DesktopIpcSenderAuthorizer) =>
  Layer.succeed(DesktopIpc, make(ipcMain, isTrustedSender));

/**
 * Convenience helpers for creating IPC methods
 */

export interface DesktopIpcMethodRegistration<
  Payload,
  EncodedPayload,
  Result,
  EncodedResult,
  E,
  R,
  PayloadDecodingServices = never,
  PayloadEncodingServices = never,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
> {
  readonly channel: string;
  readonly payload: Schema.Codec<
    Payload,
    EncodedPayload,
    PayloadDecodingServices,
    PayloadEncodingServices
  >;
  readonly result: Schema.Codec<
    Result,
    EncodedResult,
    ResultDecodingServices,
    ResultEncodingServices
  >;
  readonly handler: (input: Payload) => Effect.Effect<Result, E, R>;
}

export const makeIpcMethod = <
  Payload,
  EncodedPayload,
  Result,
  EncodedResult,
  E,
  R,
  PayloadDecodingServices = never,
  PayloadEncodingServices = never,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
>(
  method: DesktopIpcMethodRegistration<
    Payload,
    EncodedPayload,
    Result,
    EncodedResult,
    E,
    R,
    PayloadDecodingServices,
    PayloadEncodingServices,
    ResultDecodingServices,
    ResultEncodingServices
  >,
): DesktopIpcMethod<
  E | Schema.SchemaError,
  R | PayloadDecodingServices | ResultEncodingServices
> => {
  const decode = Schema.decodeUnknownEffect(method.payload);
  const encode = Schema.encodeUnknownEffect(method.result);

  return {
    channel: method.channel,
    handler: (raw) =>
      decode(raw).pipe(
        Effect.flatMap(method.handler),
        Effect.flatMap(encode),
        Effect.withSpan("desktop.ipc.method", { attributes: { channel: method.channel } }),
      ),
  };
};

export interface DesktopSyncIpcMethodRegistration<
  Result,
  EncodedResult,
  E,
  R,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
> {
  readonly channel: string;
  readonly result: Schema.Codec<
    Result,
    EncodedResult,
    ResultDecodingServices,
    ResultEncodingServices
  >;
  readonly handler: () => Effect.Effect<Result, E, R>;
}

export const makeSyncIpcMethod = <
  Result,
  EncodedResult,
  E,
  R,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
>(
  method: DesktopSyncIpcMethodRegistration<
    Result,
    EncodedResult,
    E,
    R,
    ResultDecodingServices,
    ResultEncodingServices
  >,
): DesktopSyncIpcMethod<E | Schema.SchemaError, R | ResultEncodingServices> => {
  const encode = Schema.encodeUnknownEffect(method.result);

  return {
    channel: method.channel,
    handler: () =>
      method
        .handler()
        .pipe(
          Effect.flatMap(encode),
          Effect.withSpan("desktop.ipc.method", { attributes: { channel: method.channel } }),
        ),
  };
};

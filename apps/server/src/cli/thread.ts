import {
  AuthAdministrativeScopes,
  ClientOrchestrationCommand,
  CommandId,
  DEFAULT_RUNTIME_MODE,
  EnvironmentHttpApi,
  MessageId,
  ModelSelection,
  ORCHESTRATION_PROTOCOL_VERSION,
  ORCHESTRATION_WS_METHODS,
  ThreadId,
  WsRpcGroup,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type ThreadMessageWaitResult,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as References from "effect/References";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Socket from "effect/unstable/socket/Socket";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { projectLocationFlags, resolveCliAuthConfig, type CliAuthLocationFlags } from "./config.ts";

export class ThreadCliError extends Schema.TaggedErrorClass<ThreadCliError>()("ThreadCliError", {
  detail: Schema.String,
  exitCode: Schema.optionalKey(Schema.Number),
}) {
  override readonly [Runtime.errorReported] = false;
  override get [Runtime.errorExitCode]() {
    return this.exitCode ?? 1;
  }
  override get message() {
    return this.detail;
  }
}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeModel = Schema.decodeUnknownEffect(ModelSelection);
const decodeCommand = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
const printJson = (value: unknown) => Console.log(encodeJson(value));
const usage = (detail: string) => new ThreadCliError({ detail });
const isThreadCliError = Schema.is(ThreadCliError);
const randomId = Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4));
const reportErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      isThreadCliError(cause)
        ? cause
        : usage(cause instanceof Error ? cause.message : "Thread command failed."),
    ),
    Effect.tapError((error) => Console.error(error.detail)),
  );

export const resolveThreadProject = Effect.fn("resolveThreadProject")(function* (
  projects: ReadonlyArray<OrchestrationProjectShell>,
  identifier: string,
) {
  const active = projects;
  const byId = active.find((project) => project.id === identifier);
  if (byId) return byId;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const realPath = (value: string) => fs.realPath(value).pipe(Effect.orElseSucceed(() => value));
  const target = yield* realPath(path.resolve(identifier));
  const matches = yield* Effect.forEach(active, (project) =>
    realPath(project.workspaceRoot).pipe(Effect.map((root) => ({ project, root }))),
  );
  const match = matches
    .filter(({ root }) => {
      const relative = path.relative(root, target);
      return (
        relative === "" ||
        (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
      );
    })
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (!match)
    return yield* usage(
      `No active Ronin project matches '${identifier}'. Pass a project id or a path inside it.`,
    );
  return match.project;
});

const makeHttpClient = (origin: string) =>
  HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin });
const makeRpcClient = RpcClient.make(WsRpcGroup);
export type ThreadRpcClient = Effect.Success<typeof makeRpcClient>;

export const withThreadSession = <A, E, R>(
  auth: EnvironmentAuth.EnvironmentAuth["Service"],
  run: (token: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    auth.issueSession({ scopes: AuthAdministrativeScopes, label: "t3 thread cli" }),
    (issued) => run(issued.token),
    (issued) => auth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
  );

const withThreadClient = Effect.fn("cli.thread.withClient")(function* <A, E, R>(
  flags: CliAuthLocationFlags & { readonly json: boolean },
  run: (client: {
    readonly http: Effect.Success<ReturnType<typeof makeHttpClient>>;
    readonly headers: { readonly authorization: string };
    readonly rpc: ThreadRpcClient;
  }) => Effect.Effect<A, E, R>,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* Effect.gen(function* () {
    const runtime = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(runtime))
      return yield* usage(
        `No running Ronin server uses ${config.baseDir}. Start Ronin, then retry.`,
      );
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    return yield* withThreadSession(auth, (token) =>
      Effect.gen(function* () {
        const http = yield* makeHttpClient(runtime.value.origin);
        const headers = { authorization: `Bearer ${token}` };
        const ticket = yield* http.auth
          .webSocketTicket({ headers })
          .pipe(Effect.timeout("5 seconds"));
        const url = new URL("/ws", runtime.value.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("wsTicket", ticket.ticket);
        url.searchParams.set("orchestrationProtocol", String(ORCHESTRATION_PROTOCOL_VERSION));
        const protocolLayer = RpcClient.layerProtocolSocket({
          retryTransientErrors: false,
        }).pipe(
          Layer.provide(
            Layer.mergeAll(
              Socket.layerWebSocket(url.href, { openTimeout: "5 seconds" }).pipe(
                Layer.provide(Socket.layerWebSocketConstructorGlobal),
              ),
              RpcSerialization.layerJson,
            ),
          ),
        );
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* makeRpcClient;
            return yield* run({ http, headers, rpc });
          }).pipe(Effect.provide(protocolLayer)),
        );
      }),
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      EnvironmentAuth.runtimeLayer.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(
          Layer.succeed(References.MinimumLogLevel, flags.json ? "Error" : config.logLevel),
        ),
      ),
    ),
  );
});

export const readThreadMessage = Effect.fn("cli.thread.readMessage")(function* (argument: string) {
  const text =
    argument === "-"
      ? yield* Stdio.Stdio.pipe(
          Effect.flatMap((stdio) => stdio.stdin.pipe(Stream.decodeText(), Stream.mkString)),
        )
      : argument;
  if (!text.trim()) return yield* usage("The message is empty.");
  return text;
});

export const queuedThreadCommand = (
  thread: Pick<OrchestrationThread, "id" | "runtimeMode" | "interactionMode">,
  text: string,
  commandId: CommandId,
  messageId: MessageId,
  createdAt: string,
): ClientOrchestrationCommand => ({
  type: "thread.turn.start",
  commandId,
  threadId: thread.id,
  message: { messageId, role: "user", text, attachments: [] },
  dispatchMode: "queue",
  runtimeMode: thread.runtimeMode,
  interactionMode: thread.interactionMode,
  createdAt,
});

export const waitForMessage = Effect.fn("cli.thread.waitForMessage")(function* <E, R>(
  wait: () => Effect.Effect<ThreadMessageWaitResult, E, R>,
) {
  let result = yield* wait();
  while (result.status === "pending") result = yield* wait();
  return result;
});

const finish = Effect.fn("cli.thread.finish")(function* (
  client: Parameters<Parameters<typeof withThreadClient>[1]>[0],
  threadId: ThreadId,
  messageId: MessageId,
  wait: boolean,
  json: boolean,
) {
  if (!wait) return yield* json ? printJson({ threadId, messageId }) : Console.log(threadId);
  if (!json) yield* Console.error(`Thread ${threadId}`);
  const result = yield* waitForMessage(() =>
    client.http.orchestration
      .waitForMessage({
        headers: client.headers,
        params: { threadId },
        payload: { messageId },
      })
      .pipe(Effect.timeout("25 seconds")),
  );
  return yield* printThreadOutcome(result, json);
});

export const printThreadOutcome = Effect.fn("cli.thread.printOutcome")(function* (
  result: ThreadMessageWaitResult,
  json: boolean,
) {
  yield* json ? printJson(result) : Console.log(result.text);
  const threadId = result.threadId;
  if (result.status !== "completed")
    return yield* new ThreadCliError({
      detail:
        result.status === "needs_input"
          ? `Thread ${threadId} needs an answer in Ronin.`
          : `Thread ${threadId} ended: ${result.status}${result.error ? `: ${result.error}` : "."}`,
      exitCode: result.status === "needs_input" ? 2 : 1,
    });
});

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Print JSON."),
);
const waitFlag = Flag.boolean("wait").pipe(
  Flag.withDefault(false),
  Flag.withDescription("Wait for this message's final reply; exit 2 if a human must answer."),
);
const messageArgument = Argument.string("message").pipe(
  Argument.withDescription("Message, or - to read stdin."),
);
const threadArgument = Argument.string("thread");
const threadListCommand = Command.make("list", {
  ...projectLocationFlags,
  json: jsonFlag,
  project: Flag.string("project").pipe(
    Flag.withDefault("."),
    Flag.withDescription("Project id or path inside it."),
  ),
}).pipe(
  Command.withDescription("List a project's threads."),
  Command.withHandler((flags) =>
    withThreadClient(
      flags,
      Effect.fn(function* (client) {
        const snapshot = yield* client.http.orchestration.shellSnapshot({
          headers: client.headers,
        });
        const project = yield* resolveThreadProject(snapshot.projects, flags.project);
        const threads = snapshot.threads.filter((thread) => thread.projectId === project.id);
        yield* flags.json
          ? printJson({ threads })
          : Console.log(threads.map((thread) => `${thread.id}\t${thread.title}`).join("\n"));
      }),
    ).pipe(reportErrors),
  ),
);

const threadStartCommand = Command.make("start", {
  ...projectLocationFlags,
  json: jsonFlag,
  wait: waitFlag,
  project: Argument.string("project"),
  message: messageArgument,
  title: Flag.string("title").pipe(Flag.optional),
  provider: Flag.string("provider").pipe(Flag.optional),
  model: Flag.string("model").pipe(Flag.optional),
  worktree: Flag.string("worktree").pipe(
    Flag.optional,
    Flag.withDescription("Base ref for a new worktree."),
  ),
  branch: Flag.string("branch").pipe(
    Flag.optional,
    Flag.withDescription("New worktree branch; requires --worktree."),
  ),
}).pipe(
  Command.withDescription("Start a thread and print its id."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const text = yield* readThreadMessage(flags.message);
      if (Option.isSome(flags.provider) !== Option.isSome(flags.model))
        return yield* usage("--provider and --model go together.");
      if (Option.isSome(flags.branch) && Option.isNone(flags.worktree))
        return yield* usage("--branch requires --worktree.");
      const title = Option.getOrElse(flags.title, () =>
        text.trim().split("\n")[0]!.slice(0, 80),
      ).trim();
      if (!title) return yield* usage("The title is empty.");
      return yield* withThreadClient(
        flags,
        Effect.fn(function* (client) {
          const snapshot = yield* client.http.orchestration.shellSnapshot({
            headers: client.headers,
          });
          const project = yield* resolveThreadProject(snapshot.projects, flags.project);
          const model =
            Option.isSome(flags.provider) && Option.isSome(flags.model)
              ? yield* decodeModel({
                  instanceId: flags.provider.value,
                  model: flags.model.value,
                })
              : project.defaultModelSelection;
          if (model === null)
            return yield* usage(
              "Set a project default model in Ronin, or pass --provider and --model.",
            );
          const threadId = ThreadId.make(yield* randomId);
          const messageId = MessageId.make(yield* randomId);
          const commandId = CommandId.make(yield* randomId);
          const createdAt = DateTime.formatIso(yield* DateTime.now);
          const command = yield* decodeCommand({
            ...queuedThreadCommand(
              { id: threadId, runtimeMode: DEFAULT_RUNTIME_MODE, interactionMode: "default" },
              text,
              commandId,
              messageId,
              createdAt,
            ),
            bootstrap: {
              createThread: {
                projectId: project.id,
                title,
                modelSelection: model,
                runtimeMode: DEFAULT_RUNTIME_MODE,
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                createdAt,
              },
              ...(Option.isSome(flags.worktree)
                ? {
                    prepareWorktree: {
                      projectCwd: project.workspaceRoot,
                      baseBranch: flags.worktree.value,
                      ...(Option.isSome(flags.branch) ? { branch: flags.branch.value } : {}),
                    },
                    runSetupScript: true,
                  }
                : {}),
            },
          });
          yield* client.rpc[ORCHESTRATION_WS_METHODS.dispatchCommand](command);
          return yield* finish(client, threadId, messageId, flags.wait, flags.json);
        }),
      );
    }).pipe(reportErrors),
  ),
);

const threadSendCommand = Command.make("send", {
  ...projectLocationFlags,
  thread: threadArgument,
  message: messageArgument,
  json: jsonFlag,
  wait: waitFlag,
}).pipe(
  Command.withDescription("Queue a message without interrupting or resolving approvals."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const text = yield* readThreadMessage(flags.message);
      return yield* withThreadClient(
        flags,
        Effect.fn(function* (client) {
          const threadId = ThreadId.make(flags.thread);
          const { thread } = yield* client.http.orchestration.threadSnapshot({
            headers: client.headers,
            params: { threadId },
            payload: { turnLimit: 1 },
          });
          const messageId = MessageId.make(yield* randomId);
          const command = yield* decodeCommand(
            queuedThreadCommand(
              thread,
              text,
              CommandId.make(yield* randomId),
              messageId,
              DateTime.formatIso(yield* DateTime.now),
            ),
          );
          yield* client.rpc[ORCHESTRATION_WS_METHODS.dispatchCommand](command);
          return yield* finish(client, threadId, messageId, flags.wait, flags.json);
        }),
      );
    }).pipe(reportErrors),
  ),
);

const threadShowCommand = Command.make("show", {
  ...projectLocationFlags,
  thread: threadArgument,
  json: jsonFlag,
  messages: Flag.integer("messages").pipe(Flag.withDefault(10)),
}).pipe(
  Command.withDescription("Read the latest messages in a thread."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      if (flags.messages < 1 || flags.messages > 1000)
        return yield* usage("--messages must be between 1 and 1000.");
      return yield* withThreadClient(
        flags,
        Effect.fn(function* (client) {
          const { thread } = yield* client.http.orchestration.threadSnapshot({
            headers: client.headers,
            params: { threadId: ThreadId.make(flags.thread) },
            payload: { turnLimit: flags.messages },
          });
          const messages = thread.messages.slice(-flags.messages);
          yield* flags.json
            ? printJson({ thread: { ...thread, messages } })
            : Console.log(
                `${thread.id}\t${thread.title}\n\n${messages.map((message) => `${message.role}: ${message.text}`).join("\n\n")}`,
              );
        }),
      );
    }).pipe(reportErrors),
  ),
);

export const threadCommand = Command.make("thread").pipe(
  Command.withDescription("List, start, queue messages to, and read Ronin threads."),
  Command.withSubcommands([
    threadListCommand,
    threadStartCommand,
    threadSendCommand,
    threadShowCommand,
  ]),
);

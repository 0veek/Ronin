// @effect-diagnostics nodeBuiltinImport:off - exercises the native child-process boundary without launching or killing real processes.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { afterEach, beforeEach, expect, vi } from "vite-plus/test";

const nativeChildProcess = NodeModule.createRequire(import.meta.url)(
  "node:child_process",
) as typeof NodeChildProcess;

const state = {
  children: [] as NodeChildProcess.ChildProcess[],
  taskkills: [] as string[],
};

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
beforeEach(() => {
  state.children.length = 0;
  state.taskkills.length = 0;
  vi.spyOn(nativeChildProcess, "spawn").mockImplementation(() => {
    const child = new NodeChildProcess.ChildProcess();
    Object.defineProperty(child, "pid", { value: 123456789 });
    Object.assign(child, { stdin: null, stdout: null, stderr: null, stdio: [] });
    state.children.push(child);
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  vi.spyOn(nativeChildProcess, "exec").mockImplementation((command: string, ...args: unknown[]) => {
    state.taskkills.push(command);
    const child = state.children.at(-1)!;
    Object.defineProperty(child, "exitCode", { value: 1 });
    child.emit("exit", 1, null);
    const callback = args.at(-1);
    if (typeof callback === "function") callback(null, "", "");
    return new NodeChildProcess.ChildProcess();
  });
  NodeModule.syncBuiltinESMExports();
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
});
afterEach(() => {
  Object.defineProperty(process, "platform", originalPlatform);
  vi.restoreAllMocks();
  NodeModule.syncBuiltinESMExports();
});

const spawn = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.spawn(
    ChildProcess.make("synthetic-agent", [], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }),
  );
});

it.effect.each([
  [1, null],
  [null, "SIGTERM"],
] as const)("does not taskkill an exited Windows leader (%s, %s)", ([exitCode, signal]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawn;
      const native = state.children.at(-1)!;
      Object.defineProperty(native, "exitCode", { value: exitCode });
      Object.defineProperty(native, "signalCode", { value: signal });
      native.emit("exit", exitCode, signal);
      yield* child.exitCode.pipe(Effect.ignore);
      yield* child.kill().pipe(Effect.ignore);
    }),
  ).pipe(
    Effect.provide(NodeServices.layer),
    Effect.tap(() => Effect.sync(() => expect(state.taskkills).toEqual([]))),
  ),
);

it.effect("still terminates a running Windows process tree on scope close", () =>
  Effect.scoped(spawn).pipe(
    Effect.provide(NodeServices.layer),
    Effect.tap(() =>
      Effect.sync(() => expect(state.taskkills).toEqual(["taskkill /pid 123456789 /T /F"])),
    ),
  ),
);

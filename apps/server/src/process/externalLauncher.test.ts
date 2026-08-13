import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import * as ExternalLauncher from "./externalLauncher.ts";

function makeMockDetachedHandle(onUnref: () => void = () => undefined) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.sync(() => {
      onUnref();
      return Effect.void;
    }),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

const testLayer = (input: {
  readonly platform: NodeJS.Platform;
  readonly env?: Record<string, string>;
  readonly resolveExecutable?: (command: string) => string | undefined;
  readonly onSpawn?: (command: ChildProcess.StandardCommand) => void;
  readonly onUnref?: () => void;
}) => {
  const spawnerLayer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        assert.equal(ChildProcess.isStandardCommand(command), true);
        if (!ChildProcess.isStandardCommand(command)) {
          throw new Error("Expected a standard command");
        }
        input.onSpawn?.(command);
        return makeMockDetachedHandle(input.onUnref);
      }),
    ),
  );

  return Layer.mergeAll(
    ExternalLauncher.layer.pipe(Layer.provide(Layer.merge(NodeServices.layer, spawnerLayer))),
    Layer.succeed(HostProcessPlatform, input.platform),
    Layer.succeed(
      SpawnExecutableResolution,
      (command) => input.resolveExecutable?.(command) ?? command,
    ),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env ?? {} })),
  );
};

it.effect("launches the default browser through the platform command", () => {
  let spawned: ChildProcess.StandardCommand | undefined;
  let didUnref = false;
  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;

    yield* launcher.launchBrowser("https://example.com/some path");

    assert.ok(spawned);
    assert.equal(spawned.command, "xdg-open");
    assert.deepEqual(spawned.args, ["https://example.com/some path"]);
    assert.equal(spawned.options.detached, true);
    assert.equal(didUnref, true);
  }).pipe(
    Effect.provide(
      testLayer({
        platform: "linux",
        onSpawn: (command) => {
          spawned = command;
        },
        onUnref: () => {
          didUnref = true;
        },
      }),
    ),
  );
});

it.effect("launches an installed editor with platform-safe arguments", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editors-" });
    yield* fileSystem.writeFileString(path.join(binDir, "code.CMD"), "@echo off\r\n");

    let spawned: ChildProcess.StandardCommand | undefined;
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      yield* launcher.launchEditor({
        editor: "vscode",
        cwd: "C:\\workspace with spaces\\src\\index.ts:12:4",
      });
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
          resolveExecutable: (command) =>
            command === "code" ? "C:\\Program Files\\Microsoft VS Code\\bin\\code.CMD" : command,
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.ok(spawned);
    assert.equal(spawned.command, '^"C:\\Program^ Files\\Microsoft^ VS^ Code\\bin\\code.CMD^"');
    assert.deepEqual(spawned.args, [
      '^"--goto^"',
      '^"C:\\workspace^ with^ spaces\\src\\index.ts:12:4^"',
    ]);
    assert.equal(spawned.options.shell, true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("discovers editors through the service API", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-editors-" });
    yield* fileSystem.writeFileString(path.join(binDir, "code.CMD"), "@echo off\r\n");
    yield* fileSystem.writeFileString(path.join(binDir, "explorer.CMD"), "@echo off\r\n");

    const editors = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      return yield* launcher.resolveAvailableEditors();
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "win32",
          env: { PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        }),
      ),
    );

    assert.equal(editors.includes("vscode"), true);
    assert.equal(editors.includes("file-manager"), true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// Installing an editor and never seeing it offered is the common complaint, and
// PATH alone does not explain it: Zed's Linux installer only symlinks into
// ~/.local/bin, which a desktop-launched app can inherit a PATH without.
it.effect("discovers a Linux editor installed under the home directory", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-home-" });
    const zedBin = path.join(home, ".local", "zed.app", "bin", "zed");
    yield* fileSystem.makeDirectory(path.dirname(zedBin), { recursive: true });
    yield* fileSystem.writeFileString(zedBin, "#!/bin/sh\n");
    yield* fileSystem.chmod(zedBin, 0o755);

    let spawned: ChildProcess.StandardCommand | undefined;
    const editors = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      const discovered = yield* launcher.resolveAvailableEditors();
      yield* launcher.launchEditor({ editor: "zed", cwd: "/work/src/index.ts:12:4" });
      return discovered;
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "linux",
          // No PATH at all, so only the install-path probe can find anything.
          env: { HOME: home },
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.equal(editors.includes("zed"), true);
    assert.ok(spawned);
    assert.equal(spawned.command, zedBin);
    // Zed takes `path:line:column` directly rather than through --goto.
    assert.deepEqual(spawned.args, ["/work/src/index.ts:12:4"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("discovers a Flatpak editor through its exported launcher", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-home-" });
    const exported = path.join(
      home,
      ".local",
      "share",
      "flatpak",
      "exports",
      "bin",
      "com.visualstudio.code",
    );
    yield* fileSystem.makeDirectory(path.dirname(exported), { recursive: true });
    yield* fileSystem.writeFileString(exported, "#!/bin/sh\n");
    yield* fileSystem.chmod(exported, 0o755);

    const editors = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      return yield* launcher.resolveAvailableEditors();
    }).pipe(Effect.provide(testLayer({ platform: "linux", env: { HOME: home } })));

    assert.equal(editors.includes("vscode"), true);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// A shim the user put on PATH is the one they configured, so it has to win over
// whatever the install-path table guesses.
it.effect("prefers a PATH shim over the macOS app bundle shim", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-home-" });
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-bin-" });

    const bundleShim = path.join(
      home,
      "Applications",
      "Visual Studio Code.app",
      "Contents",
      "Resources",
      "app",
      "bin",
      "code",
    );
    const pathShim = path.join(binDir, "code");
    for (const shim of [bundleShim, pathShim]) {
      yield* fileSystem.makeDirectory(path.dirname(shim), { recursive: true });
      yield* fileSystem.writeFileString(shim, "#!/bin/sh\n");
      yield* fileSystem.chmod(shim, 0o755);
    }

    let spawned: ChildProcess.StandardCommand | undefined;
    const editors = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      const discovered = yield* launcher.resolveAvailableEditors();
      yield* launcher.launchEditor({ editor: "vscode", cwd: "/work/src/index.ts:12:4" });
      return discovered;
    }).pipe(
      Effect.provide(
        testLayer({
          platform: "darwin",
          env: { HOME: home, PATH: binDir },
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.equal(editors.includes("vscode"), true);
    assert.ok(spawned);
    // A PATH hit stays a bare command for spawn to resolve; only an install-path
    // hit becomes absolute, so the bundle shim losing shows up as the bare name.
    assert.equal(spawned.command, "code");
    assert.notEqual(spawned.command, bundleShim);
    assert.deepEqual(spawned.args, ["--goto", "/work/src/index.ts:12:4"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("discovers a Windows editor installed outside PATH", () => {
  const localAppData = "C:\\Users\\dev\\AppData\\Local";
  const installedShim = `${localAppData}\\Programs\\Microsoft VS Code\\bin\\code.cmd`;
  const launcherLayer = ExternalLauncher.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({
          // Only the installed shim is a file; every other probe lands on a
          // directory, which the executable check rejects.
          stat: (probed) =>
            Effect.succeed({
              type: probed === installedShim ? "File" : "Directory",
            } as FileSystem.File.Info),
        }),
        Path.layer,
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.sync(() => makeMockDetachedHandle())),
        ),
      ),
    ),
  );

  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    const editors = yield* launcher.resolveAvailableEditors();
    assert.equal(editors.includes("vscode"), true);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        launcherLayer,
        Layer.succeed(HostProcessPlatform, "win32"),
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              PATH: "C:\\nothing-here",
              PATHEXT: ".COM;.EXE;.BAT;.CMD",
              LOCALAPPDATA: localAppData,
            },
          }),
        ),
      ),
    ),
  );
});

it.effect("memoizes editor discovery and refreshes after the cache window", () => {
  let statCalls = 0;
  const fileInfo = { type: "File" } as FileSystem.File.Info;
  const launcherLayer = ExternalLauncher.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({
          stat: () =>
            Effect.sync(() => {
              statCalls += 1;
              return fileInfo;
            }),
        }),
        Path.layer,
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.sync(() => makeMockDetachedHandle())),
        ),
      ),
    ),
  );

  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;

    const first = yield* launcher.resolveAvailableEditors();
    assert.equal(first.includes("vscode"), true);
    const statCallsAfterFirstScan = statCalls;
    assert.isAbove(statCallsAfterFirstScan, 0);

    // Past the shared command-resolution cache TTL (30s) but within the
    // discovery cache window: the memoized set is reused without any scan.
    yield* TestClock.adjust("31 seconds");
    const second = yield* launcher.resolveAvailableEditors();
    assert.deepEqual([...second], [...first]);
    assert.equal(statCalls, statCallsAfterFirstScan);

    // Past the discovery cache window the next call rescans.
    yield* TestClock.adjust("30 seconds");
    yield* launcher.resolveAvailableEditors();
    assert.isAbove(statCalls, statCallsAfterFirstScan);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        launcherLayer,
        Layer.succeed(HostProcessPlatform, "win32"),
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              PATH: "C:\\t3-editor-discovery-cache-test",
              PATHEXT: ".COM;.EXE;.BAT;.CMD",
            },
          }),
        ),
        TestClock.layer(),
      ),
    ),
  );
});

// A client that disconnects mid-scan interrupts the shared discovery effect on
// the connection fiber. The cache must not retain that interrupt: doing so
// replayed it to every later connect for the whole TTL, so `server.getConfig`
// failed and no client could reconnect until the server restarted.
it.effect("rescans after an interrupted discovery instead of caching the interrupt", () => {
  const fileInfo = { type: "File" } as FileSystem.File.Info;
  let blockFirstScan = true;
  let scans = 0;
  const launcherLayer = ExternalLauncher.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({
          // The first scan parks inside `stat` so the interrupt lands while
          // discovery is in flight, which is what a client disconnecting
          // mid-connect does to the shared effect.
          stat: () =>
            Effect.gen(function* () {
              scans += 1;
              if (blockFirstScan) {
                return yield* Effect.never;
              }
              return fileInfo;
            }),
        }),
        Path.layer,
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.sync(() => makeMockDetachedHandle())),
        ),
      ),
    ),
  );

  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;

    const fiber = yield* Effect.forkChild(launcher.resolveAvailableEditors());
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(fiber);

    // The next connect must still get a real answer well inside the TTL.
    blockFirstScan = false;
    scans = 0;
    const editors = yield* launcher.resolveAvailableEditors();
    assert.equal(editors.includes("vscode"), true);
    assert.isAbove(scans, 0);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        launcherLayer,
        Layer.succeed(HostProcessPlatform, "win32"),
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              PATH: "C:\\t3-editor-discovery-interrupt-test",
              PATHEXT: ".COM;.EXE;.BAT;.CMD",
            },
          }),
        ),
      ),
    ),
  );
});

it.effect("rejects unknown editors through the service API", () =>
  Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    const error = yield* launcher
      .launchEditor({ editor: "missing-editor" as never, cwd: "/tmp/workspace" })
      .pipe(Effect.flip);
    assert.instanceOf(error, ExternalLauncher.ExternalLauncherUnknownEditorError);
    assert.equal(error.editor, "missing-editor");
    assert.equal(error.message, "Unknown editor: missing-editor");
  }).pipe(Effect.provide(testLayer({ platform: "linux", env: { PATH: "" } }))),
);

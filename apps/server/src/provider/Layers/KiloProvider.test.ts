import * as NodeAssert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { beforeEach } from "vite-plus/test";

import { KiloSettings } from "@t3tools/contracts";
import { ServerConfig } from "../../config.ts";
import {
  OpenCodeRuntime,
  OpenCodeRuntimeError,
  KILO_CLI_SPEC,
  type OpenCodeCompatibleCliSpec,
  type OpenCodeInventory,
  type OpenCodeRuntimeShape,
} from "../opencodeRuntime.ts";
import * as OpenCodeServerOwner from "../OpenCodeServerOwner.ts";
import { checkKiloProviderStatus } from "./KiloProvider.ts";

const decodeKiloSettings = Schema.decodeSync(KiloSettings);

/**
 * Kilo reuses OpenCode's probe. These cover the parts that must *not* be
 * shared: Kilo's release train, its binary name, and the Basic-auth username
 * an external Kilo server expects.
 */
const runtimeMock = {
  state: {
    runVersionError: null as Error | null,
    versionStdout: "kilo 0.9.2\n",
    sdkCliSpec: null as OpenCodeCompatibleCliSpec | null,
    inventoryCliSpec: null as OpenCodeCompatibleCliSpec | null,
    serverVersion: "0.9.2",
  },
  reset() {
    this.state.runVersionError = null;
    this.state.versionStdout = "kilo 0.9.2\n";
    this.state.sdkCliSpec = null;
    this.state.inventoryCliSpec = null;
    this.state.serverVersion = "0.9.2";
  },
};

const EMPTY_INVENTORY = {
  providerList: { connected: ["anthropic"], all: [], default: {} },
  agents: [],
  skills: [],
} as unknown as OpenCodeInventory;

const OpenCodeRuntimeTestDouble: OpenCodeRuntimeShape = {
  startOpenCodeServerProcess: () =>
    Effect.succeed({
      url: "http://127.0.0.1:4301",
      version: runtimeMock.state.serverVersion,
      isRunning: Effect.succeed(true),
      exitCode: Effect.never,
    }),
  connectToOpenCodeServer: ({ serverUrl }) =>
    Effect.succeed({
      url: serverUrl ?? "http://127.0.0.1:4301",
      version: runtimeMock.state.serverVersion,
      exitCode: null,
      external: Boolean(serverUrl),
    }),
  runOpenCodeCommand: () =>
    runtimeMock.state.runVersionError
      ? Effect.fail(
          new OpenCodeRuntimeError({
            operation: "runOpenCodeCommand",
            detail: runtimeMock.state.runVersionError.message,
            cause: runtimeMock.state.runVersionError,
          }),
        )
      : Effect.succeed({ stdout: runtimeMock.state.versionStdout, stderr: "", code: 0 }),
  createOpenCodeSdkClient: ({ cliSpec }) => {
    runtimeMock.state.sdkCliSpec = cliSpec ?? null;
    return {} as unknown as ReturnType<OpenCodeRuntimeShape["createOpenCodeSdkClient"]>;
  },
  loadOpenCodeInventory: () => Effect.succeed(EMPTY_INVENTORY),
  loadInventoryFromCli: ({ cliSpec }) => {
    runtimeMock.state.inventoryCliSpec = cliSpec ?? null;
    return Effect.succeed(EMPTY_INVENTORY);
  },
};

beforeEach(() => {
  runtimeMock.reset();
});

const testLayer = Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble).pipe(
  Layer.provideMerge(
    OpenCodeServerOwner.layer({
      binaryPath: "kilo",
      directory: process.cwd(),
      cliSpec: KILO_CLI_SPEC,
    }),
  ),
  Layer.provideMerge(Layer.succeed(OpenCodeRuntime, OpenCodeRuntimeTestDouble)),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
  Layer.provideMerge(NodeServices.layer),
);

const makeKiloSettings = (overrides?: Partial<KiloSettings>): KiloSettings =>
  decodeKiloSettings({
    enabled: true,
    binaryPath: "kilo",
    serverUrl: "",
    serverPassword: "",
    customModels: [],
    ...overrides,
  });

it.layer(testLayer)("checkKiloProviderStatus", (it) => {
  it.effect("does not judge the Kilo CLI against OpenCode's version floor", () =>
    Effect.gen(function* () {
      runtimeMock.state.versionStdout = "kilo 0.9.2\n";
      const snapshot = yield* checkKiloProviderStatus(makeKiloSettings(), process.cwd());

      NodeAssert.notEqual(snapshot.status, "error");
      NodeAssert.equal(
        snapshot.message?.includes("1.14.19") ?? false,
        false,
        "Kilo must not be told to upgrade to an OpenCode version",
      );
    }),
  );

  it.effect("stays usable when the Kilo CLI reports no parseable version", () =>
    Effect.gen(function* () {
      runtimeMock.state.versionStdout = "kilo (dev build)\n";
      const snapshot = yield* checkKiloProviderStatus(makeKiloSettings(), process.cwd());

      NodeAssert.notEqual(snapshot.status, "error");
    }),
  );

  it.effect("names Kilo, not OpenCode, when the binary is missing", () =>
    Effect.gen(function* () {
      runtimeMock.state.runVersionError = new Error("spawn kilo ENOENT");
      const snapshot = yield* checkKiloProviderStatus(makeKiloSettings(), process.cwd());

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.message, "Kilo CLI (`kilo`) is not installed or not on PATH.");
    }),
  );

  it.effect("authenticates against an external server as `kilo`", () =>
    Effect.gen(function* () {
      yield* checkKiloProviderStatus(
        makeKiloSettings({ serverUrl: "http://127.0.0.1:4321", serverPassword: "hunter2" }),
        process.cwd(),
      );

      NodeAssert.equal(runtimeMock.state.sdkCliSpec?.serverAuthUsername, "kilo");
    }),
  );

  // The local inventory now comes from a server the owner starts, so the spec
  // has to reach the SDK client that reads it — not just the spawn line.
  it.effect("reads its inventory with Kilo's own spec", () =>
    Effect.gen(function* () {
      yield* checkKiloProviderStatus(makeKiloSettings(), process.cwd());

      NodeAssert.equal(runtimeMock.state.sdkCliSpec?.configContentEnvVar, "KILO_CONFIG_CONTENT");
    }),
  );
});

// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { DroidSettings, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { execScriptSource, writeFakeCli } from "../../testUtils/fakeCli.ts";
import { ServerConfig } from "../../config.ts";
import { makeDroidAdapter } from "./DroidAdapter.ts";

const decodeSettings = Schema.decodeSync(DroidSettings);
const decodeLog = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      method: Schema.optional(Schema.String),
      params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
);
const mockAgentPath = NodeURL.fileURLToPath(
  new URL("../../../scripts/acp-mock-agent.ts", import.meta.url),
);

it.effect("reapplies the original model after a different model's mode step failed", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "ronin-droid-selection-")),
      ),
      (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
    );
    const logPath = NodePath.join(directory, "requests.jsonl");
    const binaryPath = yield* Effect.sync(() =>
      writeFakeCli({
        directory,
        name: "droid",
        env: {
          T3_ACP_REQUEST_LOG_PATH: logPath,
          T3_ACP_FAIL_SET_MODE_CONFIG_OPTION: "1",
        },
        source: execScriptSource({ scriptPath: mockAgentPath }),
      }),
    );
    const adapter = yield* makeDroidAdapter(decodeSettings({ binaryPath }));
    yield* Effect.addFinalizer(() => adapter.stopAll().pipe(Effect.ignore));
    const threadId = ThreadId.make("partial-model-switch");
    const selectionA = { instanceId: ProviderInstanceId.make("droid"), model: "default" };
    const selectionB = { ...selectionA, model: "composer-2" };
    yield* adapter.startSession({
      threadId,
      cwd: directory,
      runtimeMode: "full-access",
      modelSelection: selectionA,
    });
    const failure = yield* Effect.exit(
      adapter.sendTurn({
        threadId,
        input: "Plan on B",
        attachments: [],
        modelSelection: selectionB,
        interactionMode: "plan",
      }),
    );
    assert.equal(failure._tag, "Failure");
    yield* adapter.sendTurn({
      threadId,
      input: "Continue on A",
      attachments: [],
      modelSelection: selectionA,
      interactionMode: "default",
    });
    const log = yield* Effect.promise(() => NodeFSP.readFile(logPath, "utf8"));
    const requests = yield* Effect.forEach(log.trim().split("\n"), (line) => decodeLog(line));
    const models = requests.flatMap((entry) =>
      entry.method === "session/set_config_option" && entry.params?.configId === "model"
        ? [entry.params.value]
        : [],
    );
    assert.deepEqual(models, ["composer-2", "default"]);
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(NodeOS.tmpdir(), { prefix: "ronin-droid-selection-config-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  ),
);

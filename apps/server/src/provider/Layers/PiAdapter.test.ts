import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { PiSettings, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";
import { ServerConfig } from "../../config.ts";
import type { PiAgentSession } from "../piRuntime.ts";
import { makePiAdapter } from "./PiAdapter.ts";

const sdk = vi.hoisted(() => ({ createRuntime: vi.fn() }));
vi.mock("../piRuntime.ts", () => ({
  loadPiCodingAgentModule: async () => ({ createAgentSessionRuntime: sdk.createRuntime }),
}));
function receipt() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const settings = Schema.decodeSync(PiSettings)({ enabled: true });
const threadId = ThreadId.make("pi-native-outcome");
const layer = ServerConfig.layerTest(process.cwd(), { prefix: "ronin-pi-outcome-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);

it.layer(layer)("Pi native outcomes", (it) => {
  it.effect.each([
    { aborted: undefined, resumes: false, rejects: false, expected: "completed" },
    { aborted: false, resumes: false, rejects: false, expected: "completed" },
    { aborted: true, resumes: false, rejects: false, expected: "cancelled" },
    { aborted: true, resumes: true, rejects: false, expected: "completed" },
    { aborted: true, resumes: false, rejects: true, expected: "cancelled" },
  ])("preserves settlement aborted=$aborted, resumes=$resumes, rejects=$rejects", (scenario) =>
    Effect.gen(function* () {
      const started = receipt();
      const release = receipt();
      let emit: Parameters<NonNullable<PiAgentSession["subscribe"]>>[0] = () => {};
      sdk.createRuntime.mockResolvedValue({
        session: {
          subscribe: (listener: typeof emit) => {
            emit = listener;
            return () => {};
          },
          prompt: async () => {
            started.resolve();
            await release.promise;
            if (scenario.rejects) throw new Error("Aborted");
          },
        },
      });
      const adapter = yield* makePiAdapter(settings);
      yield* adapter.startSession({ threadId, runtimeMode: "full-access" });
      const terminal = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId, input: "Work" });
      yield* Effect.promise(() => started.promise);
      emit({ type: "agent_start" });
      emit({
        type: "agent_settled",
        ...(scenario.aborted === undefined ? {} : { aborted: scenario.aborted }),
      });
      if (scenario.resumes) {
        emit({ type: "agent_start" });
        emit({ type: "agent_settled", aborted: false });
      }
      release.resolve();
      const result = yield* Fiber.join(terminal);
      expect(result._tag).toBe("Some");
      if (result._tag === "Some" && result.value.type === "turn.completed")
        expect(result.value.payload).toEqual({ state: scenario.expected });
      expect((yield* adapter.listSessions())[0]?.status).toBe("ready");
    }),
  );

  it.effect("reports Stop as cancellation when abort resolves the prompt", () =>
    Effect.gen(function* () {
      const started = receipt();
      const release = receipt();
      sdk.createRuntime.mockResolvedValue({
        session: {
          prompt: async () => {
            started.resolve();
            await release.promise;
          },
          abort: async () => {
            release.resolve();
          },
        },
      });
      const adapter = yield* makePiAdapter(settings);
      yield* adapter.startSession({ threadId, runtimeMode: "full-access" });
      const terminal = yield* adapter.streamEvents.pipe(
        Stream.filter((event) => event.type === "turn.completed"),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* adapter.sendTurn({ threadId, input: "Work" });
      yield* Effect.promise(() => started.promise);
      yield* adapter.interruptTurn(threadId);
      const result = yield* Fiber.join(terminal);
      expect(result._tag).toBe("Some");
      if (result._tag === "Some" && result.value.type === "turn.completed")
        expect(result.value.payload.state).toBe("cancelled");
    }),
  );
});

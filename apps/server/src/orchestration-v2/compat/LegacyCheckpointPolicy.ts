import type { RunId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ProjectionStoreV2 } from "../ProjectionStore.ts";

export class LegacyCheckpointPolicyError extends Schema.TaggedErrorClass<LegacyCheckpointPolicyError>()(
  "LegacyCheckpointPolicyError",
  { cause: Schema.Defect() },
) {}

export class LegacyCheckpointPolicy extends Context.Reference<
  | {
      readonly offsetForRun: (
        threadId: ThreadId,
        runId: RunId,
      ) => Effect.Effect<number, LegacyCheckpointPolicyError>;
    }
  | undefined
>("t3/orchestration-v2/compat/LegacyCheckpointPolicy", { defaultValue: () => undefined }) {}

export const layer = Layer.effect(
  LegacyCheckpointPolicy,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const projections = yield* ProjectionStoreV2;
    return {
      offsetForRun: (threadId: ThreadId, runId: RunId) =>
        Effect.gen(function* () {
          const current = yield* sql<{ readonly turnCount: number }>`
        SELECT COALESCE(MAX(checkpoint_turn_count), 0) AS "turnCount"
        FROM projection_turns WHERE thread_id = ${threadId}
      `;
          const { runs } = yield* projections.getThreadRecords(threadId, ["runs"]);
          const ordinal = runs.find((run) => run.id === runId)?.ordinal ?? runs.length + 1;
          return (current[0]?.turnCount ?? 0) - ordinal + 1;
        }).pipe(Effect.mapError((cause) => new LegacyCheckpointPolicyError({ cause }))),
    };
  }),
);

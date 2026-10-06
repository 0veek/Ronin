import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ProviderGoal } from "./providerGoal.ts";
import { RunAttemptId } from "./baseSchemas.ts";
import { latestProviderTurnForAttempt, OrchestrationV2ProviderThread } from "./orchestrationV2.ts";

it("selects the latest native turn of an attempt regardless of list order", () => {
  const attempt = RunAttemptId.make("goal");
  const turns = [
    { id: "last", runAttemptId: attempt, ordinal: 5 },
    { id: "other", runAttemptId: RunAttemptId.make("other"), ordinal: 9 },
    { id: "first", runAttemptId: attempt, ordinal: 3 },
    { id: "subagent", runAttemptId: null, ordinal: 7 },
  ];
  expect(latestProviderTurnForAttempt(turns, attempt)?.id).toBe("last");
  expect(latestProviderTurnForAttempt(turns, null)).toBeUndefined();
  expect(latestProviderTurnForAttempt(turns, undefined)).toBeUndefined();
});

it("reads provider rows written before goals with no goal", () => {
  const field = Schema.Struct({ goal: OrchestrationV2ProviderThread.fields.goal });
  expect(Schema.decodeUnknownSync(field)({})).toEqual({ goal: null });
  expect(
    Schema.decodeUnknownSync(field)({ goal: { objective: "Finish", status: "paused" } }),
  ).toEqual({ goal: { objective: "Finish", status: "paused" } });
});

it("rejects invalid goal accounting and empty objectives", () => {
  const decode = Schema.decodeUnknownSync(ProviderGoal);
  expect(() => decode({ objective: " ", status: "active" })).toThrow();
  expect(() => decode({ objective: "Finish", status: "active", tokensUsed: -1 })).toThrow();
});

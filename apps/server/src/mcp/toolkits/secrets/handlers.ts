import { CommandId, SecretRequestError, TurnItemId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { EventSinkV2 } from "../../../orchestration-v2/EventSink.ts";
import {
  ThreadManagementService,
  latestActiveRun,
  isTerminalRunStatus,
} from "../../../orchestration-v2/ThreadManagementService.ts";
import { SecretRequests } from "../../../secrets/SecretRequests.ts";
import { requireMcpCapability } from "../../McpInvocationContext.ts";
import { SecretsToolkit, type RequestSecretResult } from "./tools.ts";

export const SecretsToolkitHandlersLive = SecretsToolkit.toLayer(
  Effect.gen(function* () {
    const threads = yield* ThreadManagementService;
    const secrets = yield* SecretRequests;
    const sink = yield* EventSinkV2;
    const crypto = yield* Crypto.Crypto;
    return {
      request_secret: (input) =>
        Effect.gen(function* () {
          const scope = yield* requireMcpCapability("secrets");
          const records = yield* threads
            .getThreadRecords(scope.threadId, ["runs"])
            .pipe(Effect.mapError(() => new SecretRequestError({ reason: "load_failed" })));
          const run = latestActiveRun(records);
          if (
            records.thread.archivedAt !== null ||
            run?.rootNodeId == null ||
            run.providerInstanceId !== scope.providerInstanceId
          ) {
            return yield* new SecretRequestError({ reason: "agent_stopped" });
          }
          const key = input.clientRequestId ?? (yield* crypto.randomUUIDv4.pipe(Effect.orDie));
          const nodeId = run.rootNodeId;
          const turnItemId = TurnItemId.make(
            `turn-item:secret-request:${encodeURIComponent(scope.threadId)}:${encodeURIComponent(key)}`,
          );
          const record = (secretStatus: "pending" | "cancelled") =>
            threads
              .dispatch({
                type: "secret_request.record",
                commandId: CommandId.make(`${turnItemId}:${secretStatus}`),
                threadId: scope.threadId,
                runId: run.id,
                nodeId,
                turnItemId,
                label: input.label,
                reason: input.reason,
                ...(input.placeholder === undefined ? {} : { placeholder: input.placeholder }),
                secretStatus,
              })
              .pipe(Effect.mapError(() => new SecretRequestError({ reason: "record_failed" })));
          const afterSequence = yield* sink
            .latestSequence()
            .pipe(Effect.mapError(() => new SecretRequestError({ reason: "load_failed" })));
          yield* record("pending");
          const closeCard = record("cancelled").pipe(
            Effect.catch(() => Effect.logWarning("Could not close a private secret request")),
          );
          // Replay from before recording the card, then subscribe to committed events.
          // Answers and Stop cannot fall between the initial read and subscription.
          const status = yield* sink.stream({ threadId: scope.threadId, afterSequence }).pipe(
            Stream.map(({ event }) => {
              if (
                event.type === "turn-item.updated" &&
                event.payload.id === turnItemId &&
                event.payload.type === "secret_request" &&
                event.payload.secretStatus !== "pending"
              )
                return Option.some(event.payload.secretStatus);
              if (
                event.type === "run.updated" &&
                event.payload.id === run.id &&
                isTerminalRunStatus(event.payload.status)
              )
                return Option.some("cancelled" as const);
              return Option.none();
            }),
            Stream.filter(Option.isSome),
            Stream.map((result) => result.value),
            Stream.runHead,
            Effect.mapError(() => new SecretRequestError({ reason: "load_failed" })),
            Effect.timeoutOption(input.timeoutMs ?? 600_000),
            Effect.ensuring(closeCard),
          );
          // An answer that committed while the timeout closed the card still wins.
          const final = yield* threads
            .getThreadRecords(scope.threadId, ["turnItems"], {
              turnItemTypes: ["secret_request"],
              messageRoles: [],
            })
            .pipe(Effect.mapError(() => new SecretRequestError({ reason: "load_failed" })));
          const item = final.turnItems.find((candidate) => candidate.id === turnItemId);
          const answer = item?.type === "secret_request" ? item.secretStatus : "cancelled";
          if (answer === "saved") {
            const ref = yield* secrets.savedRef({ threadId: scope.threadId, turnItemId });
            if (Option.isNone(ref))
              return yield* new SecretRequestError({ reason: "ref_unavailable" });
            return { status: "saved", secretRef: ref.value } satisfies RequestSecretResult;
          }
          return {
            status:
              answer === "declined"
                ? "declined"
                : Option.isNone(status)
                  ? "timed_out"
                  : "cancelled",
          } satisfies RequestSecretResult;
        }),
    };
  }),
);

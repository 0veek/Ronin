import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import {
  BearerConnectionProfile,
  type ConnectionCatalogEntry,
  type ConnectionRoute,
} from "./catalog.ts";
import { connectOverRoutes, type EnvironmentConnectionLease } from "./driver.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  ConnectionTransientError,
} from "./model.ts";
import { connectionRouteId, entryWithRoutes } from "./routes.ts";

const environmentId = EnvironmentId.make("routes");
const route = (id: string): ConnectionRoute => ({
  target: new BearerConnectionTarget({ environmentId, label: "Desk", connectionId: id }),
  profile: Option.some(
    new BearerConnectionProfile({
      environmentId,
      label: "Desk",
      connectionId: id,
      httpBaseUrl: `https://${id}.example.com/`,
      wsBaseUrl: `wss://${id}.example.com/`,
    }),
  ),
});
const first = route("first");
const second = route("second");
const entry: ConnectionCatalogEntry = entryWithRoutes({ ...first, enabled: true }, [first, second]);
const lease = {} as EnvironmentConnectionLease;

describe("route failover", () => {
  it.effect("closes a stalled route and connects over the next route", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const events: string[] = [];
        const connection = yield* connectOverRoutes(
          entry,
          () => Effect.succeed("answered"),
          (candidate) =>
            Effect.gen(function* () {
              const id = connectionRouteId(candidate.target);
              events.push(`open:${id}`);
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  events.push(`close:${id}`);
                }),
              );
              if (candidate.target === first.target) {
                yield* Deferred.succeed(started, undefined);
                return yield* Effect.never;
              }
              return lease;
            }),
        ).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* TestClock.adjust("15 seconds");
        expect(yield* Fiber.join(connection)).toBe(lease);
        expect(events).toEqual(["open:first", "close:first", "open:second"]);
      }),
    ),
  );

  it.effect("falls back after an attempt fails and closes its resources first", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const events: string[] = [];
        const result = yield* connectOverRoutes(
          entry,
          () => Effect.succeed("answered"),
          (candidate) =>
            Effect.gen(function* () {
              const id = connectionRouteId(candidate.target);
              events.push(`open:${id}`);
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  events.push(`close:${id}`);
                }),
              );
              if (candidate.target === first.target)
                return yield* new ConnectionTransientError({
                  reason: "transport",
                  detail: "LAN lost",
                });
              return lease;
            }),
        );
        expect(result).toBe(lease);
        expect(events).toEqual(["open:first", "close:first", "open:second"]);
      }),
    ),
  );

  it.effect("tries a reachable fallback before a silent preferred route", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tried: string[] = [];
        yield* connectOverRoutes(
          entry,
          (candidate) => Effect.succeed(candidate.target === first.target ? "silent" : "answered"),
          (candidate) =>
            Effect.sync(() => {
              tried.push(connectionRouteId(candidate.target));
              return lease;
            }),
        );
        expect(tried).toEqual(["second"]);
      }),
    ),
  );

  it.effect("retries silent routes last and retains transient failure semantics", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tried: string[] = [];
        const error = yield* connectOverRoutes(
          entry,
          (candidate) => Effect.succeed(candidate.target === first.target ? "silent" : "answered"),
          (candidate) =>
            Effect.gen(function* () {
              tried.push(connectionRouteId(candidate.target));
              if (candidate.target === first.target)
                return yield* new ConnectionTransientError({
                  reason: "transport",
                  detail: "still offline",
                });
              return yield* new ConnectionBlockedError({
                reason: "authentication",
                detail: "pair again",
              });
            }),
        ).pipe(Effect.flip);
        expect(tried).toEqual(["second", "first"]);
        expect(error._tag).toBe("ConnectionTransientError");
      }),
    ),
  );

  it.effect("stops on incompatible servers without opening another route", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tried: string[] = [];
        yield* connectOverRoutes(
          entry,
          () => Effect.succeed("answered"),
          (candidate) =>
            Effect.gen(function* () {
              tried.push(connectionRouteId(candidate.target));
              return yield* new ConnectionBlockedError({
                reason: "unsupported",
                detail: "update server",
              });
            }),
        ).pipe(Effect.flip);
        expect(tried).toEqual(["first"]);
      }),
    ),
  );
});

import { expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { AutomationService, type AutomationServiceShape } from "./AutomationService.ts";
import { AUTOMATION_TICK_INTERVAL_MS, AutomationScheduler, layer } from "./AutomationScheduler.ts";

const unsupported = <A>() =>
  Effect.die(new Error("Unsupported automation call in test")) as Effect.Effect<A, never>;

/**
 * A service whose only real member is `tick`, counting calls and optionally
 * failing the first few — the two things the scheduler is responsible for.
 */
function makeAutomationServiceLayer(options?: {
  readonly dieOnCallNumbers?: ReadonlyArray<number>;
}) {
  const ticksRef = Ref.makeUnsafe(0);
  const service: AutomationServiceShape = {
    list: () => unsupported(),
    create: () => unsupported(),
    update: () => unsupported(),
    remove: () => unsupported(),
    runNow: () => unsupported(),
    listRuns: () => unsupported(),
    tick: Effect.gen(function* () {
      const count = yield* Ref.updateAndGet(ticksRef, (previous) => previous + 1);
      if (options?.dieOnCallNumbers?.includes(count)) {
        return yield* Effect.die(new Error(`tick ${count} exploded`));
      }
    }),
  };
  return {
    layer: Layer.succeed(AutomationService, service),
    readTicks: Ref.get(ticksRef),
  };
}

it.effect("ticks once immediately and then once per interval", () =>
  Effect.gen(function* () {
    const automations = makeAutomationServiceLayer();

    yield* Effect.scoped(
      Effect.gen(function* () {
        const scheduler = yield* AutomationScheduler;
        yield* scheduler.start();
        // The loop leads with a tick, so a server that just started does not
        // wait a full interval before honouring an already-due automation.
        yield* TestClock.adjust(Duration.zero);
        expect(yield* automations.readTicks).toBe(1);

        yield* TestClock.adjust(Duration.millis(AUTOMATION_TICK_INTERVAL_MS));
        expect(yield* automations.readTicks).toBe(2);

        yield* TestClock.adjust(Duration.millis(AUTOMATION_TICK_INTERVAL_MS * 3));
        expect(yield* automations.readTicks).toBe(5);
      }).pipe(Effect.provide(layer.pipe(Layer.provide(automations.layer)))),
    );
  }),
);

it.effect("keeps ticking after a tick dies", () =>
  Effect.gen(function* () {
    // A scheduler that stops on the first bad tick is a scheduler that silently
    // stops running every automation the user set up.
    const automations = makeAutomationServiceLayer({ dieOnCallNumbers: [1, 2] });

    yield* Effect.scoped(
      Effect.gen(function* () {
        const scheduler = yield* AutomationScheduler;
        yield* scheduler.start();
        yield* TestClock.adjust(Duration.zero);
        yield* TestClock.adjust(Duration.millis(AUTOMATION_TICK_INTERVAL_MS * 3));

        expect(yield* automations.readTicks).toBe(4);
      }).pipe(Effect.provide(layer.pipe(Layer.provide(automations.layer)))),
    );
  }),
);

it.effect("stops ticking once the owning scope closes", () =>
  Effect.gen(function* () {
    const automations = makeAutomationServiceLayer();

    yield* Effect.scoped(
      Effect.gen(function* () {
        const scheduler = yield* AutomationScheduler;
        yield* scheduler.start();
        yield* TestClock.adjust(Duration.millis(AUTOMATION_TICK_INTERVAL_MS));
      }).pipe(Effect.provide(layer.pipe(Layer.provide(automations.layer)))),
    );

    const afterClose = yield* automations.readTicks;
    yield* TestClock.adjust(Duration.millis(AUTOMATION_TICK_INTERVAL_MS * 5));

    expect(yield* automations.readTicks).toBe(afterClose);
  }),
);

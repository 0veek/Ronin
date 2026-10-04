import { ProviderInstanceId } from "@t3tools/contracts";
import { type OrchestrationV2ProviderCapabilities } from "@t3tools/contracts/orchestration-v2";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import { PreparedTurnRequests } from "./compat/PreparedTurnRequests.ts";
import { makeLegacyProviderAdapterV2 } from "./compat/LegacyProviderAdapter.ts";

export class ProviderAdapterRegistryLookupError extends Schema.TaggedErrorClass<ProviderAdapterRegistryLookupError>()(
  "ProviderAdapterRegistryLookupError",
  { instanceId: ProviderInstanceId },
) {}
export class ProviderAdapterRegistryMetadataError extends Schema.TaggedErrorClass<ProviderAdapterRegistryMetadataError>()(
  "ProviderAdapterRegistryMetadataError",
  { instanceId: ProviderInstanceId, cause: Schema.Defect() },
) {}
export const ProviderAdapterRegistryV2Error = Schema.Union([
  ProviderAdapterRegistryLookupError,
  ProviderAdapterRegistryMetadataError,
]);
export type ProviderAdapterRegistryV2Error = typeof ProviderAdapterRegistryV2Error.Type;

export interface ProviderAdapterRegistryV2Shape {
  readonly get: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderAdapterV2Shape, ProviderAdapterRegistryV2Error>;
  readonly list: () => Effect.Effect<ReadonlyArray<ProviderInstanceId>>;
  readonly getMetadata?: (instanceId: ProviderInstanceId) => Effect.Effect<
    {
      readonly driver: ProviderAdapterV2Shape["driver"];
      readonly continuationKey: string;
      readonly enabled: boolean;
      readonly capabilities: OrchestrationV2ProviderCapabilities;
    },
    ProviderAdapterRegistryV2Error
  >;
}

export class ProviderAdapterRegistryV2 extends Context.Service<
  ProviderAdapterRegistryV2,
  ProviderAdapterRegistryV2Shape
>()("t3/orchestration-v2/ProviderAdapterRegistry/ProviderAdapterRegistryV2") {}

export function makeLayer(adapters: ReadonlyArray<ProviderAdapterV2Shape>) {
  return Layer.succeed(ProviderAdapterRegistryV2, {
    get: (instanceId) => {
      const adapter = adapters.find((candidate) => candidate.instanceId === instanceId);
      return adapter === undefined
        ? Effect.fail(new ProviderAdapterRegistryLookupError({ instanceId }))
        : Effect.succeed(adapter);
    },
    list: () => Effect.succeed(adapters.map((adapter) => adapter.instanceId)),
  });
}

export const layerFromProviderInstanceRegistry = Layer.effect(
  ProviderAdapterRegistryV2,
  Effect.gen(function* () {
    const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
    const providers = yield* ProviderService;
    const prepared = yield* PreparedTurnRequests;
    const resolve = Effect.fn("ProviderAdapterRegistryV2.resolve")(function* (
      instanceId: ProviderInstanceId,
    ) {
      const instance = yield* instances.getInstance(instanceId);
      if (instance === undefined || !instance.enabled)
        return yield* new ProviderAdapterRegistryLookupError({ instanceId });
      return { instance, adapter: makeLegacyProviderAdapterV2(instance, providers, prepared) };
    });
    return ProviderAdapterRegistryV2.of({
      get: (instanceId) => resolve(instanceId).pipe(Effect.map(({ adapter }) => adapter)),
      list: () =>
        instances.listInstances.pipe(
          Effect.map((available) =>
            available.filter((instance) => instance.enabled).map((instance) => instance.instanceId),
          ),
        ),
      getMetadata: (instanceId) =>
        resolve(instanceId).pipe(
          Effect.flatMap(({ instance, adapter }) =>
            adapter.getCapabilities().pipe(
              Effect.map((capabilities) => ({
                driver: instance.driverKind,
                continuationKey: instance.continuationIdentity.continuationKey,
                enabled: instance.enabled,
                capabilities,
              })),
              Effect.mapError(
                (cause) => new ProviderAdapterRegistryMetadataError({ instanceId, cause }),
              ),
            ),
          ),
        ),
    });
  }),
);

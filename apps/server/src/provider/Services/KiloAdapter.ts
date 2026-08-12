/**
 * KiloAdapter — shape type for the Kilo provider adapter.
 *
 * Historically this module exposed a `Context.Service` tag so consumers
 * could inject the adapter through the Effect layer graph. The driver
 * model ({@link ../Drivers/KiloDriver}) bundles one adapter per
 * instance as a captured closure instead, so the tag is gone — we only
 * retain the shape interface as a naming anchor for the driver bundle.
 *
 * @module KiloAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

/**
 * KiloAdapterShape — per-instance Kilo adapter contract. Carries
 * a branded driver kind as the nominal discriminant.
 */
export interface KiloAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

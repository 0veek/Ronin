/**
 * AntigravityAdapter — shape type for the Antigravity provider adapter.
 *
 * @module AntigravityAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface AntigravityAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

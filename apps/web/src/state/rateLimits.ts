/**
 * Provider quota state for the sidebar meter.
 *
 * Scoped to the primary environment rather than merged across all of them.
 * Quota belongs to an account on a machine, and summing two machines that are
 * signed into the same account would double-count while summing two different
 * accounts would be meaningless. The meter reports one machine's view.
 *
 * @module state/rateLimits
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderRateLimits } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { serverEnvironment } from "./server";
import { usePrimaryEnvironmentId } from "./environments";

export interface ProviderRateLimitsView {
  readonly isPending: boolean;
  /** Set only when the whole read failed; a per-provider fault rides its row. */
  readonly error: string | null;
  readonly providers: ReadonlyArray<ProviderRateLimits>;
}

const EMPTY: ProviderRateLimitsView = { isPending: false, error: null, providers: [] };

const rateLimitsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ProviderRateLimitsView => {
    const result = get(serverEnvironment.providerRateLimits({ environmentId, input: {} }));
    const snapshot = Option.getOrNull(AsyncResult.value(result));
    return {
      isPending: result.waiting,
      error: result._tag === "Failure" ? "Usage could not be read." : null,
      providers: snapshot?.providers ?? [],
    };
  }).pipe(Atom.withLabel(`web-rate-limits:${environmentId}`)),
);

export function useProviderRateLimits(): ProviderRateLimitsView {
  const environmentId = usePrimaryEnvironmentId();
  // Reading a stable no-op atom when there is no environment keeps the hook
  // order fixed; branching around useAtomValue would break the rules of hooks.
  return useAtomValue(environmentId === null ? emptyRateLimitsAtom : rateLimitsAtom(environmentId));
}

const emptyRateLimitsAtom = Atom.make((): ProviderRateLimitsView => EMPTY).pipe(
  Atom.withLabel("web-rate-limits:none"),
);

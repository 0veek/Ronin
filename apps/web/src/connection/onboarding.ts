import {
  ConnectionOnboarding,
  type PairingConnectionInput,
  type SshConnectionInput,
} from "@t3tools/client-runtime/connection";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";

import { connectionAtomRuntime } from "./runtime";

const onboardingScheduler = createAtomCommandScheduler();

export const connectPairing = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:connection:connect-pairing",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "singleFlight",
    key: (input: PairingConnectionInput) => JSON.stringify(input),
  },
  execute: (input: PairingConnectionInput) =>
    ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.registerPairing(input))),
});

export const connectSshEnvironment = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:connection:connect-ssh",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "serial",
    key: (input: SshConnectionInput) => JSON.stringify(input.target),
  },
  execute: (input: SshConnectionInput) =>
    ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.registerSsh(input))),
});

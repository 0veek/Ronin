import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as AutomationScheduler from "./automation/AutomationScheduler.ts";
import * as ServiceLauncherClient from "./cloud/serviceLauncherClient.ts";
import * as ServerConfig from "./config.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as Keybindings from "./keybindings.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as OrchestrationReactor from "./orchestration/Services/OrchestrationReactor.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as ProviderSessionDirectory from "./provider/Services/ProviderSessionDirectory.ts";
import * as ProviderSessionReaper from "./provider/Services/ProviderSessionReaper.ts";
import { ServerActivation } from "./serverActivation.ts";
import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";

it.effect("parks automatic pull until activation without delaying command readiness", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const activation = yield* Deferred.make<void>();
      const prepared = yield* Deferred.make<void>();
      const commitTrial = yield* Deferred.make<void>();
      const statusCalled = yield* Deferred.make<string>();
      const statusInterrupted = yield* Deferred.make<void>();
      const cwd = "/auto-pull-project";
      const updatedAt = "2026-01-01T00:00:00.000Z";
      const dependencies = Layer.mergeAll(
        Layer.effect(
          ServerConfig.ServerConfig,
          Effect.gen(function* () {
            const config = yield* ServerConfig.ServerConfig;
            return {
              ...config,
              mode: "desktop" as const,
              host: "localhost",
              port: 3773,
              noBrowser: true,
              autoBootstrapProjectFromCwd: false,
            };
          }),
        ).pipe(
          Layer.provide(ServerConfig.layerTest(cwd, { prefix: "ronin-autopull-" })),
          Layer.provide(NodeServices.layer),
        ),
        Layer.mock(ExternalLauncher.ExternalLauncher)({}),
        Layer.mock(HttpServer.HttpServer)({
          address: { _tag: "TcpAddress", hostname: "localhost", port: 3773 },
        }),
        Layer.mock(Keybindings.Keybindings)({ start: Effect.void }),
        Layer.mock(OrchestrationReactor.OrchestrationReactor)({ start: () => Effect.void }),
        Layer.mock(ProviderSessionReaper.ProviderSessionReaper)({ start: () => Effect.void }),
        Layer.mock(AutomationScheduler.AutomationScheduler)({ start: () => Effect.void }),
        Layer.mock(ProviderSessionDirectory.ProviderSessionDirectory)({}),
        Layer.mock(ProviderService.ProviderService)({ listSessions: () => Effect.succeed([]) }),
        Layer.mock(OrchestrationEngine.OrchestrationEngineService)({}),
        Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
          getCommandReadModel: () =>
            Effect.succeed({
              snapshotSequence: 0,
              threads: [],
              projects: [],
              updatedAt,
            }),
          listActivitiesByKind: () => Effect.succeed([]),
          getShellSnapshot: () =>
            Effect.succeed({
              snapshotSequence: 0,
              projects: [
                {
                  id: ProjectId.make("auto-pull-project"),
                  title: "Auto pull project",
                  workspaceRoot: cwd,
                  autoPull: true,
                  defaultModelSelection: null,
                  scripts: [],
                  createdAt: updatedAt,
                  updatedAt,
                },
              ],
              threads: [],
              updatedAt,
            }),
        }),
        Layer.mock(ServerLifecycleEvents.ServerLifecycleEvents)({
          publish: (event) => Effect.succeed({ ...event, sequence: 1 }),
        }),
        Layer.mock(ServerSettings.ServerSettingsService)({
          start: Effect.void,
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        }),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getDescriptor: Effect.succeed({
            environmentId: EnvironmentId.make("auto-pull-environment"),
            label: "Test environment",
            platform: { os: "darwin", arch: "arm64" },
            serverVersion: "0.0.0-test",
            capabilities: { repositoryIdentity: true },
          }),
        }),
        Layer.mock(ServiceLauncherClient.ServiceLauncherClient)({
          managed: true,
          prepareTrial: Deferred.succeed(prepared, undefined).pipe(
            Effect.andThen(Deferred.await(commitTrial)),
            Effect.as(undefined),
          ),
        }),
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          statusDetails: (root) =>
            Deferred.succeed(statusCalled, root).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(statusInterrupted, undefined)),
            ),
        }),
        Layer.mock(EnvironmentAuth.EnvironmentAuth)({}),
        NodeCrypto.layer,
        Path.layer,
      );

      yield* Effect.gen(function* () {
        const startup = yield* ServerRuntimeStartup.ServerRuntimeStartup;
        yield* startup.markHttpListening;
        // These receipts distinguish an awaited fetch from a parked worker without a timeout.
        yield* Effect.raceFirst(Deferred.await(prepared), Deferred.await(statusCalled));
        expect(yield* Deferred.isDone(activation)).toBe(false);
        expect(yield* Deferred.isDone(statusCalled)).toBe(false);
        expect(yield* Deferred.isDone(prepared)).toBe(true);

        yield* Deferred.succeed(commitTrial, undefined);
        yield* Deferred.await(activation);
        expect(yield* Deferred.await(statusCalled)).toBe(cwd);
        yield* startup.awaitCommandReady;
      }).pipe(
        Effect.provide(
          ServerRuntimeStartup.layerWithOptions({
            activate: Deferred.succeed(activation, undefined).pipe(Effect.asVoid),
            awaitAuxiliaryParked: Effect.void,
          }).pipe(Layer.provide(dependencies)),
        ),
        Effect.provideService(ServerActivation, Deferred.await(activation)),
      );
      expect(yield* Deferred.isDone(statusInterrupted)).toBe(true);
    }),
  ),
);

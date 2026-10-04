import * as Layer from "effect/Layer";
import type { ProviderAdapterRegistryV2 } from "./ProviderAdapterRegistry.ts";
import * as RoninOrchestration from "./compat/RoninOrchestration.ts";
import * as PreparedTurnRequests from "./compat/PreparedTurnRequests.ts";
import * as LegacyCheckpointPolicy from "./compat/LegacyCheckpointPolicy.ts";
import * as OrchestrationCommandReceipts from "./compat/ApplicationCommandReceipts.ts";
import * as OrchestrationEventStore from "./compat/ApplicationEventStore.ts";
import { layer as ProviderAuthServiceLive } from "./compat/ProviderAuthService.ts";
import { layer as projectServiceLayer } from "./compat/ProjectService.ts";
import { layer as checkpointCaptureServiceLayer } from "./CheckpointCaptureService.ts";
import { layer as checkpointServiceLayer } from "./CheckpointService.ts";
import { layer as checkpointRollbackServiceLayer } from "./CheckpointRollbackService.ts";
import { layer as commandPolicyLayer } from "./CommandPolicy.ts";
import { layerFromApplicationReceipts as commandReceiptStoreLayer } from "./CommandReceiptStore.ts";
import { layer as contextHandoffServiceLayer } from "./ContextHandoffService.ts";
import { layer as effectOutboxLayer } from "./EffectOutbox.ts";
import {
  executorLayer as effectExecutorLayer,
  layer as effectWorkerLayer,
} from "./EffectWorker.ts";
import { layerFromStores as eventSinkLayer } from "./EventSink.ts";
import { layerFromOrchestrationEventStore as eventStoreLayer } from "./EventStore.ts";
import { layer as idAllocatorLayer } from "./IdAllocator.ts";
import * as LegacyV1ThreadImporter from "./compat/LegacyV1ThreadImporter.ts";
import { layer as orchestratorLayer } from "./Orchestrator.ts";
import { layer as projectionStoreLayer } from "./ProjectionStore.ts";
import { layer as projectionMaintenanceLayer } from "./ProjectionMaintenance.ts";
import * as ProjectStore from "./ProjectStore.ts";
import { layerFromProviderInstanceRegistry as providerAdapterRegistryLayerFromProviderInstances } from "./ProviderAdapterRegistry.ts";
import { layer as providerContinuationRequestsLayer } from "./ProviderContinuationRequests.ts";
import { workerLive as providerContinuationWorkerLive } from "./ProviderContinuationService.ts";
import { layer as threadTitleRegenerationServiceLayer } from "./ThreadTitleRegenerationService.ts";
import { layer as providerEventIngestorLayer } from "./ProviderEventIngestor.ts";
import * as ThreadCommandExecutor from "./ThreadCommandExecutor.ts";
import { layer as providerSessionManagerLayer } from "./ProviderSessionManager.ts";
import { layer as providerRuntimeRecoveryLayer } from "./ProviderRuntimeRecoveryService.ts";
import { layer as providerSwitchServiceLayer } from "./ProviderSwitchService.ts";
import { layer as providerTurnControlServiceLayer } from "./ProviderTurnControlService.ts";
import { layer as providerTurnStartServiceLayer } from "./ProviderTurnStartService.ts";
import { layer as runExecutionServiceLayer } from "./RunExecutionService.ts";
import { layer as runFinalizationServiceLayer } from "./RunFinalizationService.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";
import { layer as runtimeRequestServiceLayer } from "./RuntimeRequestService.ts";
import { layerWithLegacyImporter as threadManagementServiceLayer } from "./ThreadManagementService.ts";
import { layer as threadForkServiceLayer } from "./ThreadForkService.ts";
import { layer as turnItemPositionStoreLayer } from "./TurnItemPositionStore.ts";

/** The shared application event log and its command receipts. */
export const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStore.OrchestrationEventStoreLive,
  OrchestrationCommandReceipts.OrchestrationCommandReceiptRepositoryLive,
);

const runtimePolicyProvided = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(ProjectStore.layer),
);

const eventStoreProvided = eventStoreLayer.pipe(
  Layer.provide(OrchestrationEventInfrastructureLayerLive),
);
const commandReceiptStoreProvided = commandReceiptStoreLayer.pipe(
  Layer.provide(OrchestrationEventInfrastructureLayerLive),
);

const storesLayer = Layer.mergeAll(
  OrchestrationEventInfrastructureLayerLive,
  eventStoreProvided,
  projectionStoreLayer,
  ProjectStore.layer,
  commandReceiptStoreProvided,
  effectOutboxLayer,
  turnItemPositionStoreLayer,
);

export const OrchestrationV2EventSinkLayerLive = eventSinkLayer.pipe(Layer.provide(storesLayer));
const eventSinkProvided = OrchestrationV2EventSinkLayerLive;
const projectionMaintenanceProvided = projectionMaintenanceLayer.pipe(Layer.provide(storesLayer));
const legacyV1ThreadImporterProvided = LegacyV1ThreadImporter.layer.pipe(
  Layer.provide(eventSinkProvided),
);

export const ProjectServiceLayerLive = projectServiceLayer.pipe(Layer.provide(ProjectStore.layer));

const providerEventIngestorProvided = providerEventIngestorLayer.pipe(
  Layer.provide(
    Layer.mergeAll(
      eventSinkProvided,
      idAllocatorLayer,
      projectionStoreLayer,
      ThreadCommandExecutor.layer,
    ),
  ),
);

const checkpointServiceProvided = checkpointServiceLayer.pipe(
  Layer.provide(idAllocatorLayer),
  Layer.provide(LegacyCheckpointPolicy.layer.pipe(Layer.provide(projectionStoreLayer))),
);
const contextHandoffServiceProvided = contextHandoffServiceLayer.pipe(
  Layer.provide(idAllocatorLayer),
);

export function layerWithAdapters<R>(adapters: Layer.Layer<ProviderAdapterRegistryV2, never, R>) {
  const providerAdapterRegistryProvided = adapters.pipe(Layer.provide(PreparedTurnRequests.layer));
  const providerSwitchServiceProvided = providerSwitchServiceLayer.pipe(
    Layer.provide(providerAdapterRegistryProvided),
  );

  const providerSessionManagerProvided = providerSessionManagerLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        providerAdapterRegistryProvided,
        eventSinkProvided,
        idAllocatorLayer,
        providerEventIngestorProvided,
        projectionStoreLayer,
      ),
    ),
  );

  const providerAuthServiceProvided = ProviderAuthServiceLive.pipe(
    Layer.provide(Layer.merge(projectionStoreLayer, providerSessionManagerProvided)),
  );

  const runExecutionServiceProvided = runExecutionServiceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        checkpointServiceProvided,
        eventSinkProvided,
        idAllocatorLayer,
        providerEventIngestorProvided,
      ),
    ),
  );

  const providerTurnStartServiceProvided = providerTurnStartServiceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        contextHandoffServiceProvided,
        eventSinkProvided,
        idAllocatorLayer,
        projectionStoreLayer,
        providerSessionManagerProvided,
        providerAuthServiceProvided,
        runExecutionServiceProvided,
        runtimePolicyProvided,
        ProjectServiceLayerLive,
      ),
    ),
  );

  const providerTurnControlServiceProvided = providerTurnControlServiceLayer.pipe(
    Layer.provide(Layer.merge(projectionStoreLayer, providerSessionManagerProvided)),
  );
  const runtimeRequestServiceProvided = runtimeRequestServiceLayer.pipe(
    Layer.provide(Layer.merge(projectionStoreLayer, providerSessionManagerProvided)),
  );
  const checkpointRollbackServiceProvided = checkpointRollbackServiceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ProjectStore.layer,
        checkpointServiceProvided,
        eventSinkProvided,
        idAllocatorLayer,
        projectionStoreLayer,
        providerSessionManagerProvided,
        runtimePolicyProvided,
      ),
    ),
  );
  const checkpointCaptureServiceProvided = checkpointCaptureServiceLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        checkpointServiceProvided,
        eventSinkProvided,
        idAllocatorLayer,
        projectionStoreLayer,
      ),
    ),
  );
  const runFinalizationServiceProvided = runFinalizationServiceLayer.pipe(
    Layer.provide(Layer.merge(checkpointCaptureServiceProvided, projectionStoreLayer)),
  );

  const orchestratorProvided = orchestratorLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        checkpointServiceProvided,
        commandPolicyLayer,
        storesLayer,
        eventSinkProvided,
        commandReceiptStoreProvided,
        contextHandoffServiceProvided,
        idAllocatorLayer,
        ProjectStore.layer,
        providerAdapterRegistryProvided,
        // Same layer reference as the continuation worker and the adapter
        // infrastructure so layer memoization yields one shared request queue.
        providerContinuationRequestsLayer,
        providerEventIngestorProvided,
        runtimePolicyProvided,
        providerSessionManagerProvided,
        providerSwitchServiceProvided,
        runExecutionServiceProvided,
        threadForkServiceLayer,
      ),
    ),
  );

  const threadManagementProvided = threadManagementServiceLayer.pipe(
    Layer.provide(Layer.merge(orchestratorProvided, legacyV1ThreadImporterProvided)),
  );
  const providerContinuationWorkerProvided = providerContinuationWorkerLive.pipe(
    Layer.provide(
      Layer.mergeAll(providerContinuationRequestsLayer, threadManagementProvided, idAllocatorLayer),
    ),
  );
  const threadTitleRegenerationProvided = threadTitleRegenerationServiceLayer.pipe(
    Layer.provide(Layer.mergeAll(threadManagementProvided, ProjectStore.layer)),
  );
  const effectExecutorProvided = effectExecutorLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        runFinalizationServiceProvided,
        checkpointRollbackServiceProvided,
        providerSessionManagerProvided,
        providerTurnControlServiceProvided,
        providerTurnStartServiceProvided,
        runtimeRequestServiceProvided,
        threadTitleRegenerationProvided,
        threadManagementProvided,
      ),
    ),
  );
  const effectWorkerProvided = effectWorkerLayer.pipe(
    Layer.provide(Layer.merge(storesLayer, effectExecutorProvided)),
  );
  const providerRuntimeRecoveryProvided = providerRuntimeRecoveryLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        effectWorkerProvided,
        storesLayer,
        eventSinkProvided,
        idAllocatorLayer,
        projectionStoreLayer,
      ),
    ),
  );

  return Layer.mergeAll(
    orchestratorProvided,
    threadManagementProvided,
    effectWorkerProvided,
    providerSessionManagerProvided,
    providerAuthServiceProvided,
    providerRuntimeRecoveryProvided,
    projectionMaintenanceProvided,
    legacyV1ThreadImporterProvided,
    eventSinkProvided,
    projectionStoreLayer,
    idAllocatorLayer,
    PreparedTurnRequests.layer,
    ThreadCommandExecutor.layer,
    providerContinuationWorkerProvided,
  );
}

export const OrchestrationV2LayerLive = layerWithAdapters(
  providerAdapterRegistryLayerFromProviderInstances,
);

export const RoninOrchestrationLayerLive = RoninOrchestration.layer.pipe(
  Layer.provideMerge(OrchestrationV2LayerLive),
);

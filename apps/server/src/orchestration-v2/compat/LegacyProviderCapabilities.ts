import type { ProviderDriverKind } from "@t3tools/contracts";
import type { OrchestrationV2ProviderCapabilities } from "@t3tools/contracts/orchestration-v2";
import type { ProviderAdapterCapabilities } from "../../provider/Services/ProviderAdapter.ts";

export function legacyProviderCapabilities(
  driver: ProviderDriverKind,
  legacy: ProviderAdapterCapabilities,
): OrchestrationV2ProviderCapabilities {
  const rollback = legacy.supportsConversationRollback !== false;
  const interactive = driver !== "pi";
  return {
    sessions: {
      supportsMultipleProviderThreadsPerSession: false,
      supportsModelSwitchInSession: legacy.sessionModelSwitch === "in-session",
      supportsProviderSwitchingViaHandoff: true,
      supportsRuntimeModeSwitchInSession: false,
      pendingRequestsSurviveRestart: false,
    },
    threads: {
      canCreateEmptyThread: true,
      canReadThreadSnapshot: false,
      canRollbackThread: rollback,
      canForkThread: false,
      canForkFromTurn: false,
      canForkFromSubagentThread: false,
      exposesNativeThreadId: false,
    },
    turns: {
      exposesNativeTurnId: true,
      emitsTurnStarted: true,
      emitsTurnCompleted: true,
      supportsInterrupt: true,
      supportsActiveSteering:
        driver === "codex" || driver === "claudeAgent" || driver === "opencode",
      supportsSteeringByInterruptRestart: false,
      supportsQueuedMessages: true,
      terminalStatusQuality: "strong",
    },
    streaming: {
      streamsAssistantText: true,
      streamsReasoning: true,
      streamsToolOutput: true,
      streamsPlanText: true,
      emitsMessageCompleted: true,
    },
    tools: {
      exposesToolItemIds: true,
      emitsToolStarted: true,
      emitsToolCompleted: true,
      emitsToolOutput: true,
      supportsMcpTools: interactive,
      supportsDynamicToolCallbacks: false,
    },
    approvals: {
      supportsCommandApproval: interactive,
      supportsFileReadApproval: interactive,
      supportsFileChangeApproval: interactive,
      supportsApplyPatchApproval: interactive,
      approvalsHaveNativeRequestIds: true,
      approvalCallbacksAreLiveOnly: true,
      approvalsCanOriginateFromSubagents: true,
    },
    planning: {
      emitsPlanUpdated: true,
      emitsTodoList: true,
      emitsProposedPlan: true,
      supportsStructuredQuestions: interactive,
      planDeltasHaveItemIds: true,
    },
    subagents: {
      supportsSubagents: true,
      exposesSubagentThreadIds: false,
      emitsSubagentLifecycle: true,
      canWaitForSubagents: true,
      canCloseSubagents: true,
      canForkSubagentThread: false,
    },
    context: {
      acceptsSystemContext: false,
      acceptsDeveloperContext: false,
      acceptsSyntheticUserContext: true,
      canGenerateSummaries: true,
      canConsumeHandoffSummaries: true,
      supportsDeltaHandoff: true,
      supportsFullThreadHandoff: true,
      maxRecommendedHandoffChars: legacy.maxHandoffBriefChars ?? null,
    },
    checkpointing: {
      appCanCheckpointFilesystem: true,
      supportsNestedCheckpointScopes: false,
      providerCanRollbackConversation: rollback,
      providerRollbackReturnsSnapshot: false,
      providerCanReadConversationSnapshot: false,
    },
    identity: {
      nativeThreadIds: "weak",
      nativeTurnIds: "strong",
      nativeItemIds: "strong",
      nativeRequestIds: "strong",
    },
    runtimePolicy: {
      enforcement: driver === "codex" || driver === "claudeAgent" ? "native" : "client-boundary",
    },
  };
}

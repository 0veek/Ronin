import {
  DeviceListInput,
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  AuthSourceControlWriteScope,
  AuthPreviewOperateScope,
  AuthDiagnosticsReadScope,
  AuthTerminalReadScope,
  EnvironmentAuthorizationError,
  ServerSettingsPatch,
  requiredScopesForServerSettingsPatch,
  AssetCreateUrlInput,
  clientRpcRequiredScopes,
  authScopeRequiredResponse,
  RpcScopeAuthorization,
  AuthAccessReadScope,
  AuthSettingsWriteScope,
  AuthProvidersManageScope,
  AuthEnvironmentMaintainScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  ORCHESTRATION_WS_METHODS,
  type AuthEnvironmentScope,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

/**
 * Keep authorization coverage coupled to the RPC group itself. Adding an RPC to
 * `WsRpcGroup` without choosing a scope is a type error instead of a production
 * runtime failure.
 */
export const RPC_REQUIRED_SCOPES = {
  [WS_METHODS.terminalObserve]: AuthTerminalReadScope,
  [ORCHESTRATION_WS_METHODS.dispatchCommand]: AuthOrchestrationOperateScope,
  [ORCHESTRATION_WS_METHODS.getWorkflowScript]: AuthFilesystemReadScope,
  [ORCHESTRATION_WS_METHODS.getTurnDiff]: AuthFilesystemReadScope,
  [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: AuthFilesystemReadScope,
  [ORCHESTRATION_WS_METHODS.searchThreads]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.subscribeShell]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: AuthOrchestrationReadScope,
  [ORCHESTRATION_WS_METHODS.subscribeThread]: AuthOrchestrationReadScope,
  [WS_METHODS.serverProbe]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetConfig]: AuthOrchestrationReadScope,
  [WS_METHODS.serverRefreshProviders]: AuthOrchestrationReadScope,
  [WS_METHODS.serverUpdateProvider]: AuthProvidersManageScope,
  [WS_METHODS.serverUpdateServer]: AuthEnvironmentMaintainScope,
  [WS_METHODS.serverUpdateServerWithProgress]: AuthEnvironmentMaintainScope,
  [WS_METHODS.serverUpsertKeybinding]: AuthSettingsWriteScope,
  [WS_METHODS.serverRemoveKeybinding]: AuthSettingsWriteScope,
  [WS_METHODS.serverGetSettings]: AuthOrchestrationReadScope,
  [WS_METHODS.serverUpdateSettings]: AuthSettingsWriteScope,
  [WS_METHODS.serverDiscoverSourceControl]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetTraceDiagnostics]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverGetProcessDiagnostics]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverGetHostResources]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetProcessResourceHistory]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverGetResourceTelemetryHistory]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverRetryResourceTelemetry]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverGetUsageSummary]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverRefreshUsageRates]: AuthDiagnosticsReadScope,
  [WS_METHODS.serverGetProviderRateLimits]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetQuotaResumes]: AuthOrchestrationReadScope,
  // Both mutate a thread: cancelling drops a queued turn, running it now
  // starts one. Read-only clients see the countdown but cannot act on it.
  [WS_METHODS.serverCancelQuotaResume]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverRunQuotaResumeNow]: AuthOrchestrationOperateScope,
  [WS_METHODS.automationsList]: AuthOrchestrationReadScope,
  [WS_METHODS.automationsRuns]: AuthOrchestrationReadScope,
  [WS_METHODS.buildSystemsList]: AuthOrchestrationReadScope,
  [WS_METHODS.buildSystemsRuns]: AuthOrchestrationReadScope,
  [WS_METHODS.buildSystemsRunGet]: AuthOrchestrationReadScope,
  // Every mutation here can cause an unattended turn to run, so they all sit
  // behind operate scope rather than read.
  [WS_METHODS.automationsCreate]: AuthOrchestrationOperateScope,
  [WS_METHODS.automationsUpdate]: AuthOrchestrationOperateScope,
  [WS_METHODS.automationsDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.automationsRunNow]: AuthOrchestrationOperateScope,
  [WS_METHODS.automationsRotateWebhookToken]: AuthOrchestrationOperateScope,
  [WS_METHODS.automationsListWebhookDeliveries]: AuthOrchestrationOperateScope,
  [WS_METHODS.automationsGetWebhookDelivery]: AuthOrchestrationOperateScope,
  [WS_METHODS.secretsAnswerRequest]: AuthOrchestrationOperateScope,
  [WS_METHODS.buildSystemsCreate]: AuthOrchestrationOperateScope,
  [WS_METHODS.buildSystemsUpdate]: AuthOrchestrationOperateScope,
  [WS_METHODS.buildSystemsDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.buildSystemsRunStart]: AuthOrchestrationOperateScope,
  [WS_METHODS.buildSystemsRunCancel]: AuthOrchestrationOperateScope,
  [WS_METHODS.buildSystemsRunResolveGate]: AuthOrchestrationOperateScope,
  [WS_METHODS.buildSystemsRunReply]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverTranscribeAudio]: AuthOrchestrationOperateScope,
  [WS_METHODS.serverGetSpeechToTextKeyStatus]: AuthOrchestrationReadScope,
  [WS_METHODS.serverGetSkillsCatalog]: AuthOrchestrationReadScope,
  [WS_METHODS.serverSetSpeechToTextKey]: AuthSettingsWriteScope,
  [WS_METHODS.serverSignalProcess]: AuthEnvironmentMaintainScope,
  [WS_METHODS.serverReportClientActivity]: AuthOrchestrationReadScope,
  [WS_METHODS.serverReportHostPowerState]: AuthEnvironmentMaintainScope,
  [WS_METHODS.serverGetBackgroundPolicy]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsList]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsListStats]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsSummary]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsRouting]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsRoutingIdentity]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsStack]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsLinkedThreads]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsDetail]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsActivity]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsThreadComments]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsDiffFileContents]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsRunAction]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsUpdate]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsComment]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsUpdateComment]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSubmitReview]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsReplyToThread]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetThreadResolution]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsSetReaction]: AuthSourceControlWriteScope,
  // Read scope like the reads it un-caches: refreshing is part of reading, and a read-only
  // client pressing refresh must not be told it may not look again.
  [WS_METHODS.pullRequestsInvalidate]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsSubscribeRefreshes]: AuthOrchestrationReadScope,
  // The candidate list is a read like the detail beside it; asking somebody for a review is a
  // write like every other one.
  [WS_METHODS.pullRequestsReviewerCandidates]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsRequestReviewers]: AuthSourceControlWriteScope,
  [WS_METHODS.pullRequestsLabelCandidates]: AuthOrchestrationReadScope,
  [WS_METHODS.pullRequestsSetLabels]: AuthSourceControlWriteScope,
  [WS_METHODS.sourceControlLookupRepository]: AuthOrchestrationReadScope,
  [WS_METHODS.sourceControlCloneRepository]: AuthSourceControlWriteScope,
  [WS_METHODS.sourceControlPublishRepository]: AuthSourceControlWriteScope,
  [WS_METHODS.projectCloneStart]: AuthSourceControlWriteScope,
  [WS_METHODS.projectCloneCancel]: AuthSourceControlWriteScope,
  [WS_METHODS.projectCloneRetry]: AuthSourceControlWriteScope,
  [WS_METHODS.subscribeProjectClones]: AuthOrchestrationReadScope,
  [WS_METHODS.projectsListEntries]: AuthFilesystemReadScope,
  [WS_METHODS.projectsReadFile]: AuthFilesystemReadScope,
  [WS_METHODS.projectsSearchContents]: AuthFilesystemReadScope,
  [WS_METHODS.projectsSearchEntries]: AuthFilesystemReadScope,
  [WS_METHODS.projectsWriteFile]: AuthFilesystemWriteScope,
  [WS_METHODS.projectsEnsureScratch]: AuthOrchestrationOperateScope,
  [WS_METHODS.projectsCreateNew]: AuthOrchestrationOperateScope,
  [WS_METHODS.shellOpenInEditor]: AuthOrchestrationOperateScope,
  [WS_METHODS.filesystemBrowse]: AuthFilesystemReadScope,
  [WS_METHODS.assetsCreateUrl]: AuthOrchestrationReadScope,
  [WS_METHODS.attachmentsCreateUploadUrl]: AuthOrchestrationOperateScope,
  [WS_METHODS.attachmentsDelete]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeVcsStatus]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeWorktreeSetup]: AuthOrchestrationReadScope,
  [WS_METHODS.worktreeSetupCancel]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeResourceTelemetry]: AuthDiagnosticsReadScope,
  [WS_METHODS.vcsRefreshStatus]: AuthOrchestrationReadScope,
  [WS_METHODS.vcsPull]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsDiscardChanges]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsApplyPatch]: AuthSourceControlWriteScope,
  [WS_METHODS.gitRunStackedAction]: AuthSourceControlWriteScope,
  [WS_METHODS.gitResolvePullRequest]: AuthOrchestrationReadScope,
  [WS_METHODS.gitPreparePullRequestThread]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsListRefs]: AuthOrchestrationReadScope,
  [WS_METHODS.vcsCreateWorktree]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsRemoveWorktree]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsCreateRef]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsSwitchRef]: AuthSourceControlWriteScope,
  [WS_METHODS.vcsInit]: AuthSourceControlWriteScope,
  [WS_METHODS.reviewGetDiffPreview]: AuthFilesystemReadScope,
  [WS_METHODS.reviewGetDiffFileContents]: AuthFilesystemReadScope,
  [WS_METHODS.terminalOpen]: AuthTerminalOperateScope,
  [WS_METHODS.terminalAttach]: AuthTerminalOperateScope,
  [WS_METHODS.terminalWrite]: AuthTerminalOperateScope,
  [WS_METHODS.terminalResize]: AuthTerminalOperateScope,
  [WS_METHODS.terminalClear]: AuthTerminalOperateScope,
  [WS_METHODS.terminalRestart]: AuthTerminalOperateScope,
  [WS_METHODS.terminalClose]: AuthTerminalOperateScope,
  [WS_METHODS.subscribeTerminalEvents]: AuthTerminalReadScope,
  [WS_METHODS.subscribeTerminalMetadata]: AuthTerminalReadScope,
  [WS_METHODS.previewOpen]: AuthPreviewOperateScope,
  [WS_METHODS.previewNavigate]: AuthPreviewOperateScope,
  [WS_METHODS.previewResize]: AuthPreviewOperateScope,
  [WS_METHODS.previewRefresh]: AuthPreviewOperateScope,
  [WS_METHODS.previewClose]: AuthPreviewOperateScope,
  [WS_METHODS.previewList]: AuthOrchestrationReadScope,
  [WS_METHODS.previewReportStatus]: AuthPreviewOperateScope,
  [WS_METHODS.previewAutomationConnect]: AuthPreviewOperateScope,
  [WS_METHODS.previewAutomationRespond]: AuthPreviewOperateScope,
  [WS_METHODS.previewAutomationFocusHost]: AuthPreviewOperateScope,
  [WS_METHODS.subscribePreviewEvents]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeDiscoveredLocalServers]: AuthOrchestrationReadScope,
  [WS_METHODS.deviceConfigure]: AuthSettingsWriteScope,
  [WS_METHODS.deviceTestHost]: AuthSettingsWriteScope,
  [WS_METHODS.deviceList]: AuthOrchestrationReadScope,
  [WS_METHODS.deviceOpen]: AuthOrchestrationOperateScope,
  [WS_METHODS.deviceClose]: AuthOrchestrationOperateScope,
  [WS_METHODS.deviceShutdown]: AuthOrchestrationOperateScope,
  [WS_METHODS.deviceDetail]: AuthOrchestrationReadScope,
  [WS_METHODS.deviceAction]: AuthOrchestrationOperateScope,
  [WS_METHODS.subscribeDeviceState]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeServerConfig]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeServerLifecycle]: AuthOrchestrationReadScope,
  [WS_METHODS.subscribeAuthAccess]: AuthAccessReadScope,
  [WS_METHODS.subscribeBackgroundPolicy]: AuthOrchestrationReadScope,
} as const satisfies Readonly<Record<WsRpcMethod, AuthEnvironmentScope>>;

export function requiredScopeForRpcMethod(method: string): AuthEnvironmentScope {
  if (!Object.hasOwn(RPC_REQUIRED_SCOPES, method)) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  const requiredScope = RPC_REQUIRED_SCOPES[method as WsRpcMethod];
  if (requiredScope === undefined) {
    throw new Error(`RPC method ${method} has no declared authorization scope.`);
  }
  return requiredScope;
}

export const rpcAuthorizationError = (requiredScope: AuthEnvironmentScope) =>
  new EnvironmentAuthorizationError({
    message: `The authenticated token is missing required scope: ${requiredScope}.`,
    ...authScopeRequiredResponse(requiredScope),
  });

const decodeSettingsUpdate = Schema.decodeUnknownSync(
  Schema.Struct({ patch: ServerSettingsPatch }),
);
const decodeDeviceList = Schema.decodeUnknownSync(DeviceListInput);
const decodeAssetCreateUrl = Schema.decodeUnknownSync(AssetCreateUrlInput);

const requiredScopesForSettingsUpdate = (payload: unknown) => {
  const input = decodeSettingsUpdate(payload);
  return requiredScopesForServerSettingsPatch(input.patch);
};

export const requiredScopesForRpcCall = (
  method: string,
  payload: unknown,
): ReadonlyArray<AuthEnvironmentScope> => {
  if (method === WS_METHODS.deviceList)
    return [requiredScopeForDeviceList(decodeDeviceList(payload))];
  if (method === WS_METHODS.serverRetryResourceTelemetry) {
    return [AuthEnvironmentMaintainScope, AuthDiagnosticsReadScope];
  }
  if (method === WS_METHODS.assetsCreateUrl) {
    const { resource } = decodeAssetCreateUrl(payload);
    return [
      resource._tag === "workspace-file" ||
      resource._tag === "media-file" ||
      resource._tag === "draft-workspace-file"
        ? AuthFilesystemReadScope
        : AuthOrchestrationReadScope,
    ];
  }
  if (method === WS_METHODS.serverUpdateSettings) return requiredScopesForSettingsUpdate(payload);
  const guarded = clientRpcRequiredScopes(method, payload);
  if (guarded.length > 0) return guarded;
  return [requiredScopeForRpcMethod(method)];
};

/** Authorizes every RPC on one connection against that connection's session scopes. */
export const layer = (scopes: ReadonlyArray<AuthEnvironmentScope>) =>
  Layer.succeed(RpcScopeAuthorization)((effect, { rpc, payload }) => {
    const requiredScopes = requiredScopesForRpcCall(rpc._tag, payload);
    const requiredScope = requiredScopes.find((scope) => !scopes.includes(scope));
    return requiredScope === undefined ? effect : Effect.fail(rpcAuthorizationError(requiredScope));
  });

/** Retrying can install or restart tools even though ordinary listing is readable. */
export const requiredScopeForDeviceList = (input: DeviceListInput): AuthEnvironmentScope =>
  input.retryHostId || input.updateTool ? AuthSettingsWriteScope : AuthOrchestrationReadScope;

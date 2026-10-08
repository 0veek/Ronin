import { ORCHESTRATION_WS_METHODS, WS_METHODS, type WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware";

import { rpcRequestDuration, rpcRequestsTotal, withMetrics } from "./Metrics.ts";

type WsRpcMethod = RpcGroup.Rpcs<typeof WsRpcGroup>["_tag"];

/**
 * The `rpc.aggregate` span attribute of every WebSocket RPC. Trace queries and dashboards group by
 * these labels, so they keep their historical values even where they differ from the method
 * prefix. Adding an RPC to `WsRpcGroup` without a label is a type error.
 */
const RPC_AGGREGATES = {
  [WS_METHODS.automationsGetWebhookDelivery]: "automations",
  [WS_METHODS.automationsListWebhookDeliveries]: "automations",
  [WS_METHODS.automationsRotateWebhookToken]: "automations",
  [WS_METHODS.secretsAnswerRequest]: "secrets",
  [WS_METHODS.terminalObserve]: "terminal",
  [ORCHESTRATION_WS_METHODS.dispatchCommand]: "orchestration",
  [ORCHESTRATION_WS_METHODS.getWorkflowScript]: "orchestration",
  [ORCHESTRATION_WS_METHODS.getTurnDiff]: "orchestration",
  [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: "orchestration",
  [ORCHESTRATION_WS_METHODS.searchThreads]: "orchestration",
  [ORCHESTRATION_WS_METHODS.subscribeShell]: "orchestration",
  [ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot]: "orchestration",
  [ORCHESTRATION_WS_METHODS.subscribeThread]: "orchestration",
  [WS_METHODS.serverProbe]: "server",
  [WS_METHODS.serverGetConfig]: "server",
  [WS_METHODS.serverRefreshProviders]: "server",
  [WS_METHODS.serverUpdateProvider]: "server",
  [WS_METHODS.serverUpdateServer]: "server",
  [WS_METHODS.serverUpdateServerWithProgress]: "server",
  [WS_METHODS.serverUpsertKeybinding]: "server",
  [WS_METHODS.serverRemoveKeybinding]: "server",
  [WS_METHODS.serverGetSettings]: "server",
  [WS_METHODS.serverUpdateSettings]: "server",
  [WS_METHODS.serverDiscoverSourceControl]: "server",
  [WS_METHODS.serverGetTraceDiagnostics]: "server",
  [WS_METHODS.serverGetProcessDiagnostics]: "server",
  [WS_METHODS.serverGetHostResources]: "server",
  [WS_METHODS.serverGetProcessResourceHistory]: "server",
  [WS_METHODS.serverGetResourceTelemetryHistory]: "server",
  [WS_METHODS.serverGetUsageSummary]: "server",
  [WS_METHODS.serverRefreshUsageRates]: "server",
  [WS_METHODS.serverGetProviderRateLimits]: "server",
  [WS_METHODS.automationsList]: "automations",
  [WS_METHODS.automationsCreate]: "automations",
  [WS_METHODS.automationsUpdate]: "automations",
  [WS_METHODS.automationsDelete]: "automations",
  [WS_METHODS.automationsRunNow]: "automations",
  [WS_METHODS.automationsRuns]: "automations",
  [WS_METHODS.buildSystemsList]: "buildSystems",
  [WS_METHODS.buildSystemsCreate]: "buildSystems",
  [WS_METHODS.buildSystemsUpdate]: "buildSystems",
  [WS_METHODS.buildSystemsDelete]: "buildSystems",
  [WS_METHODS.buildSystemsRunStart]: "buildSystems",
  [WS_METHODS.buildSystemsRunCancel]: "buildSystems",
  [WS_METHODS.buildSystemsRunResolveGate]: "buildSystems",
  [WS_METHODS.buildSystemsRunReply]: "buildSystems",
  [WS_METHODS.buildSystemsRuns]: "buildSystems",
  [WS_METHODS.buildSystemsRunGet]: "buildSystems",
  [WS_METHODS.serverGetQuotaResumes]: "server",
  [WS_METHODS.serverCancelQuotaResume]: "server",
  [WS_METHODS.serverRunQuotaResumeNow]: "server",
  [WS_METHODS.serverGetSkillsCatalog]: "server",
  [WS_METHODS.serverTranscribeAudio]: "server",
  [WS_METHODS.serverGetSpeechToTextKeyStatus]: "server",
  [WS_METHODS.serverSetSpeechToTextKey]: "server",
  [WS_METHODS.serverRetryResourceTelemetry]: "server",
  [WS_METHODS.serverSignalProcess]: "server",
  [WS_METHODS.serverReportClientActivity]: "server",
  [WS_METHODS.serverReportHostPowerState]: "server",
  [WS_METHODS.serverGetBackgroundPolicy]: "server",
  [WS_METHODS.pullRequestsList]: "pull-requests",
  [WS_METHODS.pullRequestsListStats]: "pull-requests",
  [WS_METHODS.pullRequestsRoutingIdentity]: "pull-requests",
  [WS_METHODS.pullRequestsRouting]: "pull-requests",
  [WS_METHODS.pullRequestsSummary]: "pull-requests",
  [WS_METHODS.pullRequestsStack]: "pull-requests",
  [WS_METHODS.pullRequestsLinkedThreads]: "pull-requests",
  [WS_METHODS.pullRequestsDetail]: "pull-requests",
  [WS_METHODS.pullRequestsActivity]: "pull-requests",
  [WS_METHODS.pullRequestsThreadComments]: "pull-requests",
  [WS_METHODS.pullRequestsDiffFileContents]: "pull-requests",
  [WS_METHODS.pullRequestsRunAction]: "pull-requests",
  [WS_METHODS.pullRequestsUpdate]: "pull-requests",
  [WS_METHODS.pullRequestsComment]: "pull-requests",
  [WS_METHODS.pullRequestsUpdateComment]: "pull-requests",
  [WS_METHODS.pullRequestsSubmitReview]: "pull-requests",
  [WS_METHODS.pullRequestsReplyToThread]: "pull-requests",
  [WS_METHODS.pullRequestsSetThreadResolution]: "pull-requests",
  [WS_METHODS.pullRequestsSetReaction]: "pull-requests",
  [WS_METHODS.pullRequestsInvalidate]: "pull-requests",
  [WS_METHODS.pullRequestsSubscribeRefreshes]: "pull-requests",
  [WS_METHODS.pullRequestsReviewerCandidates]: "pull-requests",
  [WS_METHODS.pullRequestsRequestReviewers]: "pull-requests",
  [WS_METHODS.pullRequestsLabelCandidates]: "pull-requests",
  [WS_METHODS.pullRequestsSetLabels]: "pull-requests",
  [WS_METHODS.sourceControlLookupRepository]: "source-control",
  [WS_METHODS.sourceControlCloneRepository]: "source-control",
  [WS_METHODS.projectCloneStart]: "source-control",
  [WS_METHODS.projectCloneCancel]: "source-control",
  [WS_METHODS.projectCloneRetry]: "source-control",
  [WS_METHODS.subscribeProjectClones]: "source-control",
  [WS_METHODS.sourceControlPublishRepository]: "source-control",
  [WS_METHODS.projectsSearchEntries]: "workspace",
  [WS_METHODS.projectsSearchContents]: "workspace",
  [WS_METHODS.projectsListEntries]: "workspace",
  [WS_METHODS.projectsReadFile]: "workspace",
  [WS_METHODS.projectsWriteFile]: "workspace",
  [WS_METHODS.projectsEnsureScratch]: "orchestration",
  [WS_METHODS.projectsCreateNew]: "orchestration",
  [WS_METHODS.shellOpenInEditor]: "workspace",
  [WS_METHODS.filesystemBrowse]: "workspace",
  [WS_METHODS.attachmentsCreateUploadUrl]: "workspace",
  [WS_METHODS.attachmentsDelete]: "workspace",
  [WS_METHODS.assetsCreateUrl]: "workspace",
  [WS_METHODS.subscribeVcsStatus]: "vcs",
  [WS_METHODS.subscribeWorktreeSetup]: "vcs",
  [WS_METHODS.worktreeSetupCancel]: "vcs",
  [WS_METHODS.vcsRefreshStatus]: "vcs",
  [WS_METHODS.vcsPull]: "git",
  [WS_METHODS.vcsDiscardChanges]: "git",
  [WS_METHODS.vcsApplyPatch]: "git",
  [WS_METHODS.gitRunStackedAction]: "vcs",
  [WS_METHODS.gitResolvePullRequest]: "git",
  [WS_METHODS.gitPreparePullRequestThread]: "git",
  [WS_METHODS.vcsListRefs]: "vcs",
  [WS_METHODS.vcsCreateWorktree]: "vcs",
  [WS_METHODS.vcsRemoveWorktree]: "vcs",
  [WS_METHODS.vcsCreateRef]: "vcs",
  [WS_METHODS.vcsSwitchRef]: "vcs",
  [WS_METHODS.vcsInit]: "vcs",
  [WS_METHODS.reviewGetDiffPreview]: "review",
  [WS_METHODS.reviewGetDiffFileContents]: "review",
  [WS_METHODS.terminalOpen]: "terminal",
  [WS_METHODS.terminalAttach]: "terminal",
  [WS_METHODS.terminalWrite]: "terminal",
  [WS_METHODS.terminalResize]: "terminal",
  [WS_METHODS.terminalClear]: "terminal",
  [WS_METHODS.terminalRestart]: "terminal",
  [WS_METHODS.terminalClose]: "terminal",
  [WS_METHODS.subscribeTerminalEvents]: "terminal",
  [WS_METHODS.subscribeTerminalMetadata]: "terminal",
  [WS_METHODS.previewOpen]: "preview",
  [WS_METHODS.previewNavigate]: "preview",
  [WS_METHODS.previewResize]: "preview",
  [WS_METHODS.previewRefresh]: "preview",
  [WS_METHODS.previewClose]: "preview",
  [WS_METHODS.previewList]: "preview",
  [WS_METHODS.previewReportStatus]: "preview",
  [WS_METHODS.previewAutomationConnect]: "preview-automation",
  [WS_METHODS.previewAutomationRespond]: "preview-automation",
  [WS_METHODS.previewAutomationFocusHost]: "preview-automation",
  [WS_METHODS.subscribePreviewEvents]: "preview",
  [WS_METHODS.deviceConfigure]: "device",
  [WS_METHODS.deviceTestHost]: "device",
  [WS_METHODS.deviceList]: "device",
  [WS_METHODS.deviceOpen]: "device",
  [WS_METHODS.deviceClose]: "device",
  [WS_METHODS.deviceShutdown]: "device",
  [WS_METHODS.deviceDetail]: "device",
  [WS_METHODS.deviceAction]: "device",
  [WS_METHODS.subscribeDeviceState]: "device",
  [WS_METHODS.subscribeDiscoveredLocalServers]: "preview",
  [WS_METHODS.subscribeServerConfig]: "server",
  [WS_METHODS.subscribeServerLifecycle]: "server",
  [WS_METHODS.subscribeAuthAccess]: "auth",
  [WS_METHODS.subscribeBackgroundPolicy]: "server",
  [WS_METHODS.subscribeResourceTelemetry]: "server",
} as const satisfies Readonly<Record<WsRpcMethod, string>>;

const RPC_SPAN_PREFIX = "ws.rpc";
const DEFAULT_RPC_SPAN_ATTRIBUTES = {
  "rpc.transport": "websocket",
  "rpc.system": "effect-rpc",
} as const;
const RPC_METHODS_WITH_TRACING_DISABLED: ReadonlySet<string> = new Set([
  WS_METHODS.serverGetTraceDiagnostics,
  WS_METHODS.serverGetProcessDiagnostics,
  WS_METHODS.serverGetProcessResourceHistory,
  WS_METHODS.serverSignalProcess,
]);

/**
 * Records each WebSocket RPC's span and request metrics. `ws.ts` adds it to the server's group
 * after `RpcScopeAuthorization`, so it wraps authorization and also records rejected calls.
 */
export class RpcInstrumentation extends RpcMiddleware.Service<RpcInstrumentation>()(
  "t3/server/RpcInstrumentation",
) {}

/**
 * Wraps each WebSocket RPC call in its `ws.rpc.<method>` span and records its request counter and
 * duration. For a stream RPC, the middleware receives the whole stream run, so the span and the
 * metrics cover the subscription until it ends, fails, or is interrupted. Methods in
 * `RPC_METHODS_WITH_TRACING_DISABLED` record metrics but no spans, for the call or anything it runs.
 */
export const rpcInstrumentationLayer = Layer.succeed(RpcInstrumentation)((effect, { rpc }) => {
  const method = rpc._tag;
  const measured = effect.pipe(
    withMetrics({ counter: rpcRequestsTotal, timer: rpcRequestDuration, attributes: { method } }),
  );

  if (RPC_METHODS_WITH_TRACING_DISABLED.has(method)) {
    return measured.pipe(Effect.provideService(References.TracerEnabled, false));
  }
  return measured.pipe(
    Effect.withSpan(`${RPC_SPAN_PREFIX}.${method}`, {
      attributes: {
        ...DEFAULT_RPC_SPAN_ATTRIBUTES,
        "rpc.method": method,
        "rpc.aggregate": RPC_AGGREGATES[method as WsRpcMethod],
      },
    }),
  );
});

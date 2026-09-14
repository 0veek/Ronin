import type {
  ApprovalRequestId,
  AssistantCitation,
  ChatFileAttachment,
  EnvironmentId,
  ModelSelection,
  PreviewAnnotationPayload,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  ScopedThreadRef,
  ServerProvider,
  SnapShotSource,
  ThreadId,
} from "@t3tools/contracts";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
} from "@t3tools/contracts";
import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import {
  isPasteAsTextShortcut,
  nextPastedTextFileName,
  pastedTextDisposition,
  wouldTextPasteExceedLimit,
} from "@t3tools/client-runtime/text-paste";
import {
  COMPOSER_SLASH_COMMAND_DEFINITIONS,
  getAvailableComposerSlashCommands,
  normalizeComposerSlashCommandName,
  shouldHideProviderNativeSlashCommand,
  type BuiltInComposerSlashCommand,
} from "@t3tools/shared/composerSlashCommands";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { createModelSelection, normalizeModelSlug } from "@t3tools/shared/model";
import {
  memo,
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  changeQuestionAttachmentPreparation,
  countQuestionAttachments,
  questionAttachmentDraftId,
  useQuestionAttachmentPreparation,
} from "../../questionAttachments";
import { createPortal } from "react-dom";
import {
  clampCollapsedComposerCursor,
  type ComposerSubmissionIntent,
  type ComposerTrigger,
  collapseExpandedComposerCursor,
  composerSubmissionIntentForEnter,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  formatAssistantCitationForComposer,
  replaceTextRange,
} from "../../composer-logic";
import { DISCONNECTED_COMPOSER_PLACEHOLDER } from "../../composerPlaceholder";
import {
  deriveComposerSendState,
  readFileAsDataUrl,
  threadShellHasStarted,
} from "../ChatView.logic";
import {
  dataTransferHasComposerMention,
  makeComposerMentionDragHandlers,
} from "./composerMentionDrag";
import {
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type DraftId,
  type PersistedComposerFileAttachment,
  type PersistedComposerImageAttachment,
  composerFileDedupKey,
  composerFileMatchesReattachMarker,
  composerFileNeedsReattach,
  composerTargetKey,
  hydrateImagesFromPersisted,
  useComposerDraftStore,
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from "../../composerDraftStore";
import {
  MAX_STASH_ENTRIES,
  partitionStashAttachments,
  usePromptStashStore,
  type PromptStashEntry,
} from "../../promptStashStore";
import { ComposerStashBadge } from "./ComposerStashBadge";
import { ComposerStashMenu } from "./ComposerStashMenu";
import { compressImageForStash, prepareImageForAttachment } from "../../lib/imageCompression";
import {
  fileAttachmentTooLargeMessage,
  formatAttachmentSize,
} from "@t3tools/client-runtime/state/attachments";
import {
  attachmentsToReleaseOnUploadCapabilityLoss,
  classifyComposerAttachmentFile,
  fileAttachmentCapabilityBlockReason,
  fileAttachmentStagingLimit,
  isPreviewableComposerVideo,
  normalizeComposerImageFileMimeType,
  shouldHandleComposerAttachmentPaste,
} from "./composerAttachmentFiles";
import {
  readAttachmentUpload,
  releaseAttachmentUpload,
  releaseDraftAttachment,
  releasePersistedAttachmentUpload,
  retryAttachmentUpload,
  startAttachmentUpload,
  useAttachmentUploadStore,
  verifyStashedAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import {
  attachmentUploadBlockReason,
  formatAttachmentUploadProgress,
} from "../../lib/attachmentUploadState";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { getTerminalFocusOwner } from "../../lib/terminalFocus";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../../keybindings";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../../lib/terminalContext";
import { useComposerPathSearch } from "../../lib/composerPathSearchState";
import {
  collectInlineContextIds,
  inlineContextReferenceReplacement,
  insertInlineContextReference,
} from "../../lib/composerContextReferences";
import { readPastedComposerContext } from "../composerInlineTokenPaste";
import { DESKTOP_PASTE_AS_TEXT_EVENT } from "../../lib/desktopPasteAsText";
import {
  fileContextReference,
  previewAnnotationContextId,
  reviewCommentContextId,
  terminalContextReference,
} from "../../lib/composerContextRecords";
import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
} from "../composerFooterLayout";
import { observeResponsiveBreakpointFade, usePanelAnimationSettings } from "../../panelAnimations";
import { type ComposerPromptEditorHandle, ComposerPromptEditor } from "../ComposerPromptEditor";
import {
  ComposerContextActionsContext,
  composerContextRecordsFromDraft,
} from "../composerContextPresentation";
import { useOpenPrLink } from "../../lib/openPullRequestLink";
import { useRightPanelStore } from "../../rightPanelStore";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { type ComposerCommandItem, ComposerCommandMenu } from "./ComposerCommandMenu";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { ComposerImageThumbnail } from "./ComposerImageThumbnail";
import {
  ComposerDictationContext,
  createComposerDictationInsert,
} from "./composerDictationContext";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";
import { ComposerControlIcon, ComposerSelectControl } from "./ComposerControl";
import { resolveComposerMenuActiveItemId } from "./composerMenuHighlight";
import { searchSlashCommandItems } from "./composerSlashCommandSearch";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderState";
import { ContextWindowMeter, ContextWindowMeterPlaceholder } from "./ContextWindowMeter";
import {
  providerSupportsManualCompaction,
  resolveContextWindowModelDisplayName,
  shouldReserveContextWindowMeter,
} from "./ContextWindowMeter.logic";
import {
  attachVideoThumbnail,
  buildExpandedImagePreview,
  type ExpandedImagePreview,
} from "./ExpandedImagePreview";
import {
  SNAP_SHOT_ATTACHMENT_FRAME_CLASS,
  SnapShotAttachmentDetails,
} from "./SnapShotAttachmentDetails";
import {
  getPendingSnapShotAnimations,
  pendingSnapShotAnimationIdsForTarget,
  scheduleSnapShotAnimationDestination,
  setSnapShotAnimationDestination,
  shouldAnimateSnapShotArrival,
  subscribeToPendingSnapShotAnimations,
} from "../../lib/snapShotAnimation";
import { resizeSnapShotSource } from "../../lib/snapShotSource";
import { basenameOfPath } from "../../pierre-icons";
import { cn, isMacPlatform, randomUUID } from "~/lib/utils";
import { Separator } from "../ui/separator";
import {
  getComposerPromptLengthValidationMessage,
  getComposerSubmissionValidationMessage,
  submitComposerDraft,
} from "./composerSubmission";
import { ComposerPromptLengthValidation } from "./ComposerPromptLengthValidation";
import { PierreEntryIcon } from "./PierreEntryIcon";

function ComposerVideoThumbnail({ file }: { file: File }) {
  const setVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) return;
      return attachVideoThumbnail(video, file);
    },
    [file],
  );

  return (
    <video
      ref={setVideo}
      muted
      playsInline
      preload="metadata"
      aria-hidden="true"
      onLoadedMetadata={(event) => {
        event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration || 0);
      }}
      className="pointer-events-none absolute inset-0 size-full object-cover"
    />
  );
}

type ComposerCommandMenuPosition = {
  bottom: number;
  left: number;
  maxHeight: number;
  width: number;
};

function SnapShotAttachmentFrame({
  animationId,
  animationSource,
  arrival,
  animateArrival,
  className,
  ...props
}: ComponentProps<"div"> & {
  readonly animationId?: string | undefined;
  readonly animationSource?: SnapShotSource | undefined;
  readonly arrival?: boolean | undefined;
  readonly animateArrival?: boolean | undefined;
}) {
  const frameRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || (!animationId && !arrival)) return;
    frame.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!animationId) return;

    return scheduleSnapShotAnimationDestination(animationId, () =>
      setSnapShotAnimationDestination(animationId, frame, animationSource),
    );
  }, [animationId, animationSource, arrival]);

  return (
    <div
      ref={frameRef}
      className={cn(
        animateArrival &&
          !animationId &&
          "origin-center transition-[opacity,scale] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] starting:scale-95 starting:opacity-0 motion-reduce:transition-none motion-reduce:starting:scale-100 motion-reduce:starting:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function composerCommandMenuPositionsEqual(
  a: ComposerCommandMenuPosition,
  b: ComposerCommandMenuPosition,
): boolean {
  return (
    a.bottom === b.bottom && a.left === b.left && a.maxHeight === b.maxHeight && a.width === b.width
  );
}

function ComposerCommandMenuLayer(props: { anchor: HTMLElement | null; children: ReactNode }) {
  const [position, setPosition] = useState<ComposerCommandMenuPosition | null>(null);

  useLayoutEffect(() => {
    const anchor = props.anchor;
    if (!anchor) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const next = {
        bottom: window.innerHeight - rect.top + 8,
        left: rect.left,
        maxHeight: Math.max(96, rect.top - 24),
        width: rect.width,
      };
      setPosition((current) =>
        current && composerCommandMenuPositionsEqual(current, next) ? current : next,
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    if (observer) {
      // The composer is centered and capped at a max width, so opening a side
      // panel slides it sideways without ever resizing it. Watching the anchor
      // alone would leave the menu behind; the ancestors are what shrink, and
      // they resize on every frame of the panel animation.
      observer.observe(anchor);
      for (let element = anchor.parentElement; element; element = element.parentElement) {
        observer.observe(element);
      }
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.anchor]);

  if (!position) return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[70]"
      style={{
        bottom: position.bottom,
        left: position.left,
        maxHeight: position.maxHeight,
        width: position.width,
      }}
    >
      {props.children}
    </div>,
    document.body,
  );
}
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  BotIcon,
  BugIcon,
  CircleAlertIcon,
  PaperclipIcon,
  PencilRulerIcon,
  PlayIcon,
  type LucideIcon,
  LockIcon,
  LockOpenIcon,
  PenLineIcon,
  RotateCcwIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { proposedPlanTitle } from "../../proposedPlan";
import { getProviderInteractionModeToggle } from "../../providerModels";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
  resolveProviderDriverKindForInstanceSelection,
  resolveSelectableProviderInstanceEntry,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { type AppModelOption, getAppModelOptionsForInstance } from "../../modelSelection";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { type SessionPhase, type Thread, type ThreadShell, videoMimeType } from "../../types";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import { mergeProviderSkillCatalogs, searchProviderSkills } from "../../providerSkillSearch";
import { useEnvironmentSkillsCatalog } from "../../state/skillsCatalog";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { ReviewCommentContext } from "../../reviewCommentContext";

const interactionModeConfig: Record<
  ProviderInteractionMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  default: {
    label: "Build",
    description: "Normal chat. The agent answers and edits as usual.",
    icon: BotIcon,
  },
  plan: {
    label: "Plan",
    description: "Agree on a plan before any code is written.",
    icon: PencilRulerIcon,
  },
  debug: {
    label: "Debug",
    description: "Reproduce, find the root cause, fix, then verify.",
    icon: BugIcon,
  },
};

const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];
const COMPOSER_FLOATING_LAYER_SELECTOR = [
  '[data-slot="popover-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

const extendReplacementRangeForTrailingSpace = (
  text: string,
  rangeEnd: number,
  replacement: string,
): number => {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
};

function isInsideComposerFloatingLayer(element: Element): boolean {
  return element.closest(COMPOSER_FLOATING_LAYER_SELECTOR) !== null;
}

const ComposerFooterModeControls = memo(function ComposerFooterModeControls(props: {
  showPlanMode: boolean;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  onInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const runtimeModeOption = runtimeModeConfig[props.runtimeMode];
  const RuntimeModeIcon = runtimeModeOption.icon;
  // Plan is provider- and flag-gated; Build and Debug always apply because
  // debug is carried by prompt instructions rather than a native mode.
  const interactionModeOptions: ProviderInteractionMode[] = props.showPlanMode
    ? ["default", "plan", "debug"]
    : ["default", "debug"];
  const interactionModeOption = interactionModeConfig[props.interactionMode];
  const InteractionModeIcon = interactionModeOption.icon;

  const interactionModeToggle = (
    <>
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
      <Tooltip>
        <Select
          value={props.interactionMode}
          onValueChange={(value) => props.onInteractionModeChange(value!)}
        >
          <TooltipTrigger
            render={<ComposerSelectControl className="font-medium" aria-label="Interaction mode" />}
          >
            <ComposerControlIcon icon={InteractionModeIcon} />
            <SelectValue>{interactionModeOption.label}</SelectValue>
          </TooltipTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {interactionModeOptions.map((mode) => {
              const option = interactionModeConfig[mode];
              const OptionIcon = option.icon;
              return (
                <SelectItem key={mode} value={mode} hideIndicator className="min-w-64 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                        <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        {option.label}
                      </span>
                      <span className="text-muted-foreground text-xs leading-4">
                        {option.description}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
        <TooltipPopup side="top">{interactionModeOption.description}</TooltipPopup>
      </Tooltip>
    </>
  );

  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />

      <Tooltip>
        <Select
          value={props.runtimeMode}
          onValueChange={(value) => props.onRuntimeModeChange(value!)}
        >
          <TooltipTrigger
            render={<ComposerSelectControl className="font-medium" aria-label="Runtime mode" />}
          >
            <ComposerControlIcon icon={RuntimeModeIcon} />
            <SelectValue>{runtimeModeOption.label}</SelectValue>
          </TooltipTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {runtimeModeOptions.map((mode) => {
              const option = runtimeModeConfig[mode];
              const OptionIcon = option.icon;
              return (
                <SelectItem key={mode} value={mode} hideIndicator className="min-w-64 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                        <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        {option.label}
                      </span>
                      <span className="text-muted-foreground text-xs leading-4">
                        {option.description}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
        <TooltipPopup side="top">{runtimeModeOption.description}</TooltipPopup>
      </Tooltip>

      {interactionModeToggle}
    </>
  );
});

const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  compact: boolean;
  activeContextWindow: ContextWindowSnapshot | null;
  reserveContextWindowMeter: boolean;
  activeThreadModelDisplayName: string | null;
  isPreparingWorktree: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  showSendWhileRunning?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  onSecondOpinion?: (() => void) | null;
  onCompactContext?: (() => void) | undefined;
  compactDisabled: boolean;
  compactDisabledReason: string | null;
}) {
  return (
    <>
      {props.activeContextWindow ? (
        <ContextWindowMeter
          usage={props.activeContextWindow}
          modelDisplayName={props.activeThreadModelDisplayName}
          onCompact={props.onCompactContext}
          compactDisabled={props.compactDisabled}
          compactDisabledReason={props.compactDisabledReason}
        />
      ) : props.reserveContextWindowMeter ? (
        <ContextWindowMeterPlaceholder />
      ) : null}
      {props.isPreparingWorktree ? (
        <span className="text-secondary-label text-xs">Preparing worktree...</span>
      ) : null}
      <ComposerPrimaryActions
        compact={props.compact}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        showPlanFollowUpPrompt={props.showPlanFollowUpPrompt}
        promptHasText={props.promptHasText}
        isSendBusy={props.isSendBusy}
        sendDisabledReason={props.sendDisabledReason}
        isConnecting={props.isConnecting}
        isEnvironmentUnavailable={props.isEnvironmentUnavailable}
        isPreparingWorktree={props.isPreparingWorktree}
        hasSendableContent={props.hasSendableContent}
        preserveComposerFocusOnPointerDown={props.preserveComposerFocusOnPointerDown ?? false}
        showSendWhileRunning={props.showSendWhileRunning ?? false}
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
        onImplementPlanInNewThread={props.onImplementPlanInNewThread}
        onSecondOpinion={props.onSecondOpinion ?? null}
      />
    </>
  );
});

// --------------------------------------------------------------------------
// Handle exposed to ChatView
// --------------------------------------------------------------------------

export interface ChatComposerHandle {
  focusAtEnd: () => void;
  focusAt: (cursor: number) => void;
  addDroppedFiles: (files: File[]) => void;
  hasPendingAttachments: () => boolean;
  insertTextAtEnd: (text: string, options?: { ensureLeadingBoundary?: boolean }) => boolean;
  /** Apply large-paste folding for text redirected from a blurred composer. */
  pasteTextAtEnd: (text: string, options?: { bypassAutoAttachment?: boolean }) => boolean;
  citeAssistantText: (
    citation: AssistantCitation,
    sourceAnchor: AssistantCitationSourceAnchor,
  ) => boolean;
  openModelPicker: () => void;
  toggleModelPicker: () => void;
  isModelPickerOpen: () => boolean;
  compactContext: () => void;
  readSnapshot: () => {
    value: string;
    cursor: number;
    expandedCursor: number;
    contextIds: string[];
  };
  /** Reset composer cursor/trigger/highlight after external prompt mutations (e.g. onSend). */
  resetCursorState: (options?: {
    cursor?: number;
    prompt?: string;
    detectTrigger?: boolean;
  }) => void;
  /** Insert a terminal context from the terminal drawer. */
  addTerminalContext: (selection: TerminalContextSelection) => void;
  /** Get the current prompt/effort/model state for use in send. */
  getSendContext: () => {
    prompt: string;
    images: ComposerImageAttachment[];
    files: ComposerFileAttachment[];
    terminalContexts: TerminalContextDraft[];
    previewAnnotations: PreviewAnnotationPayload[];
    reviewComments: ReviewCommentContext[];
    selectedPromptEffort: string | null;
    selectedModelOptionsForDispatch: unknown;
    selectedModelSelection: ModelSelection;
    interactionMode: ProviderInteractionMode;
    providerAvailable: boolean;
    selectedProvider: ProviderDriverKind;
    selectedModel: string;
    selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
  };
  /** Validate the fully composed text immediately before a provider turn starts. */
  validateProviderInput: (providerInput: string) => boolean;
}

// --------------------------------------------------------------------------
// Props
// --------------------------------------------------------------------------

export interface ChatComposerProps {
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  attachmentUploadsCapabilityKnown: boolean;
  supportsAttachmentUploads: boolean;
  supportsQuestionAttachments: boolean;
  maxFileAttachmentBytes: number | null;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
  draftId: DraftId | null;

  // Thread context
  activeThreadId: ThreadId | null;
  activeThreadEnvironmentId: EnvironmentId | undefined;
  activeThread: Thread | undefined;
  /** The routed server thread's shell, present before its detail loads. */
  activeThreadShell: ThreadShell | null;
  isServerThread: boolean;
  isLocalDraftThread: boolean;
  forceExpandedOnMobile: boolean;
  projectSelectionRequired: boolean;

  // Session phase
  phase: SessionPhase;
  isConnecting: boolean;
  isSendBusy: boolean;
  isRevertingCheckpoint?: boolean;
  sendDisabledReason: string | null;
  isPreparingWorktree: boolean;
  environmentUnavailable: {
    readonly label: string;
    readonly connection: EnvironmentConnectionPresentation;
  } | null;

  // Pending approvals / inputs
  activePendingApproval: PendingApproval | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  activePendingProgress: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    customAnswer: string;
    activeQuestion: {
      id: string;
      multiSelect?: boolean | undefined;
      allowCustomAnswer?: boolean | undefined;
    } | null;
  } | null;
  activePendingResolvedAnswers: Record<string, unknown> | null;
  activePendingIsResponding: boolean;
  activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  activePendingQuestionIndex: number;
  respondingRequestIds: ApprovalRequestId[];

  // Plan
  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: Thread["proposedPlans"][number] | null;

  // Mode
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;

  // Provider / model
  lockedProvider: ProviderDriverKind | null;
  providerStatuses: ServerProvider[];
  /** False until the environment's server config has arrived at least once. */
  providerCatalogKnown: boolean;
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;

  // Context window
  activeContextWindow: ContextWindowSnapshot | null;
  compactThreadUnavailable: boolean;
  compactDisabled: boolean;
  compactDisabledReason: string | null;

  // Misc
  resolvedTheme: "light" | "dark";
  settings: UnifiedSettings;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  gitCwd: string | null;

  // Refs the parent needs kept in sync
  promptRef: React.RefObject<string>;
  composerImagesRef: React.RefObject<ComposerImageAttachment[]>;
  composerFilesRef: React.RefObject<ComposerFileAttachment[]>;
  composerTerminalContextsRef: React.RefObject<TerminalContextDraft[]>;
  composerRef: React.RefObject<ChatComposerHandle | null>;
  onPageScrollKeyDown: (key: "PageUp" | "PageDown") => void;
  onPageScrollKeyUp: (key: string) => void;
  onPageScrollRelease: () => void;

  // Callbacks
  onCompactContext: () => void;
  onSend: (e?: { preventDefault: () => void }, intent?: ComposerSubmissionIntent) => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  /** Race this prompt across several models. Absent hides the control. */
  onSecondOpinion?: (() => void) | null;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
  onSelectActivePendingUserInputOption: (questionId: string, optionLabel: string) => void;
  onAdvanceActivePendingUserInput: () => void;
  onDismissActivePendingUserInput: (requestId: ApprovalRequestId) => void;
  onPreviousActivePendingUserInputQuestion: () => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;

  onProviderModelSelect: (instanceId: ProviderInstanceId, model: string) => void;
  getModelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  toggleInteractionMode: () => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;
  onAppSlashCommand?: (
    command: Exclude<BuiltInComposerSlashCommand, "model" | "plan" | "debug" | "default">,
  ) => void;

  focusComposer: () => void;
  scheduleComposerFocus: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
  onExpandImage: (preview: ExpandedImagePreview) => void;
  onFileOpen: (attachment: ChatFileAttachment) => void;
  openingVideoAttachmentId: string | null;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export const ChatComposer = memo(function ChatComposer(props: ChatComposerProps) {
  const {
    composerDraftTarget,
    environmentId,
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    supportsQuestionAttachments,
    maxFileAttachmentBytes,
    routeKind,
    routeThreadRef,
    draftId,
    activeThreadId,
    activeThreadEnvironmentId: _activeThreadEnvironmentId,
    activeThread,
    isServerThread: _isServerThread,
    isLocalDraftThread: _isLocalDraftThread,
    forceExpandedOnMobile,
    projectSelectionRequired,
    phase,
    isConnecting,
    isSendBusy,
    isRevertingCheckpoint = false,
    sendDisabledReason: externalSendDisabledReason,
    isPreparingWorktree,
    environmentUnavailable,
    activePendingApproval,
    pendingApprovals,
    pendingUserInputs,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    respondingRequestIds,
    showPlanFollowUpPrompt,
    activeProposedPlan,
    runtimeMode,
    interactionMode,
    lockedProvider,
    providerStatuses,
    providerCatalogKnown,
    activeProjectDefaultModelSelection,
    activeThreadModelSelection,
    activeContextWindow,
    compactThreadUnavailable,
    compactDisabled,
    compactDisabledReason,
    resolvedTheme,
    settings,
    keybindings,
    terminalOpen,
    gitCwd,
    promptRef,
    composerRef,
    composerImagesRef,
    composerFilesRef,
    composerTerminalContextsRef,
    onPageScrollKeyDown,
    onPageScrollKeyUp,
    onPageScrollRelease,
    onCompactContext,
    onSend,
    onInterrupt,
    onImplementPlanInNewThread,
    onSecondOpinion,
    onRespondToApproval,
    onSelectActivePendingUserInputOption,
    onAdvanceActivePendingUserInput,
    onDismissActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
    onChangeActivePendingUserInputCustomAnswer,
    onProviderModelSelect,
    getModelDisabledReason,
    toggleInteractionMode,
    handleRuntimeModeChange,
    handleInteractionModeChange,
    onAppSlashCommand,
    focusComposer,
    scheduleComposerFocus,
    setThreadError,
    onExpandImage,
    onFileOpen,
    openingVideoAttachmentId,
  } = props;
  const discoveredSkillsCatalog = useEnvironmentSkillsCatalog(environmentId, gitCwd);

  // ------------------------------------------------------------------
  // Store subscriptions (prompt / images / terminal contexts)
  // ------------------------------------------------------------------
  const composerDraft = useComposerThreadDraft(composerDraftTarget);
  // Live target key, for async flows that must notice a thread switch that
  // happened while they awaited.
  const composerDraftTargetKeyRef = useRef("");
  composerDraftTargetKeyRef.current = composerTargetKey(composerDraftTarget);
  const questionAttachmentTarget =
    pendingUserInputs[0] && activePendingProgress?.activeQuestion && activeThreadId
      ? questionAttachmentDraftId(
          environmentId,
          activeThreadId,
          pendingUserInputs[0].requestId,
          activePendingProgress.activeQuestion.id,
        )
      : null;
  const attachmentDraftTarget = questionAttachmentTarget ?? composerDraftTarget;
  const attachmentDraft = useComposerThreadDraft(attachmentDraftTarget);
  const attachmentTargetKey = composerTargetKey(attachmentDraftTarget);
  const questionPreparations = useQuestionAttachmentPreparation((state) => state.counts);
  const prompt = composerDraft.prompt;
  const composerImages = attachmentDraft.images;
  const composerFiles = attachmentDraft.files;
  const composerVideos = composerFiles.filter((file) =>
    isPreviewableComposerVideo(file, environmentId),
  );
  const composerOtherFiles = composerFiles.filter(
    (file) => !isPreviewableComposerVideo(file, environmentId),
  );
  const composerTerminalContexts = composerDraft.terminalContexts;
  const composerPreviewAnnotations = composerDraft.previewAnnotations;
  const composerReviewComments = composerDraft.reviewComments;
  const pendingSnapShotAnimations = useSyncExternalStore(
    subscribeToPendingSnapShotAnimations,
    getPendingSnapShotAnimations,
    getPendingSnapShotAnimations,
  );
  const pendingSnapShotIds = useMemo(
    () => pendingSnapShotAnimationIdsForTarget(pendingSnapShotAnimations, composerDraftTarget),
    [composerDraftTarget, pendingSnapShotAnimations],
  );
  const pendingSnapShotIdSet = useMemo(() => new Set(pendingSnapShotIds), [pendingSnapShotIds]);
  const uncommittedSnapShotIds = pendingSnapShotIds.filter(
    (id) => !composerImages.some((image) => image.id === id),
  );
  const standaloneComposerImages = useMemo(() => {
    const previewAnnotationIds = new Set(
      composerPreviewAnnotations.map((annotation) => annotation.id),
    );
    return composerImages.filter((image) => !previewAnnotationIds.has(image.id));
  }, [composerImages, composerPreviewAnnotations]);
  const nonPersistedComposerImageIds = attachmentDraft.nonPersistedImageIds;
  const uploadsByImageId = useAttachmentUploadStore((state) => state.uploadsByImageId);
  const openPrLink = useOpenPrLink(routeThreadRef);
  const composerContextRecords = useMemo(
    () =>
      composerContextRecordsFromDraft({
        terminalContexts: composerTerminalContexts,
        reviewComments: composerReviewComments,
        previewAnnotations: composerPreviewAnnotations,
        images: composerImages,
        files: composerFiles,
        uploadsByImageId,
      }),
    [
      composerFiles,
      composerImages,
      composerPreviewAnnotations,
      composerReviewComments,
      composerTerminalContexts,
      uploadsByImageId,
    ],
  );
  const composerContextActions = useMemo(
    () => ({
      expandImage: (imageId: string) => {
        const preview = buildExpandedImagePreview(composerImages, imageId);
        if (preview) onExpandImage(preview);
      },
      expandVideo: (fileId: string) => {
        const file = composerFiles.find((candidate) => candidate.id === fileId);
        if (!file) return;
        const preview = buildExpandedImagePreview([file], file.id);
        if (preview) onExpandImage(preview);
      },
      openFile: (fileId: string) => {
        const file = composerFiles.find((candidate) => candidate.id === fileId);
        if (!file?.uploadedAttachmentId) return;
        onFileOpen({ ...file, id: file.uploadedAttachmentId });
      },
      openMention: (path: string) => useRightPanelStore.getState().openFile(routeThreadRef, path),
      openPullRequest: (event: React.MouseEvent<HTMLElement>, url: string) => {
        openPrLink(event, url);
      },
    }),
    [composerFiles, composerImages, onExpandImage, onFileOpen, openPrLink, routeThreadRef],
  );
  const needsReattachFileCount = composerFiles.filter(composerFileNeedsReattach).length;
  const fileStagingLimit = fileAttachmentStagingLimit({
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    maxFileAttachmentBytes,
  });
  const fileCapabilityBlockReason = fileAttachmentCapabilityBlockReason({
    files: composerFiles,
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    maxFileAttachmentBytes,
  });
  const attachmentBlockReason =
    (questionAttachmentTarget &&
    !supportsQuestionAttachments &&
    (composerImages.length > 0 || composerFiles.length > 0)
      ? "Update this server to send files with question answers"
      : null) ??
    fileCapabilityBlockReason ??
    (supportsAttachmentUploads
      ? needsReattachFileCount > 0
        ? needsReattachFileCount === 1
          ? "Attach the interrupted file again or remove it"
          : "Attach the interrupted files again or remove them"
        : attachmentUploadBlockReason({
            imageIds: [...composerImages, ...composerFiles].map((attachment) => attachment.id),
            uploadsByImageId,
            environmentId,
          })
      : null);
  const sendDisabledReason = externalSendDisabledReason ?? attachmentBlockReason;
  const isSendDisabled = sendDisabledReason !== null;

  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const removeComposerDraftImage = useComposerDraftStore((store) => store.removeImage);
  const addComposerDraftFiles = useComposerDraftStore((store) => store.addFiles);
  const removeComposerDraftFile = useComposerDraftStore((store) => store.removeFile);
  const setComposerDraftFileUpload = useComposerDraftStore((store) => store.setFileUpload);
  const insertComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.insertTerminalContext,
  );
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const removeComposerDraftPreviewAnnotation = useComposerDraftStore(
    (store) => store.removePreviewAnnotation,
  );
  const removeComposerDraftReviewComment = useComposerDraftStore(
    (store) => store.removeReviewComment,
  );
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.clearPersistedAttachments,
  );
  const clearComposerDraftPromptAndImages = useComposerDraftStore(
    (store) => store.clearComposerPromptAndImages,
  );
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPersistedAttachments,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);

  useEffect(() => {
    if (!attachmentUploadsCapabilityKnown) {
      return;
    }
    if (!supportsAttachmentUploads) {
      // The capability can flap on reconnect or version skew. Deleting a
      // persisted hydrated upload here would make the next send fail
      // verification while the file still sits in the draft.
      for (const attachment of attachmentsToReleaseOnUploadCapabilityLoss([
        ...composerImages,
        ...composerFiles,
      ])) {
        releaseAttachmentUpload(attachment.id);
      }
      return;
    }
    const invalidFiles =
      maxFileAttachmentBytes === null
        ? composerFiles
        : composerFiles.filter((file) => file.sizeBytes > maxFileAttachmentBytes);
    for (const attachment of attachmentsToReleaseOnUploadCapabilityLoss(invalidFiles)) {
      releaseAttachmentUpload(attachment.id);
    }
    const uploadableFiles =
      maxFileAttachmentBytes === null
        ? []
        : composerFiles.filter((file) => file.sizeBytes <= maxFileAttachmentBytes);
    const uploadableAttachments = [...composerImages, ...uploadableFiles];
    for (const attachment of uploadableAttachments) {
      // A needs-reattach file has no bytes to upload and no upload to verify.
      if (attachment.type === "file" && composerFileNeedsReattach(attachment)) {
        continue;
      }
      startAttachmentUpload({
        environmentId,
        image: attachment,
        draftTarget: attachmentDraftTarget,
      });
    }
  }, [
    attachmentUploadsCapabilityKnown,
    attachmentDraftTarget,
    composerFiles,
    composerImages,
    environmentId,
    maxFileAttachmentBytes,
    supportsAttachmentUploads,
  ]);

  useEffect(() => {
    for (const file of composerFiles) {
      if (
        !attachmentUploadsCapabilityKnown ||
        !supportsAttachmentUploads ||
        maxFileAttachmentBytes === null ||
        file.sizeBytes > maxFileAttachmentBytes
      ) {
        continue;
      }
      const upload = uploadsByImageId[file.id];
      if (upload?.status === "ready" && upload.environmentId === environmentId) {
        setComposerDraftFileUpload(
          attachmentDraftTarget,
          file.id,
          environmentId,
          upload.attachmentId,
        );
      }
    }
  }, [
    attachmentUploadsCapabilityKnown,
    attachmentDraftTarget,
    composerFiles,
    environmentId,
    maxFileAttachmentBytes,
    setComposerDraftFileUpload,
    supportsAttachmentUploads,
    uploadsByImageId,
  ]);

  // ------------------------------------------------------------------
  // Model state
  // ------------------------------------------------------------------
  // Instance-aware projection of the wire provider list. One entry per
  // configured instance (default built-in + any custom `providerInstances.*`),
  // sorted default-first per driver kind for a stable picker order.
  const providerInstanceEntries = useMemo<ReadonlyArray<ProviderInstanceEntry>>(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providerStatuses), settings),
      ),
    [providerStatuses, settings],
  );
  const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
  const threadProvider =
    activeThread?.session?.providerInstanceId ??
    activeThreadModelSelection?.instanceId ??
    activeProjectDefaultModelSelection?.instanceId ??
    null;
  const explicitSelectedInstanceId = selectedProviderByThreadId ?? threadProvider;

  const unlockedSelectedProvider =
    resolveProviderDriverKindForInstanceSelection(
      providerInstanceEntries,
      providerStatuses,
      explicitSelectedInstanceId,
    ) ??
    providerInstanceEntries[0]?.driverKind ??
    ProviderDriverKind.make("unconfigured");
  const requestedDriverKind: ProviderDriverKind = lockedProvider ?? unlockedSelectedProvider;
  const lockedContinuationGroupKey = useMemo((): string | null => {
    if (!lockedProvider || !activeThread) return null;
    const lockedInstanceId =
      activeThread.session?.providerInstanceId ?? activeThreadModelSelection?.instanceId;
    if (!lockedInstanceId) return null;
    return (
      providerInstanceEntries.find((entry) => entry.instanceId === lockedInstanceId)
        ?.continuationGroupKey ?? null
    );
  }, [
    activeThread,
    activeThreadModelSelection?.instanceId,
    lockedProvider,
    providerInstanceEntries,
  ]);

  // Resolve which configured instance the composer is currently targeting.
  // Priority:
  //   1. The composer draft's `activeProvider` — the user's unsaved pick
  //      from the model picker (must win, otherwise the UI appears to
  //      ignore picker selections).
  //   2. Thread's persisted instance id (server-side saved selection).
  //   3. Project default's instance id.
  //   4. First enabled entry matching the current driver kind.
  //   5. First enabled entry overall / default instance for the kind.
  //
  const selectedInstanceId = useMemo<ProviderInstanceId>(() => {
    const candidates: Array<string | null | undefined> = [
      composerDraft.activeProvider,
      activeThread?.session?.providerInstanceId,
      activeThreadModelSelection?.instanceId,
      activeProjectDefaultModelSelection?.instanceId,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const match = providerInstanceEntries.find(
        (entry) => entry.instanceId === candidate && entry.enabled && entry.isAvailable,
      );
      if (match) {
        // When locked to a specific driver kind, ignore persisted instance
        // ids from a different kind or continuation group.
        if (lockedProvider && match.driverKind !== lockedProvider) continue;
        if (
          lockedContinuationGroupKey &&
          match.continuationGroupKey !== lockedContinuationGroupKey
        ) {
          continue;
        }
        return match.instanceId;
      }
    }
    const compatibleEntries = providerInstanceEntries.filter(
      (entry) =>
        (!lockedProvider || entry.driverKind === lockedProvider) &&
        (!lockedContinuationGroupKey || entry.continuationGroupKey === lockedContinuationGroupKey),
    );
    const requestedDriverEntries = compatibleEntries.filter(
      (entry) => entry.driverKind === requestedDriverKind,
    );
    return (
      resolveSelectableProviderInstanceEntry(requestedDriverEntries, undefined)?.instanceId ??
      resolveSelectableProviderInstanceEntry(compatibleEntries, undefined)?.instanceId ??
      NO_PROVIDER_MODEL_SELECTION.instanceId
    );
  }, [
    activeProjectDefaultModelSelection?.instanceId,
    activeThread?.session?.providerInstanceId,
    activeThreadModelSelection?.instanceId,
    composerDraft.activeProvider,
    lockedContinuationGroupKey,
    lockedProvider,
    providerInstanceEntries,
    requestedDriverKind,
  ]);

  // Resolve the active instance's snapshot by `instanceId` so a custom
  // instance gets its own slash commands, skills, and model list — not
  // the first snapshot for the same driver kind.
  const selectedProviderEntry = useMemo(
    () => providerInstanceEntries.find((entry) => entry.instanceId === selectedInstanceId),
    [providerInstanceEntries, selectedInstanceId],
  );
  const noProviderAvailable = selectedProviderEntry === undefined;
  // Before the catalog arrives, every thread resolves to "no provider". Send
  // stays blocked either way; only the chrome waits, keeping the picker with
  // the thread's own selection instead of swapping in the setup button and
  // back once the catalog lands.
  const providerCatalogPending = noProviderAvailable && !providerCatalogKnown;
  const showProviderUnavailable = noProviderAvailable && !providerCatalogPending;
  const resolvedCompactDisabledReason =
    compactDisabledReason ?? (noProviderAvailable ? "Compacting is unavailable right now" : null);
  // The driver kind follows the instance that will actually run the turn,
  // which can differ from the persisted selection when that selection is
  // disabled.
  const selectedProvider: ProviderDriverKind =
    selectedProviderEntry?.driverKind ?? requestedDriverKind;

  const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
    threadRef: composerDraftTarget,
    providers: providerStatuses,
    selectedProvider,
    selectedInstanceId,
    threadModelSelection: activeThreadModelSelection,
    projectModelSelection: activeProjectDefaultModelSelection,
    settings,
  });
  const selectedProviderStatus = useMemo(
    () => selectedProviderEntry?.snapshot ?? null,
    [selectedProviderEntry],
  );
  const compactCommandAvailable = providerSupportsManualCompaction(selectedProviderEntry);
  const selectedProviderSkills = useMemo(
    () =>
      mergeProviderSkillCatalogs(
        selectedProviderStatus?.skills ?? [],
        discoveredSkillsCatalog.skills,
      ),
    [discoveredSkillsCatalog.skills, selectedProviderStatus?.skills],
  );
  const selectedProviderModels = useMemo<ReadonlyArray<ServerProvider["models"][number]>>(
    () => selectedProviderEntry?.models ?? [],
    [selectedProviderEntry],
  );

  const composerPromptInjectionState = useMemo(
    () => getComposerPromptInjectionState(prompt),
    [prompt],
  );
  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        promptInjectionState: composerPromptInjectionState,
        modelOptions: composerModelOptions?.[selectedInstanceId],
        planModeEnabled: settings.planModeEnabled,
      }),
    [
      composerModelOptions,
      composerPromptInjectionState,
      selectedInstanceId,
      selectedModel,
      selectedProvider,
      selectedProviderModels,
      settings.planModeEnabled,
    ],
  );

  const selectedPromptEffort = composerProviderState.promptEffort;
  const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
  // Plan mode is a legacy feature behind Settings → Beta. With the flag off,
  // ChatView forces the effective mode to "default", so hiding the toggle
  // can't trap anyone in plan mode.
  const planModeUiEnabled = settings.planModeEnabled;
  const composerProviderControls = useMemo(
    () => ({
      showInteractionModeToggle:
        planModeUiEnabled && getProviderInteractionModeToggle(providerStatuses, selectedProvider),
    }),
    [planModeUiEnabled, providerStatuses, selectedProvider],
  );
  const selectedModelSelection = useMemo<ModelSelection>(
    () => createModelSelection(selectedInstanceId, selectedModel, selectedModelOptionsForDispatch),
    [selectedInstanceId, selectedModel, selectedModelOptionsForDispatch],
  );
  const selectedModelForPicker = selectedModel;
  // Instance-keyed option list so the picker can show each configured
  // instance (built-in + custom) as a first-class sidebar entry. The
  // options are server-reported models plus that exact instance's
  // configured custom models. A missing OpenCode selection is included as
  // an unavailable row until the catalog reports it again.
  const modelOptionsByInstance = useMemo<
    ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>
  >(() => {
    const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
    for (const entry of providerInstanceEntries) {
      out.set(
        entry.instanceId,
        getAppModelOptionsForInstance(
          settings,
          entry,
          entry.instanceId === selectedInstanceId ? selectedModelForPicker : null,
        ),
      );
    }
    return out;
  }, [providerInstanceEntries, selectedInstanceId, selectedModelForPicker, settings]);
  const selectedModelForPickerWithCustomFallback = useMemo(() => {
    const currentOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
    return currentOptions.some((option) => option.slug === selectedModelForPicker)
      ? selectedModelForPicker
      : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
  }, [modelOptionsByInstance, selectedInstanceId, selectedModelForPicker, selectedProvider]);

  // ------------------------------------------------------------------
  // Context window
  // ------------------------------------------------------------------
  const activeThreadModelDisplayName = useMemo(
    () => resolveContextWindowModelDisplayName(activeThreadModelSelection, modelOptionsByInstance),
    [activeThreadModelSelection, modelOptionsByInstance],
  );
  const reserveContextWindowMeter = shouldReserveContextWindowMeter({
    meterEnabled: settings.contextWindowMeterEnabled,
    detailLoading: activeThread === undefined && props.activeThreadShell !== null,
    threadStarted: threadShellHasStarted(props.activeThreadShell),
    providerReportsContextWindow: selectedProviderStatus
      ? selectedProviderStatus.reportsContextWindow === true
      : null,
  });

  // ------------------------------------------------------------------
  // Composer-local state
  // ------------------------------------------------------------------
  const [composerCursor, setComposerCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length),
  );
  const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(() =>
    detectComposerTrigger(prompt, prompt.length),
  );
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null);
  const [composerHighlightedSearchKey, setComposerHighlightedSearchKey] = useState<string | null>(
    null,
  );
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [isComposerFooterCompact, setIsComposerFooterCompact] = useState(false);
  const [isComposerPrimaryActionsCompact, setIsComposerPrimaryActionsCompact] = useState(false);
  const [isComposerModelPickerOpen, setIsComposerModelPickerOpen] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [composerSubmissionError, setComposerSubmissionError] = useState<string | null>(null);
  const [providerInputSubmissionError, setProviderInputSubmissionError] = useState<string | null>(
    null,
  );
  const [composerMenuAnchor, setComposerMenuAnchor] = useState<HTMLDivElement | null>(null);
  const [isStashMenuOpen, setIsStashMenuOpen] = useState(false);
  const [stashPulse, setStashPulse] = useState<{ key: number; active: boolean }>({
    key: 0,
    active: false,
  });
  const isMobileViewport = useMediaQuery("max-sm");
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  const isComposerCollapsedMobile =
    isMobileViewport && !forceExpandedOnMobile && !isComposerFocused;

  // ------------------------------------------------------------------
  // Refs
  // ------------------------------------------------------------------
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const pasteAsTextShortcutUntilRef = useRef(0);
  const pastedTextFileNamesRef = useRef<{ targetKey: string; names: Set<string> }>({
    targetKey: "",
    names: new Set(),
  });
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const composerFooterControlsRef = useRef<HTMLDivElement>(null);
  const composerSurfaceRef = useRef<HTMLDivElement>(null);
  const providerInputRejectedRef = useRef(false);
  const composerSelectLockRef = useRef(false);
  const composerMenuOpenRef = useRef(false);
  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
  const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
  const composerBlurFrameRef = useRef<number | null>(null);
  const mobileComposerExpandFrameRef = useRef<number | null>(null);
  const mobileComposerExpandReleaseFrameRef = useRef<number | null>(null);
  const mobileComposerExpandInFlightRef = useRef(false);
  const stashPulseKeyRef = useRef(0);
  const stashPulseTimeoutRef = useRef<number | null>(null);
  /**
   * Snapshots currently being encoded, keyed by target+prompt+image ids.
   * Keyed rather than boolean so a genuinely different prompt (or a different
   * thread) can still be stashed while an earlier encode is running.
   */
  const stashInFlightRef = useRef<Set<string>>(new Set());
  /**
   * Count of pasted images still being compressed, per thread. Reserved
   * against the attachment limit so concurrent pastes can't overshoot it,
   * and checked before sending so an image cannot move into
   * the next draft.
   */
  const pendingImageCompressionsRef = useRef<Map<string, number>>(new Map());
  const isRevertingCheckpointRef = useRef(isRevertingCheckpoint);
  isRevertingCheckpointRef.current = isRevertingCheckpoint;

  useEffect(() => {
    const armPasteAsTextShortcut = () => {
      pasteAsTextShortcutUntilRef.current = Date.now() + 1_000;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Node &&
        composerFormRef.current?.contains(event.target) &&
        isPasteAsTextShortcut(event, isMacPlatform(navigator.platform))
      ) {
        armPasteAsTextShortcut();
      }
    };
    const onBlur = () => {
      pasteAsTextShortcutUntilRef.current = 0;
    };
    const onDesktopPasteAsText = () => {
      const activeElement = document.activeElement;
      const blocksPasteToFocus =
        activeElement instanceof Element &&
        activeElement.closest(
          'input, textarea, select, button, a[href], summary, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="button"], [role="menuitem"], [role="option"]',
        ) !== null;
      if (
        (activeElement instanceof Node && composerFormRef.current?.contains(activeElement)) ||
        !blocksPasteToFocus
      ) {
        armPasteAsTextShortcut();
      }
    };
    window.addEventListener(DESKTOP_PASTE_AS_TEXT_EVENT, onDesktopPasteAsText);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener(DESKTOP_PASTE_AS_TEXT_EVENT, onDesktopPasteAsText);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // ------------------------------------------------------------------
  // Derived: composer send state
  // ------------------------------------------------------------------
  const composerSendState = useMemo(
    () =>
      deriveComposerSendState({
        prompt,
        imageCount: composerImages.length + composerFiles.length,
        terminalContexts: composerTerminalContexts,
        elementContextCount: composerPreviewAnnotations.length + composerReviewComments.length,
      }),
    [
      composerFiles.length,
      composerImages.length,
      composerPreviewAnnotations.length,
      composerReviewComments.length,
      composerTerminalContexts,
      prompt,
    ],
  );
  // ------------------------------------------------------------------
  // Derived: composer trigger / menu
  // ------------------------------------------------------------------
  const composerTriggerKind = composerTrigger?.kind ?? null;
  const pathTriggerQuery = composerTrigger?.kind === "path" ? composerTrigger.query : "";
  const isPathTrigger = composerTriggerKind === "path";
  const workspaceEntries = useComposerPathSearch({
    environmentId,
    cwd: isPathTrigger ? gitCwd : null,
    query: isPathTrigger ? pathTriggerQuery : null,
  });
  const compactSlashCommandAvailable =
    composerTrigger?.kind === "slash-command" &&
    prompt.slice(0, composerTrigger.rangeStart).trim() === "" &&
    !compactThreadUnavailable &&
    prompt.slice(composerTrigger.rangeEnd).trim() === "" &&
    composerImages.length + composerFiles.length === 0 &&
    composerDraft.persistedAttachments.length === 0 &&
    composerTerminalContexts.length === 0 &&
    composerPreviewAnnotations.length === 0 &&
    composerReviewComments.length === 0;

  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path") {
      return workspaceEntries.entries.map((entry) => ({
        id: `path:${entry.kind}:${entry.path}`,
        type: "path",
        path: entry.path,
        pathKind: entry.kind,
        label: basenameOfPath(entry.path),
        description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
      }));
    }
    if (composerTrigger.kind === "slash-command") {
      const nativeCommandNames = (selectedProviderStatus?.slashCommands ?? []).map(
        (command) => command.name,
      );
      const availableBuiltInCommands = getAvailableComposerSlashCommands({
        planModeEnabled: planModeUiEnabled,
        nativeCommandNames,
        canOfferForkCommand: true,
        canOfferSideCommand: true,
      });
      const availableBuiltInCommandSet = new Set(availableBuiltInCommands);
      const builtInSlashCommandItems = availableBuiltInCommands.map((command) => {
        const definition = COMPOSER_SLASH_COMMAND_DEFINITIONS[command];
        return {
          id: `slash:${definition.command}`,
          type: "slash-command" as const,
          command: definition.command,
          label: definition.label,
          description: definition.description,
        };
      });
      const visibleSkills = selectedProviderSkills.filter(
        (skill) =>
          !(settings.skills?.disabled ?? []).some(
            (name) => name.trim().toLowerCase() === skill.name.trim().toLowerCase(),
          ),
      );
      // A skill and a native command of the same name are one thing to the
      // reader, and providers report their skills as slash commands too. The
      // Skills row wins the duplicate: it carries the install source, and
      // selecting it inserts the $name token the provider actually expects.
      const appOfferedCommandNames = new Set([
        ...availableBuiltInCommandSet,
        ...visibleSkills.map((skill) => normalizeComposerSlashCommandName(skill.name)),
      ]);
      // A provider expands a slash command only when it opens the whole
      // message; anywhere else it reaches the agent as literal text. Built-ins
      // apply locally on selection and skills insert a `$` mention the server
      // dispatches from any position, so only provider commands are gated.
      const providerSlashCommandItems = (
        composerTrigger.rangeStart === 0 ? (selectedProviderStatus?.slashCommands ?? []) : []
      )
        .filter(
          (command) => !shouldHideProviderNativeSlashCommand(command.name, appOfferedCommandNames),
        )
        .map((command) => ({
          id: `provider-slash-command:${selectedProvider}:${command.name}`,
          type: "provider-slash-command" as const,
          provider: selectedProvider,
          command,
          label: `/${command.name}`,
          description: command.description ?? command.input?.hint ?? "Run provider command",
        }));
      // A provider that cannot compact on demand should not offer the command.
      const visibleProviderSlashCommandItems = providerSlashCommandItems.filter(
        (item) => item.command.name !== "compact" || compactCommandAvailable,
      );
      const skillItems = searchProviderSkills(visibleSkills, composerTrigger.query).map(
        (skill) => ({
          id: `skill:${selectedProvider}:${skill.name}`,
          type: "skill" as const,
          provider: selectedProvider,
          skill,
          label: formatProviderSkillDisplayName(skill),
          description:
            skill.shortDescription ??
            skill.description ??
            (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
        }),
      );
      const query = composerTrigger.query.trim().toLowerCase();
      const slashCommandItems = [...builtInSlashCommandItems, ...visibleProviderSlashCommandItems];
      const rankedSlashItems = query
        ? searchSlashCommandItems(slashCommandItems, query)
        : slashCommandItems;
      return [...rankedSlashItems, ...skillItems];
    }
    if (composerTrigger.kind === "skill") {
      const visibleSkills = selectedProviderSkills.filter(
        (skill) =>
          !(settings.skills?.disabled ?? []).some(
            (name) => name.trim().toLowerCase() === skill.name.trim().toLowerCase(),
          ),
      );
      return searchProviderSkills(visibleSkills, composerTrigger.query).map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: formatProviderSkillDisplayName(skill),
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
      }));
    }
    return [];
  }, [
    compactSlashCommandAvailable,
    composerTrigger,
    planModeUiEnabled,
    selectedProvider,
    selectedProviderSkills,
    selectedProviderStatus,
    settings.skills,
    workspaceEntries.entries,
  ]);

  const composerMenuOpen = Boolean(composerTrigger);
  const composerMenuSearchKey = composerTrigger
    ? `${composerTrigger.kind}:${composerTrigger.query.trim().toLowerCase()}`
    : null;
  const activeComposerMenuItem = useMemo(() => {
    const activeItemId = resolveComposerMenuActiveItemId({
      items: composerMenuItems,
      highlightedItemId: composerHighlightedItemId,
      currentSearchKey: composerMenuSearchKey,
      highlightedSearchKey: composerHighlightedSearchKey,
    });
    return composerMenuItems.find((item) => item.id === activeItemId) ?? null;
  }, [
    composerHighlightedItemId,
    composerHighlightedSearchKey,
    composerMenuItems,
    composerMenuSearchKey,
  ]);

  composerMenuOpenRef.current = composerMenuOpen;
  composerMenuItemsRef.current = composerMenuItems;
  activeComposerMenuItemRef.current = activeComposerMenuItem;

  const nonPersistedComposerImageIdSet = useMemo(
    () => new Set(nonPersistedComposerImageIds),
    [nonPersistedComposerImageIds],
  );

  const isComposerApprovalState = activePendingApproval !== null;
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const hasComposerHeader =
    isComposerApprovalState ||
    pendingUserInputs.length > 0 ||
    (showPlanFollowUpPrompt && activeProposedPlan !== null);
  const showCollapsedMobilePromptRow =
    isComposerCollapsedMobile && !isComposerApprovalState && pendingUserInputs.length === 0;
  const showComposerAttachAction =
    fileStagingLimit !== null &&
    (!activePendingProgress ||
      (supportsQuestionAttachments &&
        activePendingProgress.activeQuestion?.allowCustomAnswer !== false));

  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
  const composerFooterActionLayoutKey = useMemo(() => {
    if (activePendingProgress) {
      return `pending:${activePendingProgress.questionIndex}:${activePendingProgress.isLastQuestion}:${activePendingIsResponding}`;
    }
    if (phase === "running") {
      return "running";
    }
    if (showPlanFollowUpPrompt) {
      return prompt.trim().length > 0 ? "plan:refine" : "plan:implement";
    }
    return `idle:${composerSendState.hasSendableContent}:${isSendBusy}:${isConnecting}:${isPreparingWorktree}`;
  }, [
    activePendingIsResponding,
    activePendingProgress,
    composerSendState.hasSendableContent,
    isConnecting,
    isPreparingWorktree,
    isSendBusy,
    phase,
    prompt,
    showPlanFollowUpPrompt,
  ]);

  const isComposerMenuLoading =
    composerTriggerKind === "path" && pathTriggerQuery.length > 0 && workspaceEntries.isPending;
  const composerMenuEmptyState = useMemo(() => {
    if (composerTriggerKind === "skill") {
      return "No skills found. Try / to browse provider commands.";
    }
    return composerTriggerKind === "path"
      ? "No matching files or folders."
      : "No matching command.";
  }, [composerTriggerKind]);

  // ------------------------------------------------------------------
  // Provider traits UI
  // ------------------------------------------------------------------
  const setPromptFromTraits = useCallback(
    (nextPrompt: string) => {
      if (nextPrompt === promptRef.current) {
        scheduleComposerFocus();
        return false;
      }
      promptRef.current = nextPrompt;
      setComposerDraftPrompt(composerDraftTarget, nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(nextPrompt, nextPrompt.length));
      scheduleComposerFocus();
    },
    [composerDraftTarget, promptRef, scheduleComposerFocus, setComposerDraftPrompt],
  );

  const providerTraitsMenuContent = renderProviderTraitsMenuContent({
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    prompt,
    onPromptChange: setPromptFromTraits,
    planModeEnabled: settings.planModeEnabled,
  });
  const providerTraitsPicker = renderProviderTraitsPicker({
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
    ...(routeKind === "draft" && draftId ? { draftId } : {}),
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    prompt,
    onPromptChange: setPromptFromTraits,
    planModeEnabled: settings.planModeEnabled,
  });
  const pendingPrimaryAction = useMemo(
    () =>
      activePendingProgress
        ? {
            questionIndex: activePendingProgress.questionIndex,
            isLastQuestion: activePendingProgress.isLastQuestion,
            canAdvance:
              activePendingProgress.canAdvance &&
              !attachmentBlockReason &&
              !(questionPreparations[attachmentTargetKey] ?? 0),
            isResponding: activePendingIsResponding,
            isComplete: Boolean(activePendingResolvedAnswers),
          }
        : null,
    [
      activePendingIsResponding,
      activePendingProgress,
      activePendingResolvedAnswers,
      attachmentBlockReason,
      attachmentTargetKey,
      questionPreparations,
    ],
  );
  const collapsedComposerPrimaryActionDisabled =
    phase === "running" ||
    isSendBusy ||
    isSendDisabled ||
    isConnecting ||
    noProviderAvailable ||
    projectSelectionRequired ||
    environmentUnavailable !== null ||
    !composerSendState.hasSendableContent;
  const collapsedComposerPrimaryActionLabel = "Send message";
  const showMobilePendingAnswerActions =
    isMobileViewport && !isComposerCollapsedMobile && pendingPrimaryAction !== null;

  // ------------------------------------------------------------------
  // Prompt helpers
  // ------------------------------------------------------------------
  const setPrompt = useCallback(
    (nextPrompt: string) => {
      setComposerDraftPrompt(composerDraftTarget, nextPrompt);
    },
    [composerDraftTarget, setComposerDraftPrompt],
  );

  const addComposerImage = useCallback(
    (image: ComposerImageAttachment) => {
      addComposerDraftImages(attachmentDraftTarget, [image]);
    },
    [addComposerDraftImages, attachmentDraftTarget],
  );

  const addComposerImagesToDraft = useCallback(
    (images: ComposerImageAttachment[]) => {
      addComposerDraftImages(attachmentDraftTarget, images);
    },
    [addComposerDraftImages, attachmentDraftTarget],
  );

  const removeComposerImageFromDraft = useCallback(
    (imageId: string) => {
      if (questionAttachmentTarget && activePendingIsResponding) return;
      releaseAttachmentUpload(imageId);
      removeComposerDraftImage(attachmentDraftTarget, imageId);
    },
    [
      activePendingIsResponding,
      attachmentDraftTarget,
      questionAttachmentTarget,
      removeComposerDraftImage,
    ],
  );

  const removeComposerFileFromDraft = useCallback(
    (fileId: string) => {
      if (questionAttachmentTarget && activePendingIsResponding) return;
      // Release by the draft attachment, not the bare queue key: a hydrated
      // file's upload lives server-side under its persisted attachment id.
      const file = composerFilesRef.current.find((candidate) => candidate.id === fileId);
      if (file) {
        releaseDraftAttachment(file);
      } else {
        releaseAttachmentUpload(fileId);
      }
      removeComposerDraftFile(attachmentDraftTarget, fileId);
    },
    [
      activePendingIsResponding,
      attachmentDraftTarget,
      questionAttachmentTarget,
      composerFilesRef,
      removeComposerDraftFile,
    ],
  );

  // ------------------------------------------------------------------
  // Sync refs back to parent
  // ------------------------------------------------------------------
  useEffect(() => {
    promptRef.current = prompt;
    setComposerCursor((existing) => clampCollapsedComposerCursor(prompt, existing));
  }, [prompt, promptRef]);

  useEffect(() => {
    if (composerSubmissionError === null) return;
    const nextError = getComposerPromptLengthValidationMessage(prompt);
    if (nextError !== composerSubmissionError) {
      setComposerSubmissionError(nextError);
    }
  }, [composerSubmissionError, prompt]);

  useEffect(() => {
    setProviderInputSubmissionError(null);
  }, [
    composerPreviewAnnotations,
    composerReviewComments,
    composerTerminalContexts,
    prompt,
    selectedModel,
    selectedPromptEffort,
    selectedProvider,
  ]);

  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages, composerImagesRef]);

  useEffect(() => {
    composerFilesRef.current = composerFiles;
  }, [composerFiles, composerFilesRef]);

  useEffect(() => {
    composerTerminalContextsRef.current = composerTerminalContexts;
  }, [composerTerminalContexts, composerTerminalContextsRef]);

  // ------------------------------------------------------------------
  // Composer menu highlight sync
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!composerMenuOpen) {
      setComposerHighlightedItemId(null);
      setComposerHighlightedSearchKey(null);
      return;
    }
    const nextActiveItemId = resolveComposerMenuActiveItemId({
      items: composerMenuItems,
      highlightedItemId: composerHighlightedItemId,
      currentSearchKey: composerMenuSearchKey,
      highlightedSearchKey: composerHighlightedSearchKey,
    });
    setComposerHighlightedItemId((existing) =>
      existing === nextActiveItemId ? existing : nextActiveItemId,
    );
    setComposerHighlightedSearchKey((existing) =>
      existing === composerMenuSearchKey ? existing : composerMenuSearchKey,
    );
  }, [
    composerHighlightedItemId,
    composerHighlightedSearchKey,
    composerMenuItems,
    composerMenuOpen,
    composerMenuSearchKey,
  ]);

  const lastSyncedPendingInputRef = useRef<{
    requestId: string | null;
    questionId: string | null;
  } | null>(null);

  useEffect(() => {
    const nextCustomAnswer = activePendingProgress?.customAnswer;
    if (typeof nextCustomAnswer !== "string") {
      lastSyncedPendingInputRef.current = null;
      return;
    }

    const nextRequestId = activePendingUserInput?.requestId ?? null;
    const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const questionChanged =
      lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
      lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
    const textChangedExternally = promptRef.current !== nextCustomAnswer;

    lastSyncedPendingInputRef.current = {
      requestId: nextRequestId,
      questionId: nextQuestionId,
    };

    if (!questionChanged && !textChangedExternally) {
      return;
    }

    promptRef.current = nextCustomAnswer;
    const nextCursor = collapseExpandedComposerCursor(nextCustomAnswer, nextCustomAnswer.length);
    setComposerCursor(nextCursor);
    setComposerTrigger(
      detectComposerTrigger(
        nextCustomAnswer,
        expandCollapsedComposerCursor(nextCustomAnswer, nextCursor),
      ),
    );
    setComposerHighlightedItemId(null);
  }, [
    activePendingProgress?.customAnswer,
    activePendingProgress?.activeQuestion?.id,
    activePendingUserInput?.requestId,
    promptRef,
  ]);

  // ------------------------------------------------------------------
  // Reset compositor state on thread/draft change
  // ------------------------------------------------------------------
  useEffect(() => {
    setComposerHighlightedItemId(null);
    setComposerSubmissionError(null);
    setProviderInputSubmissionError(null);
    setComposerCursor(collapseExpandedComposerCursor(promptRef.current, promptRef.current.length));
    setComposerTrigger(detectComposerTrigger(promptRef.current, promptRef.current.length));
    setIsDragOverComposer(false);
  }, [draftId, activeThreadId, promptRef]);

  // ------------------------------------------------------------------
  // Footer compact layout observation
  // ------------------------------------------------------------------
  useLayoutEffect(() => {
    const composerForm = composerFormRef.current;
    if (!composerForm) return;
    const measureComposerFormWidth = () => composerForm.clientWidth;
    const measureFooterCompactness = () => {
      const composerFormWidth = measureComposerFormWidth();
      const footerCompact = shouldUseCompactComposerFooter(composerFormWidth, {
        hasWideActions: composerFooterHasWideActions,
      });
      const primaryActionsCompact =
        footerCompact &&
        shouldUseCompactComposerPrimaryActions(composerFormWidth, {
          hasWideActions: composerFooterHasWideActions,
        });
      return {
        primaryActionsCompact,
        footerCompact,
      };
    };

    const initialCompactness = measureFooterCompactness();
    setIsComposerPrimaryActionsCompact(initialCompactness.primaryActionsCompact);
    setIsComposerFooterCompact(initialCompactness.footerCompact);
    if (typeof ResizeObserver === "undefined") return;
    const footerControls = composerFooterControlsRef.current;
    const stopFooterControlsFade = footerControls
      ? observeResponsiveBreakpointFade({
          target: footerControls,
          container: composerForm,
          active: panelAnimationsActive,
          durationMs: panelAnimationDurationMs,
          breakpoint: {
            value: composerFooterHasWideActions
              ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
              : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
            unit: "px",
          },
        })
      : undefined;

    const observer = new ResizeObserver(() => {
      const nextCompactness = measureFooterCompactness();
      setIsComposerPrimaryActionsCompact((previous) =>
        previous === nextCompactness.primaryActionsCompact
          ? previous
          : nextCompactness.primaryActionsCompact,
      );
      setIsComposerFooterCompact((previous) =>
        previous === nextCompactness.footerCompact ? previous : nextCompactness.footerCompact,
      );
    });

    observer.observe(composerForm);
    return () => {
      observer.disconnect();
      stopFooterControlsFade?.();
    };
  }, [
    activeThreadId,
    composerFooterActionLayoutKey,
    composerFooterHasWideActions,
    isComposerApprovalState,
    isComposerCollapsedMobile,
    panelAnimationDurationMs,
    panelAnimationsActive,
  ]);

  // ------------------------------------------------------------------
  // Image persist effect
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (composerImages.length === 0) {
        clearComposerDraftPersistedAttachments(attachmentDraftTarget);
        return;
      }
      const getPersistedAttachmentsForThread = () =>
        getComposerDraft(attachmentDraftTarget)?.persistedAttachments ?? [];
      try {
        const currentPersistedAttachments = getPersistedAttachmentsForThread();
        const existingPersistedById = new Map(
          currentPersistedAttachments.map((attachment) => [attachment.id, attachment]),
        );
        const stagedAttachmentById = new Map<string, PersistedComposerImageAttachment>();
        await Promise.all(
          composerImages.map(async (image) => {
            try {
              const dataUrl = await readFileAsDataUrl(image.file);
              stagedAttachmentById.set(image.id, {
                id: image.id,
                name: image.name,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes,
                dataUrl,
                ...(image.source ? { source: image.source } : {}),
              });
            } catch {
              const existingPersisted = existingPersistedById.get(image.id);
              if (existingPersisted) {
                stagedAttachmentById.set(image.id, existingPersisted);
              }
            }
          }),
        );
        const serialized = Array.from(stagedAttachmentById.values());
        if (cancelled) return;
        syncComposerDraftPersistedAttachments(attachmentDraftTarget, serialized);
      } catch {
        const currentImageIds = new Set(composerImages.map((image) => image.id));
        const fallbackPersistedAttachments = getPersistedAttachmentsForThread();
        const fallbackPersistedIds: Array<string> = [];
        for (const attachment of fallbackPersistedAttachments) {
          if (currentImageIds.has(attachment.id)) {
            fallbackPersistedIds.push(attachment.id);
          }
        }
        const fallbackPersistedIdSet = new Set(fallbackPersistedIds);
        const fallbackAttachments = fallbackPersistedAttachments.filter((attachment) =>
          fallbackPersistedIdSet.has(attachment.id),
        );
        if (cancelled) return;
        syncComposerDraftPersistedAttachments(attachmentDraftTarget, fallbackAttachments);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    attachmentDraftTarget,
    clearComposerDraftPersistedAttachments,
    composerImages,
    getComposerDraft,
    syncComposerDraftPersistedAttachments,
  ]);

  // ------------------------------------------------------------------
  // Callbacks: prompt change
  // ------------------------------------------------------------------
  const onPromptChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
      contextIds: string[],
    ) => {
      if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
        setComposerCursor(nextCursor);
        setComposerTrigger(
          cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
        );
        onChangeActivePendingUserInputCustomAnswer(
          activePendingProgress.activeQuestion.id,
          nextPrompt,
          nextCursor,
          expandedCursor,
          cursorAdjacentToMention,
        );
        return;
      }
      const previouslyReferenced = new Set(collectInlineContextIds(promptRef.current));
      const referenced = new Set(contextIds);
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      const nextTerminalContexts = composerTerminalContexts.filter((context) => {
        const contextId = terminalContextReference(context).contextId;
        return !previouslyReferenced.has(contextId) || referenced.has(contextId);
      });
      if (nextTerminalContexts.length !== composerTerminalContexts.length) {
        setComposerDraftTerminalContexts(composerDraftTarget, nextTerminalContexts);
      }
      for (const comment of composerReviewComments) {
        const contextId = reviewCommentContextId(comment.id);
        if (previouslyReferenced.has(contextId) && !referenced.has(contextId)) {
          removeComposerDraftReviewComment(composerDraftTarget, comment.id);
        }
      }
      for (const annotation of composerPreviewAnnotations) {
        const contextId = previewAnnotationContextId(annotation.id);
        if (previouslyReferenced.has(contextId) && !referenced.has(contextId)) {
          releaseAttachmentUpload(annotation.id);
          removeComposerDraftPreviewAnnotation(composerDraftTarget, annotation.id);
        }
      }
      for (const file of composerFiles) {
        const contextId = fileContextReference(file).contextId;
        if (previouslyReferenced.has(contextId) && !referenced.has(contextId)) {
          removeComposerFileFromDraft(file.id);
        }
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectComposerTrigger(nextPrompt, expandedCursor),
      );
    },
    [
      activePendingProgress?.activeQuestion,
      pendingUserInputs.length,
      onChangeActivePendingUserInputCustomAnswer,
      promptRef,
      setPrompt,
      composerDraftTarget,
      composerTerminalContexts,
      composerReviewComments,
      composerPreviewAnnotations,
      composerFiles,
      setComposerDraftTerminalContexts,
      removeComposerDraftReviewComment,
      removeComposerDraftPreviewAnnotation,
      removeComposerFileFromDraft,
    ],
  );

  // ------------------------------------------------------------------
  // Callbacks: prompt replacement / menu
  // ------------------------------------------------------------------
  const applyPromptReplacement = useCallback(
    (
      rangeStart: number,
      rangeEnd: number,
      replacement: string,
      options?: {
        expectedText?: string;
        focusEditorAfterReplace?: boolean;
        citationComment?: { start: number; sourceAnchor: AssistantCitationSourceAnchor };
      },
    ): boolean => {
      const currentText = promptRef.current;
      const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
      const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
      if (
        options?.expectedText !== undefined &&
        currentText.slice(safeStart, safeEnd) !== options.expectedText
      ) {
        return false;
      }
      const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
      const nextExpandedCursor = expandCollapsedComposerCursor(next.text, nextCursor);
      if (options?.citationComment) {
        composerEditorRef.current?.requestCitationComment({
          previousValue: currentText,
          value: next.text,
          citationStart: options.citationComment.start,
          sourceAnchor: options.citationComment.sourceAnchor,
        });
      }
      promptRef.current = next.text;
      const activePendingQuestion = activePendingProgress?.activeQuestion;
      if (activePendingQuestion && activePendingUserInput) {
        onChangeActivePendingUserInputCustomAnswer(
          activePendingQuestion.id,
          next.text,
          nextCursor,
          nextExpandedCursor,
          false,
        );
      } else {
        setPrompt(next.text);
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(detectComposerTrigger(next.text, nextExpandedCursor));
      if (options?.focusEditorAfterReplace !== false) {
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAt(nextCursor);
        });
      }
      return true;
    },
    [
      activePendingProgress?.activeQuestion,
      activePendingUserInput,
      onChangeActivePendingUserInputCustomAnswer,
      promptRef,
      setPrompt,
    ],
  );

  const readComposerSnapshot = useCallback((): {
    value: string;
    cursor: number;
    expandedCursor: number;
    contextIds: string[];
  } => {
    const editorSnapshot = composerEditorRef.current?.readSnapshot();
    if (editorSnapshot) {
      return editorSnapshot;
    }
    return {
      value: promptRef.current,
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      contextIds: collectInlineContextIds(promptRef.current),
    };
  }, [composerCursor, promptRef]);

  const resolveActiveComposerTrigger = useCallback((): {
    snapshot: { value: string; cursor: number; expandedCursor: number };
    trigger: ComposerTrigger | null;
  } => {
    const snapshot = readComposerSnapshot();
    return {
      snapshot,
      trigger: detectComposerTrigger(snapshot.value, snapshot.expandedCursor),
    };
  }, [readComposerSnapshot]);

  const onSelectComposerItem = useCallback(
    (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) return;
      composerSelectLockRef.current = true;
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false;
      });
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      if (item.type === "path") {
        const replacement = `${serializeComposerFileLink(item.path)} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "slash-command") {
        if (item.command === "model") {
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
            focusEditorAfterReplace: false,
          });
          if (applied) {
            setComposerHighlightedItemId(null);
            setIsComposerModelPickerOpen(true);
          }
          return;
        }
        if (item.command === "plan" || item.command === "debug" || item.command === "default") {
          void handleInteractionModeChange(item.command);
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          });
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          return;
        }
        if (item.command === "compact") {
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
          });
          if (applied) {
            setComposerHighlightedItemId(null);
          }
          onAppSlashCommand?.("compact");
          return;
        }
        const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        });
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        onAppSlashCommand?.(item.command);
        return;
      }
      if (item.type === "provider-slash-command") {
        const replacement = `/${item.command.name} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "skill") {
        const replacement = `$${item.skill.name} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
    },
    [
      applyPromptReplacement,
      handleInteractionModeChange,
      onAppSlashCommand,
      resolveActiveComposerTrigger,
    ],
  );

  const onComposerMenuItemHighlighted = useCallback(
    (itemId: string | null) => {
      setComposerHighlightedItemId(itemId);
      setComposerHighlightedSearchKey(composerMenuSearchKey);
    },
    [composerMenuSearchKey],
  );

  const nudgeComposerMenuHighlight = useCallback(
    (key: "ArrowDown" | "ArrowUp") => {
      if (composerMenuItems.length === 0) return;
      const highlightedIndex = composerMenuItems.findIndex(
        (item) => item.id === composerHighlightedItemId,
      );
      const normalizedIndex =
        highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
      const offset = key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
      const nextItem = composerMenuItems[nextIndex];
      setComposerHighlightedItemId(nextItem?.id ?? null);
    },
    [composerHighlightedItemId, composerMenuItems],
  );

  const blurMobileComposerAfterSend = useCallback(() => {
    if (!isMobileViewport) return;
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
      composerBlurFrameRef.current = null;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
    setIsComposerFocused(false);
  }, [isMobileViewport]);

  const shouldBlurMobileComposerOnSubmit = useCallback(() => {
    if (!isMobileViewport) return false;
    if (
      isSendBusy ||
      isSendDisabled ||
      isConnecting ||
      noProviderAvailable ||
      environmentUnavailable !== null ||
      phase === "running"
    ) {
      return false;
    }
    if (activePendingProgress) {
      return activePendingProgress.isLastQuestion && Boolean(activePendingResolvedAnswers);
    }
    return showPlanFollowUpPrompt || composerSendState.hasSendableContent;
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    composerSendState.hasSendableContent,
    environmentUnavailable,
    isConnecting,
    isMobileViewport,
    isSendBusy,
    isSendDisabled,
    noProviderAvailable,
    phase,
    showPlanFollowUpPrompt,
  ]);

  const submitComposer = useCallback(
    (event?: { preventDefault: () => void }, intent: ComposerSubmissionIntent = "foreground") => {
      if (noProviderAvailable || isSendDisabled) {
        event?.preventDefault();
        return;
      }
      // A send while a pasted image is still compressing would strand that
      // image: the turn snapshot wouldn't include it, and it would surface
      // in the *next* draft instead. Only oversized images hit this — small
      // files clear the pending counter within a microtask.
      if (
        activeThreadId &&
        (pendingImageCompressionsRef.current.get(attachmentTargetKey) ?? 0) > 0
      ) {
        event?.preventDefault();
        toastManager.add({
          type: "info",
          title: "Still compressing a pasted image.",
          description: "Send again once its thumbnail appears.",
        });
        return;
      }
      const submission = submitComposerDraft({
        prompt: promptRef.current,
        submissionTarget: activePendingProgress ? "pending-user-input" : "provider-turn",
        event,
        onSend: (sendEvent) => {
          // ChatView reports its final composed-input preflight through the
          // composer handle before its first asynchronous send step.
          providerInputRejectedRef.current = false;
          onSend(sendEvent, intent);
          return !providerInputRejectedRef.current;
        },
      });
      setComposerSubmissionError(submission.validationMessage);
      if (!submission.didDispatch) return;
      if (shouldBlurMobileComposerOnSubmit()) {
        blurMobileComposerAfterSend();
      }
    },
    [
      activeThreadId,
      activePendingProgress,
      attachmentTargetKey,
      blurMobileComposerAfterSend,
      isSendDisabled,
      noProviderAvailable,
      onSend,
      promptRef,
      shouldBlurMobileComposerOnSubmit,
    ],
  );
  const compactThreadContext = useCallback(() => {
    if (
      compactDisabled ||
      noProviderAvailable ||
      activePendingApproval !== null ||
      pendingUserInputs.length > 0 ||
      phase === "running" ||
      isSendBusy ||
      isConnecting ||
      !activeThreadId
    ) {
      return;
    }
    onCompactContext();
  }, [
    activePendingApproval,
    activeThreadId,
    attachmentTargetKey,
    compactDisabled,
    isConnecting,
    isSendBusy,
    noProviderAvailable,
    onCompactContext,
    pendingUserInputs.length,
    phase,
  ]);
  const expandMobileComposer = useCallback(() => {
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
      composerBlurFrameRef.current = null;
    }
    if (mobileComposerExpandFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
    }
    if (mobileComposerExpandReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
    }
    mobileComposerExpandInFlightRef.current = true;
    setIsComposerFocused(true);
    mobileComposerExpandFrameRef.current = window.requestAnimationFrame(() => {
      mobileComposerExpandFrameRef.current = null;
      composerEditorRef.current?.focusAtEnd();
      mobileComposerExpandReleaseFrameRef.current = window.requestAnimationFrame(() => {
        mobileComposerExpandReleaseFrameRef.current = null;
        mobileComposerExpandInFlightRef.current = false;
      });
    });
  }, []);

  // ------------------------------------------------------------------
  // Callbacks: command key
  // ------------------------------------------------------------------
  const onComposerCommandKey = (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => {
    if (key === "Tab" && event.shiftKey) {
      if (!planModeUiEnabled) return false;
      toggleInteractionMode();
      return true;
    }
    const { trigger } = resolveActiveComposerTrigger();
    const menuIsActive = composerMenuOpenRef.current || trigger !== null;
    if (menuIsActive) {
      const currentItems = composerMenuItemsRef.current;
      const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
      if (key === "ArrowDown" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowDown");
        return true;
      }
      if (key === "ArrowUp" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowUp");
        return true;
      }
      if ((key === "Enter" || key === "Tab") && selectedItem) {
        onSelectComposerItem(selectedItem);
        return true;
      }
    }
    const submissionIntent =
      key === "Enter"
        ? composerSubmissionIntentForEnter({
            isMobileViewport,
            shiftKey: event.shiftKey,
            modifierKey: event.metaKey || event.ctrlKey,
            isDraftThread: routeKind === "draft",
          })
        : null;
    if (submissionIntent) {
      submitComposer(undefined, submissionIntent);
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------------
  // Prompt stash (⌘S)
  // ------------------------------------------------------------------
  // Files remain tied to the environment that owns their uploaded bytes.
  const stashQueue = usePromptStashStore((state) => state.entries);
  const stashEntryToQueue = usePromptStashStore((state) => state.stashEntry);
  const takeStashEntry = usePromptStashStore((state) => state.takeEntry);
  const finalizeStashEntryImages = usePromptStashStore((state) => state.finalizeEntryImages);

  useEffect(() => {
    return () => {
      if (stashPulseTimeoutRef.current !== null) {
        window.clearTimeout(stashPulseTimeoutRef.current);
      }
    };
  }, []);

  /** Briefly highlight the badge so the save registers without a flourish. */
  const pulseStashBadge = useCallback(() => {
    stashPulseKeyRef.current += 1;
    setStashPulse({ key: stashPulseKeyRef.current, active: true });
    if (stashPulseTimeoutRef.current !== null) {
      window.clearTimeout(stashPulseTimeoutRef.current);
    }
    stashPulseTimeoutRef.current = window.setTimeout(() => {
      stashPulseTimeoutRef.current = null;
      setStashPulse((current) => ({ ...current, active: false }));
    }, 1200);
  }, []);

  const restoreStashEntry = useCallback(
    async (menuEntry: PromptStashEntry) => {
      const filesToVerify = menuEntry.files ?? [];
      if (filesToVerify.some((file) => file.environmentId !== environmentId)) {
        toastManager.add({
          type: "error",
          title: "Stashed files belong to another environment",
          description: "Restore this prompt in the environment that received its files.",
        });
        return;
      }
      setIsStashMenuOpen(false);

      // The server sweeps pending uploads after 24 hours, so ask before
      // reattaching. An expired upload restores as a needs-reattach row
      // instead of a reference the next send would fail to verify. Verify
      // BEFORE taking: the take removes the entry from durable storage, and a
      // tab closed during this await must still find it there after reload.
      const verifications = await Promise.all(
        filesToVerify.map((file) =>
          verifyStashedAttachmentUpload({ environmentId, attachmentId: file.attachmentId }),
        ),
      );
      const expiredAttachmentIds = new Set(
        filesToVerify
          .filter((_, index) => verifications[index]?.status === "missing")
          .map((file) => file.attachmentId),
      );

      // A thread switch during the verify await would mix the new thread's
      // prompt with this invocation's captured target. Nothing was taken yet,
      // so abort and leave the entry restorable where the user now is.
      if (
        isRevertingCheckpointRef.current ||
        composerTargetKey(composerDraftTarget) !== composerDraftTargetKeyRef.current
      ) {
        return;
      }

      // The take is also the double-activation guard (click + Enter): the
      // second caller finds the entry gone and stops here.
      const { entry, durable } = takeStashEntry(menuEntry.id);
      if (!entry) return;
      if (!durable) {
        toastManager.add({
          type: "warning",
          title: "Restored prompt may reappear in the stash",
          description:
            "Browser storage rejected the update, so this entry could still be there after a reload.",
          data: { hideCopyButton: true },
        });
      }

      const currentPrompt = promptRef.current;
      // An image-only stash must not append blank lines to whatever is
      // already in the composer.
      const nextPrompt =
        entry.prompt.length === 0
          ? currentPrompt
          : currentPrompt.trim().length
            ? `${currentPrompt.replace(/\s+$/, "")}\n\n${entry.prompt}`
            : entry.prompt;
      const promptChanged = nextPrompt !== currentPrompt;
      if (promptChanged) {
        promptRef.current = nextPrompt;
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
        setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
        setComposerTrigger(null);
      }

      let unrestoredFileNames: string[] = [];
      const expiredFileNames: string[] = [];
      let restoredFileCount = 0;
      const stashedFiles = entry.files ?? [];
      if (stashedFiles.length > 0) {
        const composerFilesNow = composerFilesRef.current;
        const existingFileIds = new Set(composerFilesNow.map((file) => file.id));
        const retainedUploadIds = new Set(
          composerFilesNow.flatMap((file) =>
            file.uploadedAttachmentId ? [file.uploadedAttachmentId] : [],
          ),
        );
        const existingFileKeys = new Set(composerFilesNow.map(composerFileDedupKey));
        const reattachMarkers = composerFilesNow.filter(composerFileNeedsReattach);
        const restoredMarkerIds = new Set<string>();
        const duplicateFiles: PersistedComposerFileAttachment[] = [];
        const markerReplacements: ComposerFileAttachment[] = [];
        const appendedFiles: ComposerFileAttachment[] = [];
        for (const file of stashedFiles) {
          const expired = expiredAttachmentIds.has(file.attachmentId);
          const key = composerFileDedupKey(file);
          const restored: ComposerFileAttachment = {
            type: "file",
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            file: null,
            ...(file.source ? { source: file.source } : {}),
            // An expired upload carries no ids, so it hydrates as a
            // needs-reattach row and the "Attach again" flow takes over.
            ...(expired
              ? {}
              : { uploadedAttachmentId: file.attachmentId, uploadEnvironmentId: environmentId }),
          };
          if (existingFileIds.has(file.id)) {
            if (!expired && !retainedUploadIds.has(file.attachmentId)) {
              duplicateFiles.push(file);
            }
            continue;
          }
          const reattachMarker = reattachMarkers.find(
            (marker) =>
              !restoredMarkerIds.has(marker.id) && composerFileMatchesReattachMarker(marker, file),
          );
          if (reattachMarker) {
            restoredMarkerIds.add(reattachMarker.id);
            existingFileIds.add(file.id);
            existingFileKeys.add(key);
            if (expired) {
              expiredFileNames.push(file.name);
            } else {
              retainedUploadIds.add(file.attachmentId);
              markerReplacements.push(restored);
            }
            continue;
          }
          if (existingFileKeys.has(key)) {
            if (!expired && !retainedUploadIds.has(file.attachmentId)) {
              duplicateFiles.push(file);
            }
            continue;
          }
          existingFileIds.add(file.id);
          existingFileKeys.add(key);
          if (expired) {
            expiredFileNames.push(file.name);
          } else {
            retainedUploadIds.add(file.attachmentId);
          }
          appendedFiles.push(restored);
        }
        const capacity = Math.max(
          0,
          PROVIDER_SEND_TURN_MAX_ATTACHMENTS -
            composerImagesRef.current.length -
            composerFilesNow.length,
        );
        // Marker replacements reuse their marker's slot; only appended files
        // consume capacity.
        const filesToAppend = appendedFiles.slice(0, capacity);
        const skippedFiles = appendedFiles.slice(capacity);
        unrestoredFileNames = skippedFiles.map((file) => file.name);
        // A non-durable take can resurrect the stash entry after a reload;
        // deleting these uploads would leave it pointing at nothing.
        if (durable) {
          for (const file of duplicateFiles) {
            releasePersistedAttachmentUpload({
              id: file.id,
              environmentId,
              attachmentId: file.attachmentId,
            });
          }
          for (const file of skippedFiles) {
            if (file.uploadedAttachmentId) {
              releasePersistedAttachmentUpload({
                id: file.id,
                environmentId,
                attachmentId: file.uploadedAttachmentId,
              });
            }
          }
        }
        const restoredFiles = [...markerReplacements, ...filesToAppend];
        if (restoredFiles.length > 0) {
          addComposerDraftFiles(composerDraftTarget, restoredFiles);
          restoredFileCount = filesToAppend.length;
        }
      }

      let unrestoredImageNames: string[] = [];
      if (entry.attachments.length > 0) {
        const existingIds = new Set(composerImagesRef.current.map((image) => image.id));
        // The draft store also dedupes by mimeType+sizeBytes+name, so filter
        // on the same key here. Counting a duplicate against capacity would
        // burn a slot the store then refuses to fill, pushing a genuinely
        // unique image into the overflow list for nothing.
        const existingDedupKeys = new Set(
          composerImagesRef.current.map(
            (image) => `${image.mimeType} ${image.sizeBytes} ${image.name}`,
          ),
        );
        const capacity = Math.max(
          0,
          PROVIDER_SEND_TURN_MAX_ATTACHMENTS -
            composerImagesRef.current.length -
            composerFilesRef.current.length -
            restoredFileCount,
        );
        const pending = entry.attachments.filter(
          (attachment) =>
            !existingIds.has(attachment.id) &&
            !existingDedupKeys.has(
              `${attachment.mimeType} ${attachment.sizeBytes} ${attachment.name}`,
            ),
        );
        // Anything past the attachment limit cannot be restored. The entry is
        // already out of the queue, so report the overflow by name instead of
        // discarding it silently.
        unrestoredImageNames = pending.slice(capacity).map((attachment) => attachment.name);
        const restoredImages = hydrateImagesFromPersisted(pending.slice(0, capacity));
        if (restoredImages.length > 0) {
          addComposerDraftImages(composerDraftTarget, restoredImages);
        }
      }

      // Deliberately no model/provider restore: the stash exists to carry a
      // prompt across threads and providers, so whatever the composer has
      // selected right now stays selected.

      // Each cause gets its own sentence so "too large" is never blamed for a
      // file that actually failed to decode, or for one the composer simply
      // had no room to take back.
      const missingImageReasons: string[] = [];
      if (entry.droppedImageNames.length > 0) {
        missingImageReasons.push(
          `${entry.droppedImageNames.join(", ")} exceeded the stash size limit when this prompt was saved.`,
        );
      }
      if (entry.unreadableImageNames && entry.unreadableImageNames.length > 0) {
        missingImageReasons.push(
          `${entry.unreadableImageNames.join(", ")} could not be read when this prompt was saved.`,
        );
      }
      if (unrestoredImageNames.length > 0) {
        missingImageReasons.push(
          `${unrestoredImageNames.join(", ")} could not be restored: the composer is at its ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}-attachment limit.`,
        );
      }
      if (unrestoredFileNames.length > 0) {
        missingImageReasons.push(
          `${unrestoredFileNames.join(", ")} could not be restored: the composer is at its ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}-attachment limit.`,
        );
      }
      if (expiredFileNames.length > 0) {
        missingImageReasons.push(
          `${expiredFileNames.join(", ")}: stashed files are kept for 24 hours and this upload expired. Attach the file again.`,
        );
      }
      if (missingImageReasons.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Some attachments were not restored",
          description: missingImageReasons.join(" "),
        });
      }

      // Only yank the caret to the end when text was actually inserted;
      // restoring images alone should leave the user where they were typing.
      if (promptChanged) {
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAtEnd();
        });
      }
    },
    [
      addComposerDraftFiles,
      addComposerDraftImages,
      composerDraftTarget,
      composerFilesRef,
      composerImagesRef,
      environmentId,
      promptRef,
      setComposerDraftPrompt,
      takeStashEntry,
    ],
  );

  const deleteStashEntry = useCallback(
    (entry: PromptStashEntry) => {
      const { entry: removed, durable } = takeStashEntry(entry.id);
      if (durable && removed) {
        for (const file of removed.files ?? []) {
          releasePersistedAttachmentUpload({
            id: file.id,
            environmentId: file.environmentId,
            attachmentId: file.attachmentId,
          });
        }
      }
      if (!durable) {
        toastManager.add({
          type: "warning",
          title: "Stash entry may come back",
          description:
            "Browser storage rejected the delete, so this prompt could reappear after a reload.",
          data: { hideCopyButton: true },
        });
      }
    },
    [takeStashEntry],
  );

  const stashCurrentPrompt = useCallback(async () => {
    // Context payloads are not part of the legacy stash shape, so omit their links.
    const prompt = replaceComposerContextReferences(promptRef.current, () => "").trim();
    const images = [...composerImagesRef.current];
    const files = [...composerFilesRef.current];
    if (prompt.length === 0 && images.length === 0 && files.length === 0) {
      const entries = usePromptStashStore.getState().entries;
      const entry = entries.length === 1 ? entries[0] : undefined;
      if (entry && !entry.pendingImageCount) {
        await restoreStashEntry(entry);
      } else {
        setIsStashMenuOpen((open) => !open);
      }
      return;
    }
    const stashedFiles: PersistedComposerFileAttachment[] = [];
    for (const file of files) {
      if (composerFileNeedsReattach(file)) {
        toastManager.add({
          type: "error",
          title: "Attach dropped files again or remove them before stashing",
        });
        return;
      }
      const upload = readAttachmentUpload(file.id);
      if (upload?.status !== "ready" || upload.environmentId !== environmentId) {
        toastManager.add({
          type: "error",
          title: "Wait for file uploads before stashing this prompt",
        });
        return;
      }
      stashedFiles.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        attachmentId: upload.attachmentId,
        environmentId,
        ...(file.source ? { source: file.source } : {}),
      });
    }
    // A repeat ⌘S on the *same* still-unencoded snapshot would stash it
    // twice. Guard on the snapshot itself rather than a bare boolean: once
    // the composer has been cleared the user can type something genuinely
    // new (or switch threads) while encoding continues, and that deserves its
    // own entry.
    const snapshotKey = `${String(composerDraftTarget)} ${prompt} ${images
      .map((image) => `image:${image.id}`)
      .concat(files.map((file) => `file:${file.id}`))
      .join(",")}`;
    if (stashInFlightRef.current.has(snapshotKey)) return;
    stashInFlightRef.current.add(snapshotKey);

    const stashTarget = composerDraftTarget;
    const entryId = randomUUID();
    try {
      // Persist the text-only entry *first*, then clear. Ordering matters in
      // both directions: writing before clearing means a crash or closed tab
      // mid-encode still leaves the prompt recoverable, while clearing before
      // the async image work means edits typed during encoding are not wiped.
      // Images are appended to the stored entry as they finish encoding.
      const { evicted, written, durable } = stashEntryToQueue({
        id: entryId,
        createdAt: new Date().toISOString(),
        prompt,
        attachments: [],
        ...(stashedFiles.length > 0 ? { files: stashedFiles } : {}),
        droppedImageNames: [],
        unreadableImageNames: [],
        pendingImageCount: images.length,
      });

      // Clearing the composer is only safe once the write actually landed.
      // If it was rejected (quota) the store has already rolled itself back,
      // so leave the composer untouched rather than making it the second
      // casualty of a reload.
      if (!written) {
        toastManager.add({
          type: "error",
          title: "Could not stash this prompt",
          description:
            "Browser storage rejected the write, so the composer was left as-is. Free up site data and try again.",
          data: { hideCopyButton: true },
        });
        return;
      }
      // Written but only into the in-memory fallback (localStorage blocked):
      // the entry is visible and restorable this session, so proceed with the
      // clear, but say it won't survive a reload.
      if (!durable) {
        toastManager.add({
          type: "warning",
          title: "Stashed prompt will not survive a reload",
          description:
            "Browser storage is unavailable, so this stash is kept in memory only for this session.",
          data: { hideCopyButton: true },
        });
      }

      // Terminal and preview context stays behind because the stash cannot restore it.
      promptRef.current = "";
      clearComposerDraftPromptAndImages(stashTarget);
      for (const image of images) {
        releaseAttachmentUpload(image.id);
      }
      setComposerCursor(0);
      setComposerTrigger(null);
      pulseStashBadge();

      if (evicted) {
        for (const file of evicted.files ?? []) {
          releasePersistedAttachmentUpload({
            id: file.id,
            environmentId: file.environmentId,
            attachmentId: file.attachmentId,
          });
        }
        toastManager.add({
          type: "warning",
          title: "Oldest stashed prompt discarded",
          description: `The stash holds ${MAX_STASH_ENTRIES} prompts; the oldest was removed to make room.`,
          data: { hideCopyButton: true },
        });
      }

      // Images are re-encoded for the stash rather than stored verbatim: the
      // composer allows up to 10MB per image, but localStorage gives the whole
      // origin ~5MB. Only the stashed copy shrinks; the live attachment (and
      // anything sent without stashing) keeps the original file.
      const candidateAttachments: PersistedComposerImageAttachment[] = [];
      const oversizedImageNames: string[] = [];
      const unreadableImageNames: string[] = [];
      for (const image of images) {
        const result = await compressImageForStash(image.file);
        if (!result.ok) {
          // "too large" and "could not be read" are distinct outcomes; the
          // menu and restore toast report them separately.
          (result.reason === "too-large" ? oversizedImageNames : unreadableImageNames).push(
            image.name,
          );
          continue;
        }
        candidateAttachments.push({
          id: image.id,
          name: image.name,
          mimeType: result.image.mimeType,
          sizeBytes: result.image.sizeBytes,
          dataUrl: result.image.dataUrl,
          ...(image.source
            ? { source: resizeSnapShotSource(image.source, result.image.imageSize) }
            : {}),
        });
      }
      const { kept, droppedNames } = partitionStashAttachments(candidateAttachments);

      const { attached, durable: imagesDurable } = finalizeStashEntryImages(entryId, {
        attachments: kept,
        droppedImageNames: [...oversizedImageNames, ...droppedNames],
        unreadableImageNames,
      });
      if (attached) {
        // The second phase can be rejected on its own: the text-only entry
        // fit, but adding image payloads pushed past the quota. Disk would
        // then still hold the phase-one entry with pendingImageCount set,
        // which reads as an orphan after reload — so say so now. Gated on the
        // entry write having been durable: on the in-memory fallback nothing
        // is ever durable, and the session-only warning already covered it.
        if (!imagesDurable && durable && images.length > 0) {
          toastManager.add({
            type: "warning",
            title: "Stashed images were not saved",
            description:
              "The prompt was stashed, but browser storage rejected its images. They will be missing if you reload.",
            data: { hideCopyButton: true },
          });
        }
      } else if (kept.length > 0) {
        // The entry was restored or deleted before its images finished
        // encoding, so they have nowhere to land. Say so rather than letting
        // them evaporate.
        toastManager.add({
          type: "warning",
          title: "Stashed images did not attach",
          description: `That prompt was restored or deleted before ${kept.length} image${kept.length === 1 ? "" : "s"} finished saving. Re-attach ${kept.length === 1 ? "it" : "them"} if you still need ${kept.length === 1 ? "it" : "them"}.`,
          data: { hideCopyButton: true },
        });
      }
    } finally {
      // Must clear on every path: a throw that left this set would wedge this
      // snapshot's ⌘S until the composer remounts.
      stashInFlightRef.current.delete(snapshotKey);
    }
  }, [
    clearComposerDraftPromptAndImages,
    composerDraftTarget,
    composerFilesRef,
    composerImagesRef,
    environmentId,
    finalizeStashEntryImages,
    promptRef,
    pulseStashBadge,
    restoreStashEntry,
    stashEntryToQueue,
  ]);

  const toggleStashMenu = useCallback(() => {
    setIsStashMenuOpen((open) => !open);
  }, []);

  // Close the stash menu whenever the trigger-driven command menu opens so
  // the two popovers never stack in the same layer, and when the user
  // resumes typing (the menu is a transient picker, not a panel).
  useEffect(() => {
    if (composerMenuOpen) {
      setIsStashMenuOpen(false);
    }
  }, [composerMenuOpen]);
  useEffect(() => {
    setIsStashMenuOpen(false);
  }, [prompt]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: getTerminalFocusOwner() !== null,
          terminalOpen,
          modelPickerOpen: isComposerModelPickerOpen,
        },
      });
      if (command !== "composer.stash") return;
      // Always claim the shortcut so the browser save dialog never opens,
      // even when the composer is in a state that can't stash.
      event.preventDefault();
      event.stopPropagation();
      if (
        isCommandPaletteOpen() ||
        isRevertingCheckpoint ||
        isComposerApprovalState ||
        pendingUserInputs.length > 0 ||
        projectSelectionRequired ||
        activePendingProgress !== null
      ) {
        return;
      }
      void stashCurrentPrompt();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activePendingProgress,
    isComposerApprovalState,
    isComposerModelPickerOpen,
    keybindings,
    pendingUserInputs.length,
    projectSelectionRequired,
    stashCurrentPrompt,
    isRevertingCheckpoint,
    terminalOpen,
  ]);

  // ------------------------------------------------------------------
  // Callbacks: attachments
  // ------------------------------------------------------------------
  const countReservedAttachments = () => {
    const questionRequest = pendingUserInputs[0];
    const otherQuestionKeys =
      questionAttachmentTarget && questionRequest && activeThreadId
        ? questionRequest.questions
            .map((question) =>
              questionAttachmentDraftId(
                environmentId,
                activeThreadId,
                questionRequest.requestId,
                question.id,
              ),
            )
            .filter((key) => key !== questionAttachmentTarget)
        : [];
    return (
      composerImagesRef.current.length +
      composerFilesRef.current.length +
      (pendingImageCompressionsRef.current.get(attachmentTargetKey) ?? 0) +
      countQuestionAttachments(otherQuestionKeys)
    );
  };

  const addComposerAttachments = async (
    files: File[],
    options?: {
      readonly source?: ChatFileAttachment["source"];
      readonly selection?: { start: number; end: number };
    },
  ): Promise<boolean> => {
    if (!activeThreadId || files.length === 0 || isRevertingCheckpointRef.current) return false;
    if (
      pendingUserInputs.length > 0 &&
      (!supportsQuestionAttachments ||
        activePendingProgress?.activeQuestion?.allowCustomAnswer === false ||
        activePendingIsResponding)
    ) {
      toastManager.add({
        type: "error",
        title: "This question cannot accept attachments.",
      });
      return false;
    }
    // Captured before the awaits below: the user may switch threads while a
    // large image is being compressed, and the attachments and errors belong
    // to the thread the paste happened in.
    const threadId = activeThreadId;

    // Validation happens synchronously so concurrent pastes see each other:
    // accepted files reserve their attachment slots (via the pending counter)
    // before the first await, keeping the total under the limit.
    const pendingCount = pendingImageCompressionsRef.current.get(attachmentTargetKey) ?? 0;
    let reservedCount = countReservedAttachments();
    // A pick that matches a needs-reattach marker replaces it in the draft, so
    // it must not consume a slot; a draft full of markers would otherwise hit
    // the capacity error before the replacement path could run.
    const reattachMarkers = composerFilesRef.current.filter(composerFileNeedsReattach);
    const replacedReattachMarkerIds = new Set<string>();
    const acceptedImages: File[] = [];
    const acceptedFiles: ComposerFileAttachment[] = [];
    let error: string | null = null;
    for (const file of files) {
      const attachmentKind = classifyComposerAttachmentFile(file);
      const fileMimeType =
        attachmentKind === "file"
          ? (videoMimeType({ name: file.name, mimeType: file.type }) ??
            (file.type || "application/octet-stream"))
          : file.type;
      const matchingReattachMarker =
        attachmentKind === "file"
          ? reattachMarkers.find(
              (marker) =>
                !replacedReattachMarkerIds.has(marker.id) &&
                composerFileMatchesReattachMarker(marker, {
                  name: file.name || "file",
                  mimeType: fileMimeType,
                  sizeBytes: file.size,
                }),
            )
          : undefined;
      if (matchingReattachMarker) {
        replacedReattachMarkerIds.add(matchingReattachMarker.id);
      }
      if (!matchingReattachMarker && reservedCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
        error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`;
        // Keep scanning: a later file in this batch can still replace a
        // needs-reattach marker without needing a free slot.
        continue;
      }
      if (attachmentKind === "unsupported-image") {
        error = `'${file.name}' is not a supported image type. Attach GIF, HEIC, HEIF, JPEG, PNG, or WebP images.`;
        continue;
      }
      if (attachmentKind === "image") {
        acceptedImages.push(normalizeComposerImageFileMimeType(file));
      } else {
        if (fileStagingLimit === null) {
          error = "This server does not support file attachments.";
          continue;
        }
        if (file.size <= 0) {
          error = `'${file.name}' is empty or could not be read.`;
          continue;
        }
        if (file.size > fileStagingLimit) {
          error = fileAttachmentTooLargeMessage(file.name, fileStagingLimit);
          continue;
        }
        const attachmentFile =
          file.type === fileMimeType
            ? file
            : new File([file], file.name, { type: fileMimeType, lastModified: file.lastModified });
        acceptedFiles.push({
          type: "file",
          id: randomUUID(),
          name: attachmentFile.name || "file",
          mimeType: fileMimeType,
          sizeBytes: attachmentFile.size,
          file: attachmentFile,
          ...(options?.source ? { source: options.source } : {}),
        });
      }
      if (!matchingReattachMarker) {
        reservedCount += 1;
      }
    }
    setThreadError(threadId, error);
    let insertedAny = false;
    if (acceptedFiles.length > 0) {
      const storedIds = new Set(
        addComposerDraftFiles(attachmentDraftTarget, acceptedFiles, {
          appendReference: options?.selection === undefined && questionAttachmentTarget === null,
        }),
      );
      const storedFiles = acceptedFiles.filter((file) => storedIds.has(file.id));
      if (options?.selection && storedFiles.length > 0) {
        const edit = inlineContextReferenceReplacement(
          promptRef.current,
          options.selection,
          storedFiles.map(fileContextReference),
        );
        insertedAny = applyPromptReplacement(edit.start, edit.end, edit.text);
      } else {
        insertedAny = storedFiles.length > 0;
      }
      if (options?.source?._tag === "pasted-text" && storedFiles.length > 0) {
        const attached = storedFiles[0]!;
        toastManager.add({
          type: "info",
          title: `Large paste attached as ${attached.name}`,
          description: `${formatAttachmentSize(attached.sizeBytes)} · Use ${
            isMacPlatform(navigator.platform) ? "⌘⇧V" : "Ctrl+Shift+V"
          } to keep a large paste inline.`,
          data: { hideCopyButton: true },
        });
      }
    }
    if (acceptedImages.length === 0) return insertedAny;

    pendingImageCompressionsRef.current.set(
      attachmentTargetKey,
      pendingCount + acceptedImages.length,
    );
    if (questionAttachmentTarget) {
      changeQuestionAttachmentPreparation(questionAttachmentTarget, acceptedImages.length);
    }
    try {
      const nextImages: ComposerImageAttachment[] = [];
      let compressionError: string | null = null;
      for (const file of acceptedImages) {
        // Images over the wire cap are downscaled to fit rather than
        // refused; files already within it pass through byte-for-byte.
        const compressed = await prepareImageForAttachment(
          file,
          PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
        );
        if (!compressed.ok) {
          compressionError =
            compressed.reason === "unreadable"
              ? `'${file.name}' could not be read as an image.`
              : `'${file.name}' is too large to attach, even after compression.`;
          continue;
        }
        const attachmentFile = compressed.file;
        const previewUrl = URL.createObjectURL(attachmentFile);
        nextImages.push({
          type: "image",
          id: randomUUID(),
          name: attachmentFile.name || "image",
          mimeType: attachmentFile.type,
          sizeBytes: attachmentFile.size,
          previewUrl,
          file: attachmentFile,
        });
      }
      if (
        questionAttachmentTarget &&
        !useQuestionAttachmentPreparation.getState().counts[questionAttachmentTarget]
      ) {
        for (const image of nextImages) URL.revokeObjectURL(image.previewUrl);
        return false;
      }
      if (nextImages.length === 1 && nextImages[0]) {
        addComposerImage(nextImages[0]);
      } else if (nextImages.length > 1) {
        addComposerImagesToDraft(nextImages);
      }
      // Only failures are reported here. Success must not pass `null`: by
      // now other work (a failed send, an overlapping paste) may have set a
      // thread error this call knows nothing about, and clearing it would
      // swallow that message.
      if (compressionError !== null) {
        setThreadError(threadId, compressionError);
      }
    } finally {
      if (questionAttachmentTarget) {
        changeQuestionAttachmentPreparation(questionAttachmentTarget, -acceptedImages.length);
      }
      const remaining =
        (pendingImageCompressionsRef.current.get(attachmentTargetKey) ?? 0) - acceptedImages.length;
      if (remaining > 0) {
        pendingImageCompressionsRef.current.set(attachmentTargetKey, remaining);
      } else {
        pendingImageCompressionsRef.current.delete(attachmentTargetKey);
      }
    }
    return true;
  };

  const removeComposerImage = (imageId: string) => {
    removeComposerImageFromDraft(imageId);
  };

  // ------------------------------------------------------------------
  // Callbacks: paste / drag
  // ------------------------------------------------------------------
  const foldPastedText = (
    plainText: string,
    bypassAutoAttachment: boolean,
    selectionOverride?: { start: number; end: number },
  ): boolean => {
    const questionCanAttach =
      pendingUserInputs.length === 0 ||
      (supportsQuestionAttachments &&
        activePendingProgress?.activeQuestion?.allowCustomAnswer !== false &&
        !activePendingIsResponding);
    const hasAttachmentSlot = countReservedAttachments() < PROVIDER_SEND_TURN_MAX_ATTACHMENTS;
    const selection = selectionOverride ?? composerEditorRef.current?.readSelectionRange();
    const wouldExceedInputLimit = wouldTextPasteExceedLimit({
      valueLength: promptRef.current.length,
      selection: selection ?? { start: 0, end: 0 },
      textLength: plainText.length,
      maxLength: PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
    });
    const shouldFold =
      pastedTextDisposition({
        text: plainText,
        bypassAutoAttachment,
        wouldExceedInputLimit,
        canAttach: true,
      }) === "attachment";
    if (!shouldFold) return false;

    const canStageAttachment =
      Boolean(activeThreadId) &&
      !isRevertingCheckpointRef.current &&
      questionCanAttach &&
      hasAttachmentSlot;
    if (!canStageAttachment || fileStagingLimit === null) {
      if (!wouldExceedInputLimit) return false;
      toastManager.add({
        type: "error",
        title: "Pasted text is too large for this message",
        description: "Remove some text or an attachment, then paste again.",
        data: { hideCopyButton: true },
      });
      return true;
    }

    if (pastedTextFileNamesRef.current.targetKey !== attachmentTargetKey) {
      pastedTextFileNamesRef.current = { targetKey: attachmentTargetKey, names: new Set() };
    }
    const reservedNames = pastedTextFileNamesRef.current.names;
    for (const file of composerFilesRef.current) reservedNames.add(file.name);
    const foldedFileName = nextPastedTextFileName([...reservedNames]);
    reservedNames.add(foldedFileName);
    const foldedFile = new File([plainText], foldedFileName, {
      type: "text/plain;charset=utf-8",
    });
    if (foldedFile.size > fileStagingLimit) {
      reservedNames.delete(foldedFileName);
      if (!wouldExceedInputLimit) return false;
      toastManager.add({
        type: "error",
        title: "Pasted text is too large to attach",
        description: "Reduce the clipboard contents or save a smaller excerpt as a file.",
        data: { hideCopyButton: true },
      });
      return true;
    }

    void addComposerAttachments([foldedFile], {
      source: { _tag: "pasted-text" },
      ...(selection ? { selection } : {}),
    });
    return true;
  };

  const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files);
    const plainText = event.clipboardData.getData("text/plain");
    const bypassAutoAttachment = Date.now() <= pasteAsTextShortcutUntilRef.current;
    pasteAsTextShortcutUntilRef.current = 0;
    // Claimable pastes go through even when agent questions are pending or the
    // composer is at its attachment limit: `addComposerAttachments` surfaces
    // those as a toast and a thread error. An early return here would swallow
    // the paste with no feedback.
    if (
      files.length > 0 &&
      activeThreadId &&
      shouldHandleComposerAttachmentPaste({ files, plainText })
    ) {
      event.preventDefault();
      event.stopPropagation();
      void addComposerAttachments(files);
      return;
    }

    if ((readPastedComposerContext(event.clipboardData)?.records.length ?? 0) > 0) return;
    if (!foldPastedText(plainText, bypassAutoAttachment)) return;

    event.preventDefault();
    event.stopPropagation();
  };

  const insertComposerText = useCallback(
    (
      text: string,
      position: "cursor" | "end",
      options?: {
        ensureLeadingBoundary?: boolean;
        citationCommentAnchor?: AssistantCitationSourceAnchor;
      },
    ): boolean => {
      if (
        text.length === 0 ||
        isConnecting ||
        isComposerApprovalState ||
        pendingUserInputs.length > 0 ||
        projectSelectionRequired ||
        (options?.citationCommentAnchor && !composerEditorRef.current)
      ) {
        return false;
      }
      const prompt = promptRef.current;
      const cursor = position === "cursor" ? readComposerSnapshot().expandedCursor : prompt.length;
      const needsLeadingSpace =
        (options?.ensureLeadingBoundary ?? false) &&
        cursor > 0 &&
        !/\s/.test(prompt[cursor - 1] ?? "");
      const rangeEnd = extendReplacementRangeForTrailingSpace(prompt, cursor, text);
      return applyPromptReplacement(
        cursor,
        rangeEnd,
        needsLeadingSpace ? ` ${text}` : text,
        options?.citationCommentAnchor
          ? {
              citationComment: {
                start: cursor + (needsLeadingSpace ? 1 : 0),
                sourceAnchor: options.citationCommentAnchor,
              },
              focusEditorAfterReplace: false,
            }
          : undefined,
      );
    },
    [
      applyPromptReplacement,
      isComposerApprovalState,
      isConnecting,
      pendingUserInputs.length,
      projectSelectionRequired,
      promptRef,
      readComposerSnapshot,
    ],
  );

  const insertComposerTextAtEnd = useCallback<ChatComposerHandle["insertTextAtEnd"]>(
    (text, options) => insertComposerText(text, "end", options),
    [insertComposerText],
  );

  // File-tree drags land as mentions. Handled in the capture phase so the
  // editor never sees the drop; the load-bearing rules (native stop, "move"
  // effect, no eager focus) live in makeComposerMentionDragHandlers.
  const composerMentionDragHandlers = makeComposerMentionDragHandlers({
    insertMentionAtEnd: (text) => insertComposerTextAtEnd(text, { ensureLeadingBoundary: true }),
    setDragActive: setIsDragOverComposer,
    onInsertRejected: () => {
      toastManager.add({
        type: "error",
        title: "Unable to add to chat",
        description: "The composer is busy; try again once it is ready.",
      });
    },
  });

  const onComposerMentionDragLeaveCapture = (event: React.DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasComposerMention(event.dataTransfer.types)) return;
    event.stopPropagation();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDragOverComposer(false);
  };

  // A cancelled drag (Escape) can end without a dragleave on the hovered
  // target, which would leave the drop highlight stuck. dragend always fires
  // on the in-page drag source and bubbles to window, so it is the reset of
  // last resort while the highlight is up.
  useEffect(() => {
    if (!isDragOverComposer) return;
    const onWindowDragEnd = () => {
      setIsDragOverComposer(false);
    };
    window.addEventListener("dragend", onWindowDragEnd);
    return () => window.removeEventListener("dragend", onWindowDragEnd);
  }, [isDragOverComposer]);
  const handleInterruptPrimaryAction = useCallback(() => {
    void onInterrupt();
  }, [onInterrupt]);
  const handleImplementPlanInNewThreadPrimaryAction = useCallback(() => {
    void onImplementPlanInNewThread();
  }, [onImplementPlanInNewThread]);
  const scheduleComposerCollapseCheck = useCallback(() => {
    if (!isMobileViewport) {
      return;
    }
    if (mobileComposerExpandInFlightRef.current) {
      return;
    }
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
    }
    composerBlurFrameRef.current = window.requestAnimationFrame(() => {
      composerBlurFrameRef.current = null;
      if (mobileComposerExpandInFlightRef.current) {
        return;
      }
      const composerSurface = composerSurfaceRef.current;
      const activeElement = document.activeElement;
      if (activeElement instanceof Element && isInsideComposerFloatingLayer(activeElement)) {
        return;
      }
      if (
        composerSurface &&
        activeElement instanceof Node &&
        composerSurface.contains(activeElement)
      ) {
        return;
      }
      setIsComposerFocused(false);
    });
  }, [isMobileViewport]);

  useEffect(() => {
    return () => {
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
      }
      if (mobileComposerExpandFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
      }
      if (mobileComposerExpandReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // Imperative handle
  // ------------------------------------------------------------------
  /*
   * Dictation inserts through the same path as the imperative handle, and is
   * published on a context so the mic button inside this composer never has to
   * find it through ChatView.
   *
   * Through a ref, because insertComposerTextAtEnd is rebuilt every render and
   * closes over the guards that decide whether text is accepted at all. A
   * callback that captured it once would keep testing the state this composer
   * had at mount -- still connecting, say -- and refuse every transcript for
   * the life of the thread.
   */
  const insertComposerTextAtEndRef = useRef(insertComposerTextAtEnd);
  insertComposerTextAtEndRef.current = insertComposerTextAtEnd;

  const pendingDictationCommitRef = useRef<{
    readonly prompt: string;
    readonly resolve: (committed: boolean) => void;
  } | null>(null);
  const waitForDictatedPromptCommit = useCallback((expectedPrompt: string) => {
    pendingDictationCommitRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      pendingDictationCommitRef.current = { prompt: expectedPrompt, resolve };
    });
  }, []);

  // Effects run after the controlled editor has received the new prompt. Keep
  // dictation in its transcribing state until this acknowledgment, so the mic
  // only becomes available once the text is actually in the chat box.
  useEffect(() => {
    const pending = pendingDictationCommitRef.current;
    if (pending === null || pending.prompt !== prompt) return;
    pendingDictationCommitRef.current = null;
    pending.resolve(true);
  }, [prompt]);

  useEffect(
    () => () => {
      pendingDictationCommitRef.current?.resolve(false);
      pendingDictationCommitRef.current = null;
    },
    [],
  );

  const insertDictatedText = useMemo(
    () =>
      createComposerDictationInsert(
        insertComposerTextAtEndRef,
        promptRef,
        waitForDictatedPromptCommit,
      ),
    [promptRef, waitForDictatedPromptCommit],
  );

  useImperativeHandle(
    composerRef,
    () => ({
      focusAtEnd: () => {
        composerEditorRef.current?.focusAtEnd();
      },
      focusAt: (cursor: number) => {
        composerEditorRef.current?.focusAt(cursor);
      },
      addDroppedFiles: (files: File[]) => {
        void addComposerAttachments(files);
        focusComposer();
      },
      hasPendingAttachments: () =>
        (pendingImageCompressionsRef.current.get(attachmentTargetKey) ?? 0) > 0,
      insertTextAtEnd: insertComposerTextAtEnd,
      pasteTextAtEnd: (text: string, options) => {
        const bypassAutoAttachment =
          options?.bypassAutoAttachment === true ||
          Date.now() <= pasteAsTextShortcutUntilRef.current;
        pasteAsTextShortcutUntilRef.current = 0;
        const promptLength = promptRef.current.length;
        if (
          !foldPastedText(text, bypassAutoAttachment, {
            start: promptLength,
            end: promptLength,
          })
        ) {
          return false;
        }
        focusComposer();
        return true;
      },
      citeAssistantText: (citation, sourceAnchor) =>
        insertComposerText(
          formatAssistantCitationForComposer(citation, citation.comment),
          "cursor",
          { ensureLeadingBoundary: true, citationCommentAnchor: sourceAnchor },
        ),
      openModelPicker: () => {
        setIsComposerModelPickerOpen(true);
      },
      toggleModelPicker: () => {
        setIsComposerModelPickerOpen((open) => !open);
      },
      compactContext: compactThreadContext,
      isModelPickerOpen: () => isComposerModelPickerOpen,
      readSnapshot: () => {
        return readComposerSnapshot();
      },
      resetCursorState: (options?: {
        cursor?: number;
        prompt?: string;
        detectTrigger?: boolean;
      }) => {
        const promptForState = options?.prompt ?? promptRef.current;
        const cursor = clampCollapsedComposerCursor(promptForState, options?.cursor ?? 0);
        setComposerHighlightedItemId(null);
        setComposerCursor(cursor);
        setComposerTrigger(
          options?.detectTrigger
            ? detectComposerTrigger(
                promptForState,
                expandCollapsedComposerCursor(promptForState, cursor),
              )
            : null,
        );
      },
      addTerminalContext: (selection: TerminalContextSelection) => {
        if (!activeThread) return;
        const snapshot = readComposerSnapshot();
        const context = {
          id: randomUUID(),
          threadId: activeThread.id,
          createdAt: new Date().toISOString(),
          ...selection,
        };
        const insertion = insertInlineContextReference(
          snapshot.value,
          snapshot.expandedCursor,
          terminalContextReference(context),
        );
        const nextCollapsedCursor = collapseExpandedComposerCursor(
          insertion.prompt,
          insertion.cursor,
        );
        const inserted = insertComposerDraftTerminalContext(
          composerDraftTarget,
          insertion.prompt,
          context,
          composerTerminalContexts.length,
        );
        if (!inserted) return;
        promptRef.current = insertion.prompt;
        setComposerCursor(nextCollapsedCursor);
        setComposerTrigger(detectComposerTrigger(insertion.prompt, insertion.cursor));
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAt(nextCollapsedCursor);
        });
      },
      getSendContext: () => ({
        prompt: promptRef.current,
        images: composerImagesRef.current,
        files: composerFilesRef.current,
        terminalContexts: composerTerminalContextsRef.current,
        previewAnnotations: composerPreviewAnnotations,
        reviewComments: composerReviewComments,
        selectedPromptEffort,
        selectedModelOptionsForDispatch,
        selectedModelSelection,
        interactionMode,
        providerAvailable: !noProviderAvailable,
        selectedProvider,
        selectedModel,
        selectedProviderModels,
      }),
      validateProviderInput: (providerInput: string) => {
        const validationMessage = getComposerSubmissionValidationMessage({
          prompt: promptRef.current,
          providerInput,
          submissionTarget: "provider-turn",
        });
        providerInputRejectedRef.current = validationMessage !== null;
        setProviderInputSubmissionError(validationMessage);
        return validationMessage === null;
      },
    }),
    [
      activeThread,
      addComposerAttachments,
      foldPastedText,
      composerDraftTarget,
      composerCursor,
      composerTerminalContexts,
      insertComposerDraftTerminalContext,
      insertComposerText,
      insertComposerTextAtEnd,
      promptRef,
      composerImagesRef,
      composerFilesRef,
      composerTerminalContextsRef,
      composerPreviewAnnotations,
      composerReviewComments,
      focusComposer,
      isConnecting,
      isComposerApprovalState,
      pendingUserInputs.length,
      projectSelectionRequired,
      applyPromptReplacement,
      isComposerModelPickerOpen,
      readComposerSnapshot,
      selectedModel,
      selectedModelOptionsForDispatch,
      selectedModelSelection,
      noProviderAvailable,
      selectedPromptEffort,
      selectedProvider,
      selectedProviderModels,
      compactThreadContext,
    ],
  );

  // Render
  // ------------------------------------------------------------------
  return (
    <ComposerDictationContext value={insertDictatedText}>
      <form
        ref={composerFormRef}
        onSubmit={submitComposer}
        className="mx-auto w-full min-w-0 max-w-3xl"
        data-chat-composer-form="true"
      >
        <div
          className={cn(
            "group rounded-[22px] p-px transition-colors duration-(--duration-base)",
            composerProviderState.composerFrameClassName,
          )}
          onDragEnterCapture={composerMentionDragHandlers.onDragEnter}
          onDragOverCapture={composerMentionDragHandlers.onDragOver}
          onDragLeaveCapture={onComposerMentionDragLeaveCapture}
          onDropCapture={composerMentionDragHandlers.onDrop}
        >
          <div
            ref={composerSurfaceRef}
            data-chat-composer-mobile-collapsed={isComposerCollapsedMobile ? "true" : "false"}
            className={cn(
              "rounded-[20px] transition-[background-color] duration-(--duration-base)",
              isDragOverComposer ? "bg-accent/45 ring-1 ring-primary/70" : null,
              projectSelectionRequired ? "opacity-75" : null,
              composerProviderState.composerSurfaceClassName,
            )}
            onFocusCapture={(event) => {
              const activeElement = event.target;
              if (
                isComposerCollapsedMobile &&
                activeElement instanceof HTMLElement &&
                activeElement.closest('[data-chat-composer-collapsed-controls="true"]')
              ) {
                return;
              }
              if (composerBlurFrameRef.current !== null) {
                window.cancelAnimationFrame(composerBlurFrameRef.current);
                composerBlurFrameRef.current = null;
              }
              setIsComposerFocused(true);
            }}
            onBlurCapture={() => {
              scheduleComposerCollapseCheck();
            }}
          >
            {!isComposerCollapsedMobile &&
              (activePendingApproval ? (
                <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
                  <ComposerPendingApprovalPanel
                    approval={activePendingApproval}
                    pendingCount={pendingApprovals.length}
                  />
                </div>
              ) : pendingUserInputs.length > 0 ? (
                <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
                  <ComposerPendingUserInputPanel
                    pendingUserInputs={pendingUserInputs}
                    respondingRequestIds={
                      activePendingIsResponding && activePendingUserInput
                        ? [...respondingRequestIds, activePendingUserInput.requestId]
                        : respondingRequestIds
                    }
                    answers={activePendingDraftAnswers}
                    questionIndex={activePendingQuestionIndex}
                    onToggleOption={onSelectActivePendingUserInputOption}
                    onAdvance={onAdvanceActivePendingUserInput}
                    onDismiss={onDismissActivePendingUserInput}
                  />
                </div>
              ) : showPlanFollowUpPrompt && activeProposedPlan ? (
                <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
                  <ComposerPlanFollowUpBanner
                    key={activeProposedPlan.id}
                    planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
                  />
                </div>
              ) : null)}

            {isComposerCollapsedMobile && activePendingApproval ? (
              <div
                className="rounded-t-[19px] border-b border-border/65 bg-muted/20"
                data-chat-composer-collapsed-controls="true"
              >
                <ComposerPendingApprovalPanel
                  approval={activePendingApproval}
                  pendingCount={pendingApprovals.length}
                />
                <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-3 sm:px-4">
                  <ComposerPendingApprovalActions
                    requestId={activePendingApproval.requestId}
                    isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                    options={activePendingApproval.options}
                    onRespondToApproval={onRespondToApproval}
                  />
                </div>
              </div>
            ) : isComposerCollapsedMobile && pendingUserInputs.length > 0 ? (
              <div
                className="rounded-t-[19px] border-b border-border/65 bg-muted/20"
                data-chat-composer-collapsed-controls="true"
              >
                <ComposerPendingUserInputPanel
                  pendingUserInputs={pendingUserInputs}
                  respondingRequestIds={
                    activePendingIsResponding && activePendingUserInput
                      ? [...respondingRequestIds, activePendingUserInput.requestId]
                      : respondingRequestIds
                  }
                  answers={activePendingDraftAnswers}
                  questionIndex={activePendingQuestionIndex}
                  onToggleOption={onSelectActivePendingUserInputOption}
                  onAdvance={onAdvanceActivePendingUserInput}
                  onDismiss={onDismissActivePendingUserInput}
                />
                <div className="px-3 pb-3 sm:px-4">
                  <div
                    data-chat-composer-mobile-pending-compact="true"
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-lg border border-border/55 bg-background/55 p-1.5 pl-3 transition-colors hover:bg-background/80",
                      !activePendingProgress?.activeQuestion?.multiSelect && "p-0",
                    )}
                  >
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 truncate bg-transparent py-1.5 text-left text-sm",
                        activePendingProgress?.customAnswer
                          ? "text-foreground"
                          : "text-placeholder",
                        !activePendingProgress?.activeQuestion?.multiSelect && "px-3 py-2",
                      )}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={expandMobileComposer}
                      aria-label="Write custom answer"
                    >
                      {activePendingProgress?.customAnswer || "Write custom answer"}
                    </button>
                    {activePendingProgress?.activeQuestion?.multiSelect ? (
                      <ComposerPrimaryActions
                        compact
                        pendingAction={pendingPrimaryAction}
                        isRunning={false}
                        showPlanFollowUpPrompt={false}
                        promptHasText={false}
                        isSendBusy={isSendBusy}
                        sendDisabledReason={sendDisabledReason}
                        isConnecting={isConnecting}
                        isEnvironmentUnavailable={
                          environmentUnavailable !== null ||
                          noProviderAvailable ||
                          projectSelectionRequired
                        }
                        isPreparingWorktree={false}
                        hasSendableContent={false}
                        preserveComposerFocusOnPointerDown
                        onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                        onInterrupt={handleInterruptPrimaryAction}
                        onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {showCollapsedMobilePromptRow ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 truncate bg-transparent p-0 text-left text-[14px] focus:outline-none",
                    (activePendingProgress ? activePendingProgress.customAnswer : prompt.trim())
                      ? "text-foreground"
                      : "text-placeholder",
                  )}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={expandMobileComposer}
                  aria-label="Expand composer"
                >
                  {activePendingProgress
                    ? activePendingProgress.customAnswer ||
                      "Type your own answer, or leave this blank to use the selected option"
                    : prompt.trim() ||
                      (showProviderUnavailable
                        ? "Enable a provider in Settings"
                        : "Ask anything...")}
                </button>
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover disabled:opacity-30"
                  disabled={collapsedComposerPrimaryActionDisabled}
                  aria-label={collapsedComposerPrimaryActionLabel}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    submitComposer();
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M8 3L8 13M8 3L4 7M8 3L12 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ) : null}

            <div
              ref={setComposerMenuAnchor}
              className={cn(
                "relative px-3 pb-2 sm:px-4",
                hasComposerHeader ? "pt-2.5 sm:pt-3" : "pt-3.5 sm:pt-4",
                isComposerCollapsedMobile && "hidden",
              )}
            >
              <ComposerStashBadge
                count={stashQueue.length}
                pulseKey={stashPulse.key}
                pulsing={stashPulse.active}
                menuOpen={isStashMenuOpen}
                onToggleMenu={toggleStashMenu}
              />

              {isStashMenuOpen && !composerMenuOpen && !isComposerApprovalState && (
                <ComposerCommandMenuLayer anchor={composerMenuAnchor}>
                  <ComposerStashMenu
                    entries={stashQueue}
                    stashShortcutLabel={shortcutLabelForCommand(keybindings, "composer.stash", {
                      context: {
                        terminalFocus: false,
                        terminalOpen,
                        modelPickerOpen: false,
                      },
                    })}
                    onRestore={restoreStashEntry}
                    onDelete={deleteStashEntry}
                    onClose={() => setIsStashMenuOpen(false)}
                  />
                </ComposerCommandMenuLayer>
              )}

              {composerMenuOpen && !isComposerApprovalState && (
                <ComposerCommandMenuLayer anchor={composerMenuAnchor}>
                  <ComposerCommandMenu
                    items={composerMenuItems}
                    resolvedTheme={resolvedTheme}
                    isLoading={isComposerMenuLoading}
                    triggerKind={composerTriggerKind}
                    groupSlashCommandSections={
                      composerTrigger?.kind === "slash-command" &&
                      composerTrigger.query.trim().length === 0
                    }
                    emptyStateText={composerMenuEmptyState}
                    activeItemId={activeComposerMenuItem?.id ?? null}
                    onHighlightedItemChange={onComposerMenuItemHighlighted}
                    onSelect={onSelectComposerItem}
                  />
                </ComposerCommandMenuLayer>
              )}

              {!isComposerCollapsedMobile &&
                !isComposerApprovalState &&
                (uncommittedSnapShotIds.length > 0 ||
                  composerVideos.length > 0 ||
                  standaloneComposerImages.length > 0) && (
                  <div
                    className={cn(
                      "mb-3 flex max-w-full gap-2",
                      pendingSnapShotIds.length > 0 ||
                        standaloneComposerImages.some((image) => image.source?.kind === "snap-shot")
                        ? "snap-x snap-proximity overflow-x-auto overscroll-x-contain pb-1 [scrollbar-color:color-mix(in_srgb,var(--contrast-foreground)_18%,transparent)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-3 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--contrast-foreground)_18%,transparent)] [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar-thumb:hover]:bg-[color-mix(in_srgb,var(--contrast-foreground)_28%,transparent)] [&::-webkit-scrollbar-track]:mx-1 [&::-webkit-scrollbar-track]:bg-transparent"
                        : "flex-wrap",
                    )}
                  >
                    {standaloneComposerImages
                      .map((image) => {
                        const upload = supportsAttachmentUploads
                          ? uploadsByImageId[image.id]
                          : undefined;
                        const snapShotAnimationPending =
                          image.source?.kind === "snap-shot" && pendingSnapShotIdSet.has(image.id);
                        const snapShotArrival =
                          image.source?.kind === "snap-shot" &&
                          shouldAnimateSnapShotArrival(image.source.capturedAt);
                        return (
                          <SnapShotAttachmentFrame
                            key={image.id}
                            data-chat-composer-expanded-image="true"
                            aria-hidden={snapShotAnimationPending || undefined}
                            inert={snapShotAnimationPending || undefined}
                            arrival={snapShotArrival}
                            animateArrival={
                              settings.snapShotAnimations &&
                              !snapShotAnimationPending &&
                              snapShotArrival
                            }
                            animationId={snapShotAnimationPending ? image.id : undefined}
                            animationSource={snapShotAnimationPending ? image.source : undefined}
                            className={cn(
                              "group/attachment relative shrink-0 snap-start overflow-hidden border border-border/80 bg-background",
                              image.source?.kind === "snap-shot"
                                ? SNAP_SHOT_ATTACHMENT_FRAME_CLASS
                                : "h-16 w-16 rounded-lg",
                            )}
                          >
                            {image.previewUrl ? (
                              <button
                                type="button"
                                className="h-full w-full cursor-zoom-in"
                                aria-label={`Preview ${image.name}`}
                                onClick={() => {
                                  const preview = buildExpandedImagePreview(
                                    composerImages,
                                    image.id,
                                  );
                                  if (!preview) return;
                                  onExpandImage(preview);
                                }}
                              >
                                <ComposerImageThumbnail
                                  file={image.file}
                                  alt={image.name}
                                  className="h-full w-full object-cover"
                                  fallback={
                                    <span className="flex h-full items-center justify-center px-1 text-[10px] text-secondary-label">
                                      {image.name}
                                    </span>
                                  }
                                />
                              </button>
                            ) : (
                              <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-secondary-label">
                                {image.name}
                              </div>
                            )}
                            {image.source?.kind === "snap-shot" ? (
                              <SnapShotAttachmentDetails
                                source={image.source}
                                className={cn(
                                  upload?.status === "uploading" && "bottom-4",
                                  upload?.status === "failed" && "bottom-8",
                                )}
                              />
                            ) : null}
                            {nonPersistedComposerImageIdSet.has(image.id) && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <span
                                      role="img"
                                      aria-label="Draft attachment may not persist"
                                      className="absolute left-1 top-1 inline-flex items-center justify-center rounded bg-background/85 p-0.5 text-amber-600"
                                    >
                                      <CircleAlertIcon className="size-3" />
                                    </span>
                                  }
                                />
                                <TooltipPopup
                                  side="top"
                                  className="max-w-64 whitespace-normal leading-tight"
                                >
                                  Draft attachment could not be saved locally and may be lost on
                                  navigation.
                                </TooltipPopup>
                              </Tooltip>
                            )}
                            {upload?.status === "uploading" && (
                              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-background/85 px-1 text-center text-[10px] text-foreground">
                                {formatAttachmentUploadProgress(upload.progress)}
                              </span>
                            )}
                            {upload?.status === "failed" && (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      className="absolute bottom-1 left-1 bg-background/85 hover:bg-background/95"
                                      onClick={() =>
                                        retryAttachmentUpload({
                                          environmentId,
                                          image,
                                          draftTarget: attachmentDraftTarget,
                                        })
                                      }
                                      aria-label={`Retry upload for ${image.name}`}
                                    />
                                  }
                                >
                                  <RotateCcwIcon />
                                </TooltipTrigger>
                                <TooltipPopup
                                  side="top"
                                  className="max-w-64 whitespace-normal leading-tight"
                                >
                                  {upload.reason}
                                </TooltipPopup>
                              </Tooltip>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className={cn(
                                "absolute right-1 top-1 bg-background/80 hover:bg-background/90",
                                image.source?.kind === "snap-shot" &&
                                  "opacity-0 transition-opacity pointer-coarse:opacity-100 focus-visible:opacity-100 group-hover/attachment:opacity-100 group-focus-within/attachment:opacity-100",
                              )}
                              onClick={() => removeComposerImage(image.id)}
                              aria-label={`Remove ${image.name}`}
                            >
                              <XIcon />
                            </Button>
                          </SnapShotAttachmentFrame>
                        );
                      })
                      .concat(
                        uncommittedSnapShotIds.map((captureId) => (
                          <SnapShotAttachmentFrame
                            key={captureId}
                            aria-hidden="true"
                            animationId={captureId}
                            animationSource={
                              pendingSnapShotAnimations.find((capture) => capture.id === captureId)
                                ?.source
                            }
                            className={cn(
                              SNAP_SHOT_ATTACHMENT_FRAME_CLASS,
                              "invisible shrink-0 snap-start bg-background",
                            )}
                          />
                        )),
                      )}
                    {composerVideos.map((file) => {
                      const fileCanUpload =
                        supportsAttachmentUploads &&
                        maxFileAttachmentBytes !== null &&
                        file.sizeBytes <= maxFileAttachmentBytes;
                      const upload = fileCanUpload ? uploadsByImageId[file.id] : undefined;
                      const isOpening = file.uploadedAttachmentId === openingVideoAttachmentId;
                      return (
                        <div
                          key={file.id}
                          className="relative h-16 w-16 shrink-0 snap-start overflow-hidden rounded-lg border border-border/80 bg-black"
                        >
                          <button
                            type="button"
                            className="flex h-full w-full cursor-zoom-in flex-col items-center justify-center gap-1 px-1 text-white aria-disabled:cursor-default aria-disabled:opacity-50"
                            aria-busy={isOpening || undefined}
                            aria-disabled={isOpening || undefined}
                            aria-label={`${isOpening ? "Loading" : "Play"} ${file.name}`}
                            onClick={() => {
                              if (isOpening) return;
                              if (file.file !== null) {
                                const preview = buildExpandedImagePreview([file], file.id);
                                if (preview) onExpandImage(preview);
                                return;
                              }
                              if (!file.uploadedAttachmentId) return;
                              onFileOpen({ ...file, id: file.uploadedAttachmentId });
                            }}
                          >
                            {file.file && (
                              <>
                                <ComposerVideoThumbnail file={file.file} />
                                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/10" />
                              </>
                            )}
                            {isOpening ? (
                              <span className="relative z-10 text-[10px]">Loading…</span>
                            ) : (
                              <PlayIcon className="relative z-10 size-4 fill-current drop-shadow-md" />
                            )}
                          </button>
                          {upload?.status === "uploading" && (
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-background/85 px-1 text-center text-[10px] text-foreground">
                              {formatAttachmentUploadProgress(upload.progress)}
                            </span>
                          )}
                          {upload?.status === "failed" && (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="absolute bottom-1 left-1 bg-background/85 hover:bg-background/95"
                                    onClick={() =>
                                      retryAttachmentUpload({
                                        environmentId,
                                        image: file,
                                        draftTarget: attachmentDraftTarget,
                                      })
                                    }
                                    aria-label={`Retry upload for ${file.name}`}
                                  />
                                }
                              >
                                <RotateCcwIcon />
                              </TooltipTrigger>
                              <TooltipPopup
                                side="top"
                                className="max-w-64 whitespace-normal leading-tight"
                              >
                                {upload.reason}
                              </TooltipPopup>
                            </Tooltip>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="absolute right-1 top-1 bg-background/80 hover:bg-background/90"
                            onClick={() => removeComposerFileFromDraft(file.id)}
                            aria-label={`Remove ${file.name}`}
                          >
                            <XIcon />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}

              {!isComposerCollapsedMobile &&
                !isComposerApprovalState &&
                composerOtherFiles.length > 0 && (
                  <div className="mb-3 flex flex-col gap-1">
                    {composerOtherFiles.map((file) => {
                      const fileCanUpload =
                        supportsAttachmentUploads &&
                        maxFileAttachmentBytes !== null &&
                        file.sizeBytes <= maxFileAttachmentBytes;
                      const upload = fileCanUpload ? uploadsByImageId[file.id] : undefined;
                      const needsReattach = composerFileNeedsReattach(file);
                      const canReattachFile =
                        fileStagingLimit !== null && file.sizeBytes <= fileStagingLimit;
                      return (
                        <div
                          key={file.id}
                          className="flex min-w-0 items-center gap-2 py-1 text-sm text-foreground"
                        >
                          <PierreEntryIcon
                            pathValue={file.name}
                            kind="file"
                            theme={resolvedTheme}
                          />
                          <span className="min-w-0 flex-1 truncate">{file.name}</span>
                          <span className="shrink-0 text-xs text-secondary-label">
                            {needsReattach
                              ? canReattachFile
                                ? "Attach again"
                                : "Remove to send"
                              : upload?.status === "uploading"
                                ? formatAttachmentUploadProgress(upload.progress)
                                : formatAttachmentSize(file.sizeBytes)}
                          </span>
                          {!needsReattach && upload?.status === "failed" ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() =>
                                      retryAttachmentUpload({
                                        environmentId,
                                        image: file,
                                        draftTarget: attachmentDraftTarget,
                                      })
                                    }
                                    aria-label={`Retry upload for ${file.name}`}
                                  />
                                }
                              >
                                <RotateCcwIcon />
                              </TooltipTrigger>
                              <TooltipPopup
                                side="top"
                                className="max-w-64 whitespace-normal leading-tight"
                              >
                                {upload.reason}
                              </TooltipPopup>
                            </Tooltip>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeComposerFileFromDraft(file.id)}
                            aria-label={`Remove ${file.name}`}
                          >
                            <XIcon />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              <div className="relative">
                <ComposerContextActionsContext value={composerContextActions}>
                  <ComposerPromptEditor
                    editorRef={composerEditorRef}
                    value={
                      isComposerApprovalState
                        ? ""
                        : activePendingProgress
                          ? activePendingProgress.customAnswer
                          : prompt
                    }
                    cursor={composerCursor}
                    contextRecords={composerContextRecords}
                    skills={selectedProviderSkills}
                    {...(showMobilePendingAnswerActions ? { className: "max-sm:pb-11" } : {})}
                    onChange={onPromptChange}
                    onCommandKeyDown={onComposerCommandKey}
                    onPageScrollKeyDown={onPageScrollKeyDown}
                    onPageScrollKeyUp={onPageScrollKeyUp}
                    onPageScrollRelease={onPageScrollRelease}
                    onPaste={onComposerPaste}
                    placeholder={
                      isComposerApprovalState
                        ? (activePendingApproval?.detail ??
                          "Resolve this approval request to continue")
                        : activePendingProgress
                          ? "Type your own answer, or leave this blank to use the selected option"
                          : showPlanFollowUpPrompt && activeProposedPlan
                            ? "Add feedback to refine the plan, or leave this blank to implement it"
                            : projectSelectionRequired
                              ? "Choose a project above to start a thread"
                              : showProviderUnavailable
                                ? "Enable a provider in Settings to send a message"
                                : phase === "disconnected" && activeThread
                                  ? DISCONNECTED_COMPOSER_PLACEHOLDER
                                  : "Ask anything, @tag files/folders, $use skills, or / for commands"
                    }
                    disabled={
                      isConnecting ||
                      isComposerApprovalState ||
                      projectSelectionRequired ||
                      activePendingIsResponding
                    }
                  />
                </ComposerContextActionsContext>
                {showMobilePendingAnswerActions ? (
                  <div
                    data-chat-composer-mobile-pending-actions="true"
                    className="absolute bottom-0 right-0 flex justify-end"
                  >
                    <ComposerPrimaryActions
                      compact
                      pendingAction={pendingPrimaryAction}
                      isRunning={false}
                      showPlanFollowUpPrompt={false}
                      promptHasText={false}
                      isSendBusy={isSendBusy}
                      sendDisabledReason={sendDisabledReason}
                      isConnecting={isConnecting}
                      isEnvironmentUnavailable={
                        environmentUnavailable !== null ||
                        noProviderAvailable ||
                        projectSelectionRequired
                      }
                      isPreparingWorktree={false}
                      hasSendableContent={false}
                      preserveComposerFocusOnPointerDown
                      onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                      onInterrupt={handleInterruptPrimaryAction}
                      onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            {/* Bottom toolbar */}
            {isComposerCollapsedMobile ? null : activePendingApproval ? (
              <div className="flex flex-wrap items-center justify-end gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
                <ComposerPendingApprovalActions
                  requestId={activePendingApproval.requestId}
                  isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                  options={activePendingApproval.options}
                  onRespondToApproval={onRespondToApproval}
                />
              </div>
            ) : (
              <div
                data-chat-composer-footer="true"
                data-chat-composer-footer-compact={isComposerFooterCompact ? "true" : "false"}
                className={cn(
                  "flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible px-3 pb-3 sm:px-4 sm:pb-4",
                  pendingUserInputs.length > 0 && "pt-2",
                  isComposerFooterCompact ? "gap-1.5" : "gap-2 sm:gap-0",
                  showMobilePendingAnswerActions && "hidden sm:flex",
                )}
              >
                <div
                  ref={composerFooterControlsRef}
                  data-chat-composer-footer-controls="true"
                  className="-m-1 -ms-3.5 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 ps-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {showProviderUnavailable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled
                      data-chat-provider-unavailable="true"
                      className="shrink-0 gap-2 px-2 text-secondary-label sm:px-3"
                    >
                      <CircleAlertIcon className="size-4" />
                      No provider available
                    </Button>
                  ) : (
                    <ProviderModelPicker
                      isComposerOwned
                      disabled={providerCatalogPending}
                      activeInstanceId={
                        providerCatalogPending
                          ? (activeThreadModelSelection?.instanceId ?? selectedInstanceId)
                          : selectedInstanceId
                      }
                      model={
                        providerCatalogPending
                          ? (activeThreadModelSelection?.model ??
                            selectedModelForPickerWithCustomFallback)
                          : selectedModelForPickerWithCustomFallback
                      }
                      lockedProvider={lockedProvider}
                      lockedContinuationGroupKey={lockedContinuationGroupKey}
                      instanceEntries={providerInstanceEntries}
                      keybindings={keybindings}
                      modelOptionsByInstance={modelOptionsByInstance}
                      triggerClassName="-ms-2.5"
                      terminalOpen={terminalOpen}
                      open={isComposerModelPickerOpen}
                      {...(composerProviderState.modelPickerIconClassName
                        ? {
                            activeProviderIconClassName:
                              composerProviderState.modelPickerIconClassName,
                          }
                        : {})}
                      onOpenChange={(open) => {
                        setIsComposerModelPickerOpen(open);
                      }}
                      getModelDisabledReason={getModelDisabledReason}
                      onInstanceModelChange={onProviderModelSelect}
                    />
                  )}

                  {isComposerFooterCompact ? (
                    <CompactComposerControlsMenu
                      interactionMode={interactionMode}
                      runtimeMode={runtimeMode}
                      showPlanMode={composerProviderControls.showInteractionModeToggle}
                      traitsMenuContent={providerTraitsMenuContent}
                      onInteractionModeChange={handleInteractionModeChange}
                      onRuntimeModeChange={handleRuntimeModeChange}
                    />
                  ) : (
                    <>
                      {providerTraitsPicker ? (
                        <>
                          <Separator
                            orientation="vertical"
                            className="mx-0.5 hidden h-4 sm:block"
                          />
                          {providerTraitsPicker}
                        </>
                      ) : null}
                      <ComposerFooterModeControls
                        showPlanMode={composerProviderControls.showInteractionModeToggle}
                        interactionMode={interactionMode}
                        runtimeMode={runtimeMode}
                        onInteractionModeChange={handleInteractionModeChange}
                        onRuntimeModeChange={handleRuntimeModeChange}
                      />
                    </>
                  )}
                </div>

                {/* Right side: send / stop button */}
                <div
                  data-chat-composer-actions="right"
                  data-chat-composer-primary-actions-compact={
                    isComposerPrimaryActionsCompact ? "true" : "false"
                  }
                  className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
                >
                  {showComposerAttachAction ? (
                    <>
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          const files = Array.from(event.currentTarget.files ?? []);
                          event.currentTarget.value = "";
                          void addComposerAttachments(files);
                          focusComposer();
                        }}
                      />
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onPointerDown={(event) => event.preventDefault()}
                              onClick={() => attachmentInputRef.current?.click()}
                              aria-label="Attach files"
                            />
                          }
                        >
                          <PaperclipIcon />
                        </TooltipTrigger>
                        <TooltipPopup>Attach files</TooltipPopup>
                      </Tooltip>
                    </>
                  ) : null}
                  <ComposerFooterPrimaryActions
                    compact={isComposerPrimaryActionsCompact}
                    activeContextWindow={
                      settings.contextWindowMeterEnabled ? activeContextWindow : null
                    }
                    reserveContextWindowMeter={reserveContextWindowMeter}
                    activeThreadModelDisplayName={activeThreadModelDisplayName}
                    pendingAction={pendingPrimaryAction}
                    isRunning={phase === "running"}
                    showPlanFollowUpPrompt={
                      pendingUserInputs.length === 0 && showPlanFollowUpPrompt
                    }
                    promptHasText={prompt.trim().length > 0}
                    isSendBusy={isSendBusy}
                    sendDisabledReason={sendDisabledReason}
                    isConnecting={isConnecting}
                    isEnvironmentUnavailable={
                      environmentUnavailable !== null ||
                      noProviderAvailable ||
                      projectSelectionRequired
                    }
                    isPreparingWorktree={isPreparingWorktree}
                    hasSendableContent={composerSendState.hasSendableContent}
                    preserveComposerFocusOnPointerDown={isMobileViewport}
                    showSendWhileRunning={isMobileViewport}
                    onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                    onInterrupt={handleInterruptPrimaryAction}
                    onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                    onSecondOpinion={onSecondOpinion ?? null}
                    compactDisabled={
                      compactDisabled || noProviderAvailable || isSendBusy || isConnecting
                    }
                    compactDisabledReason={resolvedCompactDisabledReason}
                    {...(compactCommandAvailable ? { onCompactContext: compactThreadContext } : {})}
                  />
                </div>
              </div>
            )}
            <ComposerPromptLengthValidation
              message={providerInputSubmissionError ?? composerSubmissionError}
            />
          </div>
        </div>
      </form>
    </ComposerDictationContext>
  );
});

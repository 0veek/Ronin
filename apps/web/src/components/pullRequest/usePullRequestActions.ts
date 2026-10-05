/** Shared quick-action behavior for pull request lists and thread toolbars. */
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestAction,
  PullRequestMergeMethod,
  PullRequestRef,
} from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";
import { useClientSettings } from "~/hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "~/logicalProject";
import { buildPhysicalToLogicalProjectKeyMap } from "~/sidebarProjectGrouping";
import { useProjects } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";

import { toastManager } from "../ui/toast";
import { readableFailure } from "./pullRequestDetail.logic";

/** Resolve on demand so hidden quick actions do not rebuild the legacy project grouping. */
export function usePullRequestDefaultMergeMethodResolver(
  environmentId: EnvironmentId,
  projectId: ProjectId,
) {
  const legacyOverrides = useClientSettings((settings) => settings.pullRequestMergeMethodOverrides);
  const grouping = useClientSettings(selectProjectGroupingSettings);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return useCallback(() => {
    if (Object.keys(legacyOverrides).length === 0) return undefined;
    const project = projects.find(
      (candidate) => candidate.environmentId === environmentId && candidate.id === projectId,
    );
    if (!project) return undefined;
    // Duplicate sidebar rows borrow their logical group key from their siblings.
    const key =
      buildPhysicalToLogicalProjectKeyMap({
        projects,
        settings: grouping,
        primaryEnvironmentId,
      }).get(derivePhysicalProjectKey(project)) ??
      deriveLogicalProjectKeyFromSettings(project, grouping);
    return legacyOverrides[key];
  }, [projects, environmentId, projectId, grouping, primaryEnvironmentId, legacyOverrides]);
}

const ACTION_SUCCESS_LABELS: Record<PullRequestAction, string> = {
  merge: "Merge requested",
  ready: "Marked ready for review",
  draft: "Converted to draft",
  close: "Pull request closed",
  reopen: "Pull request reopened",
  "update-branch": "Branch updated with the base branch",
  "enable-auto-merge": "Auto-merge enabled",
  "disable-auto-merge": "Auto-merge disabled",
  revert: "Revert pull request opened",
  "approve-workflows": "Workflows approved",
};

/** Said as the thing that did not happen, rather than as the operation that returned an error. */
const ACTION_FAILURE_LABELS: Record<PullRequestAction, string> = {
  merge: "Could not merge this pull request",
  ready: "Could not mark this ready for review",
  draft: "Could not convert this to a draft",
  close: "Could not close this pull request",
  reopen: "Could not reopen this pull request",
  "update-branch": "Could not update this branch",
  "enable-auto-merge": "Could not enable auto-merge",
  "disable-auto-merge": "Could not disable auto-merge",
  revert: "Could not open a revert pull request",
  "approve-workflows": "Could not approve workflows",
};

/** What to try, for the times the host says only that it refused. */
const ACTION_FAILURE_HINTS: Record<PullRequestAction, string> = {
  merge:
    "The host refused the merge. Check that you have write access, that the checks it requires have passed, and that the branch is not conflicting.",
  ready: "The host refused it. Check that you have write access to this repository.",
  draft: "The host refused it. Check that you have write access to this repository.",
  close: "The host refused it. Check that you have write access, or that you opened it.",
  reopen:
    "The host refused it. Check that you have write access, and that the branch still exists.",
  "update-branch":
    "The host refused it. Check that you have write access, and that the base branch has not diverged in a way the host cannot merge.",
  "enable-auto-merge":
    "The host refused it. Check that auto-merge is enabled for this repository and that you have write access.",
  "disable-auto-merge": "The host refused it. Check that you have write access to this repository.",
  revert:
    "The host refused it. Check that you have write access and that this pull request was merged on the host.",
  "approve-workflows":
    "The host refused it. Check that you have Actions write access and that these workflow runs are still awaiting approval.",
};

async function performWithCleanup(
  perform: () => Promise<void>,
  reportFailure: (failure: unknown) => void,
  release: () => void,
) {
  try {
    await perform();
  } catch (failure) {
    reportFailure(failure);
  } finally {
    release();
  }
}

/**
 * Runs one host action against a pull request, with the toasts every surface should say the same
 * way. `onSuccess` is where the caller re-reads whatever it is showing.
 */
export function usePullRequestActionRunner({
  environmentId,
  reference,
  onSuccess,
  resolveMergeMethod,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef | null;
  onSuccess?: (action: PullRequestAction) => void;
  /** Small surfaces resolve repository settings on the click, not for every visible row. */
  resolveMergeMethod?: () => Promise<PullRequestMergeMethod>;
}) {
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const [actionPending, setActionPending] = useState(false);
  const pendingRef = useRef(false);

  const perform = async (action: PullRequestAction, method?: PullRequestMergeMethod) => {
    if (pendingRef.current || reference === null) return;
    pendingRef.current = true;
    setActionPending(true);
    await performWithCleanup(
      async () => {
        const mergeMethod =
          method ?? (action === "merge" ? await resolveMergeMethod?.() : undefined);
        const result = await runAction({
          environmentId,
          input: { ...reference, action, ...(mergeMethod ? { mergeMethod } : {}) },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        toastManager.add({ type: "success", title: ACTION_SUCCESS_LABELS[action] });
        onSuccess?.(action);
      },
      (failure) => {
        toastManager.add({
          type: "error",
          title: ACTION_FAILURE_LABELS[action],
          description: readableFailure(failure, ACTION_FAILURE_HINTS[action]),
        });
      },
      () => {
        pendingRef.current = false;
        setActionPending(false);
      },
    );
  };

  return { actionPending, perform };
}

/**
 * Dispatching a second opinion: one prompt, several providers, one race.
 *
 * Each entrant is a whole ordinary turn — create the thread, cut a worktree,
 * run the project's setup script, send the prompt — expressed as a single
 * `thread.turn.start` with a bootstrap, which is the same path the composer
 * takes for a first message. Nothing about a racing thread is special except
 * the group id it shares with its rivals.
 *
 * Entrants are dispatched in order rather than all at once. Each one cuts a
 * git worktree and may run a setup script against the same repository, and
 * firing four of those into the same `.git` simultaneously is how you get
 * index.lock contention on the user's real project.
 *
 * @module useSecondOpinion
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { newMessageId, newThreadId, randomHex, randomUUID } from "../lib/utils";
import { buildSecondOpinionTitle, type SecondOpinionEntrant } from "../secondOpinion";
import { readProject } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";

export interface SecondOpinionRequest {
  readonly projectRef: ScopedProjectRef;
  readonly prompt: string;
  readonly entrants: ReadonlyArray<SecondOpinionEntrant>;
  /** Branch every entrant's worktree is cut from. */
  readonly baseBranch: string;
  readonly startFromOrigin: boolean;
}

export interface SecondOpinionResult {
  readonly comparisonGroupId: string;
  readonly threadRefs: ReadonlyArray<ScopedThreadRef>;
  /** Entrants whose turn never started, by label. */
  readonly failedLabels: ReadonlyArray<string>;
}

export function useSecondOpinion() {
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });

  return useCallback(
    async (request: SecondOpinionRequest): Promise<SecondOpinionResult | null> => {
      const prompt = request.prompt.trim();
      if (prompt.length === 0 || request.entrants.length === 0) return null;
      const project = readProject(request.projectRef);
      if (project === null) return null;

      const comparisonGroupId = randomUUID();
      const startedRefs: ScopedThreadRef[] = [];
      const failedLabels: string[] = [];

      for (const entrant of request.entrants) {
        const threadId = newThreadId();
        const createdAt = new Date().toISOString();
        const title = buildSecondOpinionTitle(prompt, entrant.label);
        const result = await startThreadTurn({
          environmentId: request.projectRef.environmentId,
          input: {
            threadId,
            message: {
              messageId: newMessageId(),
              role: "user",
              text: prompt,
              attachments: [],
            },
            modelSelection: entrant.modelSelection,
            titleSeed: title,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            bootstrap: {
              createThread: {
                projectId: request.projectRef.projectId,
                title,
                modelSelection: entrant.modelSelection,
                runtimeMode: DEFAULT_RUNTIME_MODE,
                interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
                branch: request.baseBranch,
                worktreePath: null,
                comparisonGroupId,
                createdAt,
              },
              // Every entrant gets its own checkout. Without this they would
              // write over each other and the comparison would be meaningless.
              prepareWorktree: {
                projectCwd: project.workspaceRoot,
                baseBranch: request.baseBranch,
                branch: buildTemporaryWorktreeBranchName(randomHex),
                ...(request.startFromOrigin ? { startFromOrigin: true } : {}),
              },
              runSetupScript: true,
            },
            createdAt,
          },
        });
        if (result._tag === "Failure") {
          failedLabels.push(entrant.label);
          continue;
        }
        startedRefs.push(scopeThreadRef(request.projectRef.environmentId, threadId));
      }

      if (startedRefs.length === 0) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start the comparison",
            description: "No entrant's turn started. Check the providers and try again.",
          }),
        );
        return null;
      }

      toastManager.add(
        stackedThreadToast({
          type: failedLabels.length === 0 ? "success" : "warning",
          title:
            failedLabels.length === 0
              ? `Comparing ${startedRefs.length} models`
              : `Started ${startedRefs.length}, ${failedLabels.length} failed`,
          description:
            failedLabels.length === 0
              ? "Each one is working in its own worktree."
              : `Could not start: ${failedLabels.join(", ")}.`,
        }),
      );

      return { comparisonGroupId, threadRefs: startedRefs, failedLabels };
    },
    [startThreadTurn],
  );
}

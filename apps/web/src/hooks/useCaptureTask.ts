/**
 * Capturing a passage as a task on the board.
 *
 * The verb is deliberately quiet: it creates the thread and stays where you
 * are. A capture happens mid-read — the agent mentioned something worth doing
 * later and you do not want to lose your place — so navigating would defeat
 * the gesture. The toast is the receipt, and its action is the way in when
 * you did mean to go now.
 *
 * The new thread is a real server thread with no turn, which is exactly what
 * the board's Draft lane holds, so a capture shows up on every device rather
 * than only the one that made it.
 *
 * @module useCaptureTask
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { buildCapturedTaskPrompt, buildCapturedTaskTitle } from "../capturedTask";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { newThreadId } from "../lib/utils";
import { readProject, readThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { buildThreadRouteParams } from "../threadRoutes";
import { useAtomCommand } from "../state/use-atom-command";

export interface CaptureTaskInput {
  /** Project the task belongs to. Captures never cross projects. */
  readonly projectRef: ScopedProjectRef;
  /** The passage being captured, verbatim. */
  readonly passage: string;
  /**
   * Thread the passage came from, used only to carry the working mode
   * (model, runtime mode, interaction mode) onto the task. Absent falls back
   * to the project's defaults.
   */
  readonly sourceThreadRef?: ScopedThreadRef | null;
}

/**
 * Returns a capture function, or reports why a capture could not happen.
 *
 * Resolves to the new thread's ref on success and `null` when there was
 * nothing to capture or the project could not supply a model — both of which
 * are quiet no-ops rather than errors, because the gesture is cheap and a
 * dialog over a failed capture is worse than nothing happening.
 */
export function useCaptureTask() {
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const router = useRouter();

  return useCallback(
    async ({
      projectRef,
      passage,
      sourceThreadRef,
    }: CaptureTaskInput): Promise<ScopedThreadRef | null> => {
      const prompt = buildCapturedTaskPrompt(passage);
      if (prompt === null) return null;

      const project = readProject(projectRef);
      const sourceThread = sourceThreadRef ? readThreadShell(sourceThreadRef) : null;
      // A task inherits how you are working, not where: the parent's worktree
      // may well be gone by the time anyone runs this, so the thread starts
      // with no checkout and picks up the project's default when it does run.
      const modelSelection: ModelSelection | null =
        sourceThread?.modelSelection ?? project?.defaultModelSelection ?? null;
      if (modelSelection === null) return null;

      const threadId = newThreadId();
      const title = buildCapturedTaskTitle(prompt);
      const result = await createThread({
        environmentId: projectRef.environmentId,
        input: {
          threadId,
          projectId: projectRef.projectId,
          title,
          modelSelection,
          runtimeMode: sourceThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          interactionMode: sourceThread?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          queuedPrompt: prompt,
        },
      });

      if (result._tag === "Failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not capture that",
            description: "The task was not created. Try again.",
          }),
        );
        return null;
      }

      const threadRef = scopeThreadRef(projectRef.environmentId, threadId);
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: "Captured as a task",
          description: title,
          actionProps: {
            children: "Open",
            onClick: () => {
              void router.navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(threadRef),
              });
            },
          },
        }),
      );
      return threadRef;
    },
    [createThread, router],
  );
}

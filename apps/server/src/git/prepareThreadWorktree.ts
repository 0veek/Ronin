/**
 * Creating the worktree a thread will run in.
 *
 * Extracted from the WebSocket turn-start bootstrap so the scheduler can make
 * a worktree the same way a client does. There is exactly one correct order
 * here — decide whether origin is usable, fetch it, resolve the remote tip,
 * then branch from whichever ref won — and having it written twice is how the
 * two paths drift until only one of them honours "start from origin".
 *
 * @module prepareThreadWorktree
 */
import type { GitCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { GitWorkflowService } from "./GitWorkflowService.ts";

export interface PreparedThreadWorktree {
  readonly path: string;
  readonly refName: string;
}

/**
 * Create a worktree for `branch`, based on `baseBranch`.
 *
 * `startFromOrigin` is a preference, not a promise: a repository with no
 * origin remote, or whose base branch has never been pushed, falls back to the
 * local base branch rather than failing the whole thread on `git fetch origin`
 * or on an unresolvable remote-tracking ref.
 */
export const prepareThreadWorktree = ({
  gitWorkflow,
  projectCwd,
  baseBranch,
  branch,
  startFromOrigin,
}: {
  readonly gitWorkflow: GitWorkflowService["Service"];
  readonly projectCwd: string;
  readonly baseBranch: string;
  /** Name for the new branch. Absent lets the VCS driver pick one. */
  readonly branch: string | undefined;
  readonly startFromOrigin: boolean;
}): Effect.Effect<PreparedThreadWorktree, GitCommandError> =>
  Effect.gen(function* () {
    let worktreeBaseRef = baseBranch;
    const useOrigin =
      startFromOrigin &&
      (yield* gitWorkflow.remoteExists({ cwd: projectCwd, remoteName: "origin" }));
    if (useOrigin) {
      yield* gitWorkflow.fetchRemote({ cwd: projectCwd, remoteName: "origin" });
      const remoteBaseExists = yield* gitWorkflow.remoteBranchExists({
        cwd: projectCwd,
        refName: baseBranch,
        remoteName: "origin",
      });
      if (remoteBaseExists) {
        const resolvedRemoteBase = yield* gitWorkflow.resolveRemoteTrackingCommit({
          cwd: projectCwd,
          refName: baseBranch,
          fallbackRemoteName: "origin",
        });
        worktreeBaseRef = resolvedRemoteBase.commitSha;
      }
    }
    const created = yield* gitWorkflow.createWorktree({
      cwd: projectCwd,
      refName: worktreeBaseRef,
      ...(branch === undefined ? {} : { newRefName: branch }),
      baseRefName: baseBranch,
      path: null,
    });
    return { path: created.worktree.path, refName: created.worktree.refName };
  });

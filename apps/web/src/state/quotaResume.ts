/**
 * Turns parked waiting for a subscription window to reset.
 *
 * Scoped to the primary environment for the same reason quota itself is: a
 * parked turn belongs to one machine's provider account, and merging two
 * environments' lists would show a countdown the local composer cannot act on.
 *
 * @module state/quotaResume
 */
import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import type { EnvironmentId, QuotaResume, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useCallback, useEffect } from "react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { usePrimaryEnvironmentId } from "./environments";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

const EMPTY: ReadonlyArray<QuotaResume> = [];

const quotaResumesAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<QuotaResume> => {
    const result = get(serverEnvironment.quotaResumes({ environmentId, input: {} }));
    // A failed read is indistinguishable from "nothing parked" as far as the
    // composer is concerned, and a banner that says a turn will resume when
    // the server cannot confirm it would be a lie.
    return Option.getOrNull(AsyncResult.value(result))?.resumes ?? EMPTY;
  }).pipe(Atom.withLabel(`web-quota-resumes:${environmentId}`)),
);

const emptyQuotaResumesAtom = Atom.make((): ReadonlyArray<QuotaResume> => EMPTY).pipe(
  Atom.withLabel("web-quota-resumes:none"),
);

function useQuotaResumes(): ReadonlyArray<QuotaResume> {
  const environmentId = usePrimaryEnvironmentId();
  // A stable no-op atom when there is no environment keeps hook order fixed.
  return useAtomValue(
    environmentId === null ? emptyQuotaResumesAtom : quotaResumesAtom(environmentId),
  );
}

export interface ThreadQuotaResumeControls {
  readonly resume: QuotaResume | null;
  /** Drop the parked turn and leave the failure standing. */
  readonly cancel: () => Promise<void>;
  /** Send the parked turn now, without waiting for the window. */
  readonly runNow: () => Promise<void>;
}

/**
 * The parked turn for one thread, if any, plus the two things a user can do
 * about it.
 *
 * Both actions refresh the list rather than waiting for the poll: the banner
 * disappearing is the confirmation that the click worked, and up to fifteen
 * seconds of a stale countdown after a cancel reads as a broken button.
 */
export function useThreadQuotaResume(
  threadId: ThreadId | null,
  /**
   * Changes whenever this thread's session lands in `error`. That is the exact
   * moment the server may have parked a turn, so it is the moment worth
   * re-reading — the background poll is a slow backstop, not the mechanism.
   * Null while the session is healthy.
   */
  sessionFailureKey: string | null = null,
): ThreadQuotaResumeControls {
  const environmentId = usePrimaryEnvironmentId();
  const resumes = useQuotaResumes();
  const refresh = useAtomRefresh(
    environmentId === null ? emptyQuotaResumesAtom : quotaResumesAtom(environmentId),
  );
  const cancelCommand = useAtomCommand(serverEnvironment.cancelQuotaResume, "quota resume cancel");
  const runNowCommand = useAtomCommand(serverEnvironment.runQuotaResumeNow, "quota resume run now");

  const resume =
    threadId === null ? null : (resumes.find((row) => row.threadId === threadId) ?? null);

  useEffect(() => {
    if (sessionFailureKey === null || threadId === null) return;
    // The park happens server-side just after the failure reaches us, so one
    // immediate read can still lose the race. A single short retry covers it
    // without reintroducing a fast poll.
    refresh();
    const retry = setTimeout(refresh, 1_500);
    return () => clearTimeout(retry);
  }, [refresh, sessionFailureKey, threadId]);

  const cancel = useCallback(async () => {
    if (environmentId === null || threadId === null) return;
    await cancelCommand({ environmentId, input: { threadId } });
    refresh();
  }, [cancelCommand, environmentId, refresh, threadId]);

  const runNow = useCallback(async () => {
    if (environmentId === null || threadId === null) return;
    await runNowCommand({ environmentId, input: { threadId } });
    refresh();
  }, [environmentId, refresh, runNowCommand, threadId]);

  return { resume, cancel, runNow };
}

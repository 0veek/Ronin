import { guidePresentation } from "./guide/guidePresentation";
import { useGuideCommenting } from "./guide/useGuideCommenting";
import type { EnvironmentId, PullRequestRef, PullRequestReviewGuideStop } from "@t3tools/contracts";
import { SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useEffectEvent } from "react";

import type { ReviewCommentContext } from "~/reviewCommentContext";

import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { guideRunKey, useGuideRunStore } from "./guide/guideRunStore";
import { GuideProseContext } from "./guide/guideProseContext";
import { GuideTour } from "./guide/GuideTour";
import { useReviewGuideWriter } from "./guide/useReviewGuideWriter";

/**
 * A maintainer's tour of the pull request: stops through the diff in reading order with the
 * calls only a person can make. Generated on request and stored, so opening the tab is free.
 * Rewriting a current guide lives in the header menu; the tab only asks when it has a reason.
 */
export function PullRequestGuideTab({
  environmentId,
  reference,
  title,
  workspaceRoot,
  active,
  canComment,
  onAskAboutLines,
  onAskAboutStop,
  onFinishReview,
  onOpenFile,
  onTourShown,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** The pull request's title for the notice when a guide is ready, null until the detail loads. */
  title: string | null;
  /** The checkout the guide's prose renders against, as the description does. */
  workspaceRoot: string;
  /** Whether this is the tab on screen. */
  active: boolean;
  /** Whether this reader may queue line comments for a review on this host. */
  canComment: boolean;
  /** Opens an agent thread about lines of the change. Null where no thread can be opened. */
  onAskAboutLines: ((comment: ReviewCommentContext, request: string) => void) | null;
  onAskAboutStop:
    | ((stop: PullRequestReviewGuideStop, index: number, question: string) => void)
    | null;
  /** Opens the review composer with the comments queued so far. Null where the reader cannot review. */
  onFinishReview: (() => void) | null;
  /** Shows a file in the Code tab. */
  onOpenFile: (path: string) => void;
  /** Told when a written guide comes on screen; a run in progress is not one. */
  onTourShown?: (() => void) | undefined;
}) {
  const { query, data, running, canWrite, write } = useReviewGuideWriter({
    environmentId,
    reference,
    title,
  });
  const runKey = guideRunKey(environmentId, reference);
  const commenting = useGuideCommenting(reference, canComment, onAskAboutLines);
  useEffect(() => {
    if (!active) return;
    useGuideRunStore.getState().setShown(runKey);
    return () => {
      if (useGuideRunStore.getState().shownKey === runKey)
        useGuideRunStore.getState().setShown(null);
    };
  }, [active, runKey]);

  const { guide, notice, showCode, failure } = guidePresentation(data);
  const tourShown = active && guide !== null;
  const reportTourShown = useEffectEvent(() => onTourShown?.());
  useEffect(() => {
    if (tourShown) reportTourShown();
  }, [tourShown]);
  if (guide === null)
    return (
      <EmptyGuide
        pending={query.isPending && data === null}
        running={running}
        error={failure ?? query.error}
        canWrite={canWrite}
        write={write}
      />
    );
  const banner = (
    <GuideStatusBanner
      notice={notice}
      running={running}
      failure={failure}
      canWrite={canWrite}
      write={write}
    />
  );

  return (
    <GuideProseContext value={{ environmentId, cwd: workspaceRoot }}>
      <GuideTour
        environmentId={environmentId}
        reference={reference}
        guide={guide}
        banner={banner}
        active={active}
        showCode={showCode}
        commenting={showCode ? commenting : null}
        onAsk={
          onAskAboutStop === null || !showCode
            ? null
            : (index, question) => {
                const stop = guide.stops[index];
                if (stop !== undefined) onAskAboutStop(stop, index, question);
              }
        }
        onFinish={onFinishReview}
        onOpenFile={onOpenFile}
      />
    </GuideProseContext>
  );
}

function WriteGuideButton({
  running,
  write,
  label,
}: {
  running: boolean;
  write: () => Promise<void>;
  label: string;
}) {
  return (
    <Button size="sm" variant="outline" disabled={running} onClick={() => void write()}>
      {running ? <Spinner /> : <SparklesIcon aria-hidden className="size-3.5" />}
      {running ? "Reading the change..." : label}
    </Button>
  );
}

function EmptyGuide({
  pending,
  running,
  error,
  canWrite,
  write,
}: {
  pending: boolean;
  running: boolean;
  error: string | null;
  canWrite: boolean;
  write: () => Promise<void>;
}) {
  if (pending)
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Spinner />
      </div>
    );
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <p className="text-sm font-medium text-foreground">
        {running ? "Writing a review guide" : "No review guide yet"}
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        {error ??
          (running
            ? "An agent is reading the change. A large one takes a few minutes. You can leave; you will be told when it is ready."
            : "A guide is a tour of the change: stops through the code in reading order, with the calls only a maintainer can make.")}
      </p>
      {canWrite ? (
        <WriteGuideButton
          running={running}
          write={write}
          label={error === null ? "Write guide" : "Try again"}
        />
      ) : null}
    </div>
  );
}

function GuideStatusBanner({
  notice,
  running,
  failure,
  canWrite,
  write,
}: {
  notice: string | null;
  running: boolean;
  failure: string | null;
  canWrite: boolean;
  write: () => Promise<void>;
}) {
  if (notice === null && failure === null && !running) return null;
  return (
    <Alert variant={running ? "info" : "warning"}>
      {running ? <Spinner /> : <TriangleAlertIcon />}
      <AlertDescription>
        {running
          ? "Rewriting this guide. You will be told when the new one is ready."
          : (failure ?? notice)}
      </AlertDescription>
      {!running && canWrite ? (
        <AlertAction>
          <WriteGuideButton running={running} write={write} label="Rewrite" />
        </AlertAction>
      ) : null}
    </Alert>
  );
}

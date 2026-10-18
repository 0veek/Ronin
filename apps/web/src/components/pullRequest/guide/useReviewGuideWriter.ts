import { useEnvironmentSettings } from "~/hooks/useSettings";
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { toastManager } from "../../ui/toast";
import { readableFailure } from "../pullRequestDetail.logic";
import { guideRunKey, useGuideRunStore } from "./guideRunStore";

/**
 * A pull request's stored guide and the way to write a new one, shared by the Guide tab and the
 * header menu. Starting a run hands it to the run coordinator, which re-reads it until it ends
 * and says so if the reader is not looking at the guide.
 */
export function useReviewGuideWriter({
  environmentId,
  reference,
  title,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** The pull request's title for the notice when the guide is ready. */
  title: string | null;
}) {
  const enabled = useEnvironmentSettings(environmentId, (settings) => settings.reviewGuidesEnabled);
  const query = useEnvironmentQuery(
    enabled ? pullRequestEnvironment.reviewGuide({ environmentId, input: reference }) : null,
  );
  const permitted = useAtomValue(
    pullRequestEnvironment.generateReviewGuide.permissionAtom(environmentId),
  );
  const canWrite = enabled && permitted;
  const generate = useAtomCommand(pullRequestEnvironment.generateReviewGuide, {
    reportFailure: false,
  });
  const key = guideRunKey(environmentId, reference);
  const pending = useRef(new Set<string>());
  const [startingKeys, setStartingKeys] = useState<ReadonlySet<string>>(new Set());
  const starting = startingKeys.has(key);
  const data = query.data;
  const running = starting || data?.run?._tag === "Running";

  const watchRun = useEffectEvent(() =>
    useGuideRunStore.getState().watch({
      environmentId,
      reference,
      title,
      previousGuideAt: data?.guide?.generatedAt ?? null,
      previousFailedAt: data?.run?._tag === "Failed" ? data.run.failedAt : null,
      since: Date.now(),
    }),
  );
  // A run started elsewhere, or before a reload, is watched as soon as it is seen.
  useEffect(() => {
    if (data?.run?._tag === "Running") watchRun();
  }, [data?.run?._tag]);

  const write = async () => {
    if (!canWrite || running || pending.current.has(key)) return;
    pending.current.add(key);
    setStartingKeys(new Set(pending.current));
    watchRun();
    let failure: unknown;
    let failed = false;
    try {
      const result = await generate({ environmentId, input: reference });
      if (result._tag === "Failure") {
        failed = true;
        failure = squashAtomCommandFailure(result);
      }
    } catch (error) {
      failed = true;
      failure = error;
    }
    pending.current.delete(key);
    setStartingKeys(new Set(pending.current));
    if (failed) {
      useGuideRunStore.getState().settle(key);
      toastManager.add({
        type: "error",
        title: "Could not start a review guide",
        description: readableFailure(
          failure,
          "Check the review guide model in Settings → Source Control.",
        ),
      });
    }
  };

  return { query, data, running, canWrite, write };
}

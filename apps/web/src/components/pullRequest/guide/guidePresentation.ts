import type { PullRequestReviewGuideResult } from "@t3tools/contracts";

/** A saved tour's line references are useful only while its head is still current. */
export function guidePresentation(data: PullRequestReviewGuideResult | null) {
  const guide = data?.guide ?? null;
  const currentHeadSha = data?.currentHeadSha ?? null;
  const run = data?.run;
  return {
    guide,
    notice:
      guide === null
        ? null
        : currentHeadSha === null
          ? "The current head could not be verified. Excerpts and line comments stay hidden until it can be checked."
          : guide.headSha !== currentHeadSha
            ? "Written before the latest push. Excerpts and line comments stay hidden until this guide is rewritten."
            : null,
    stale: guide !== null && currentHeadSha !== null && guide.headSha !== currentHeadSha,
    showCode: guide !== null && currentHeadSha === guide.headSha,
    failure: run?._tag === "Failed" && run.headSha === currentHeadSha ? run.detail : null,
  };
}

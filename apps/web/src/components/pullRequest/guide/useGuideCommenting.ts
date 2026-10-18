import type { PullRequestRef } from "@t3tools/contracts";
import { useMemo } from "react";
import type { ReviewCommentContext } from "~/reviewCommentContext";
import type { ExcerptCommenting } from "./GuideExcerpt";
import {
  nextPendingReviewCommentId,
  pullRequestReviewKey,
  usePendingReviewComments,
  usePullRequestReviewStore,
} from "../pullRequestReviewStore";

export function useGuideCommenting(
  reference: PullRequestRef,
  canComment: boolean,
  onAskAboutLines: ((comment: ReviewCommentContext, request: string) => void) | null,
) {
  // Line comments join the review the Code tab collects, so either place shows and sends them.
  const reviewKey = pullRequestReviewKey(reference);
  const pending = usePendingReviewComments(reference);
  const addComment = usePullRequestReviewStore((store) => store.addComment);
  const removeComment = usePullRequestReviewStore((store) => store.removeComment);
  const commenting = useMemo<ExcerptCommenting | null>(
    () =>
      !canComment && onAskAboutLines === null
        ? null
        : {
            canComment,
            pending,
            onComment: ({ path, oldPath, position, body }) =>
              addComment(reviewKey, {
                id: nextPendingReviewCommentId(),
                path,
                ...(oldPath === null ? {} : { oldPath }),
                position,
                body,
              }),
            onRemove: (commentId) => removeComment(reviewKey, commentId),
            onAskAgent: onAskAboutLines,
          },
    [addComment, canComment, onAskAboutLines, pending, removeComment, reviewKey],
  );
  return commenting;
}

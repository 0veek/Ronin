import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  type PullRequestReviewGuide,
  type PullRequestReviewGuideResult,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { guidePresentation } from "./guidePresentation";

const guide: PullRequestReviewGuide = {
  headSha: "old",
  generatedAt: "2026-10-18T00:00:00.000Z",
  stops: [],
  modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4"),
};
const result: PullRequestReviewGuideResult = { guide, run: null, currentHeadSha: "old" };
describe("guide line reference validity", () => {
  it("shows excerpts only for a verified matching head", () => {
    expect(guidePresentation(result).showCode).toBe(true);
    expect(guidePresentation({ ...result, currentHeadSha: "new" })).toMatchObject({
      guide,
      stale: true,
      showCode: false,
    });
    expect(guidePresentation({ ...result, currentHeadSha: null })).toMatchObject({
      guide,
      showCode: false,
    });
    expect(guidePresentation(null).showCode).toBe(false);
  });
  it("leaves a saved guide readable when rewriting fails, without leaking failures from another head", () => {
    const failed = {
      _tag: "Failed" as const,
      headSha: "old",
      failedAt: "2026-10-18T00:00:00.000Z",
      detail: "Model unavailable",
    };
    expect(guidePresentation({ ...result, run: failed })).toMatchObject({
      guide,
      failure: "Model unavailable",
      showCode: true,
    });
    expect(guidePresentation({ ...result, currentHeadSha: "new", run: failed })).toMatchObject({
      guide,
      failure: null,
      showCode: false,
    });
  });
});

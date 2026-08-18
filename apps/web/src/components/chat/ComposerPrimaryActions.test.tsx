import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const stageArtworkState = vi.hoisted(() => ({
  mode: "none" as "artwork" | "none",
  variant: null as "nightly" | "dev" | null,
}));

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => stageArtworkState.mode,
  // The send button now shares its row with the dictation control, which
  // reads this. Off here so these cases stay about the send button.
  useSpeechToTextEnabled: () => false,
}));
vi.mock("./ComposerDictationControl", () => ({
  ComposerDictationControl: () => "dictation-control",
}));
vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: ({ variant }: { variant: string }) => `stage-${variant}`,
  useSidebarStageBackdropVariant: (enabled = true) => (enabled ? stageArtworkState.variant : null),
}));

import { ComposerPrimaryActions, formatPendingPrimaryActionLabel } from "./ComposerPrimaryActions";

function renderPendingActions(isRunning: boolean) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      pendingAction: {
        questionIndex: 0,
        isLastQuestion: true,
        canAdvance: true,
        isResponding: false,
        isComplete: true,
      },
      isRunning,
      showPlanFollowUpPrompt: false,
      promptHasText: false,
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: false,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      onImplementPlanInNewThread: () => {},
    }),
  );
}

/** The ordinary composer state: nothing pending, nothing running. */
function renderSendRow() {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: false,
      pendingAction: null,
      isRunning: false,
      showPlanFollowUpPrompt: false,
      promptHasText: true,
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: true,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      onImplementPlanInNewThread: () => {},
    }),
  );
}

/** The send row with the second-opinion verb wired in. */
function renderSecondOpinionRow(overrides: {
  readonly promptHasText: boolean;
  readonly isRunning?: boolean;
}) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: false,
      pendingAction: null,
      isRunning: overrides.isRunning ?? false,
      showPlanFollowUpPrompt: false,
      promptHasText: overrides.promptHasText,
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: overrides.promptHasText,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      onImplementPlanInNewThread: () => {},
      onSecondOpinion: () => {},
    }),
  );
}

function renderStandaloneStop() {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      pendingAction: null,
      isRunning: true,
      showPlanFollowUpPrompt: false,
      promptHasText: false,
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: false,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      onImplementPlanInNewThread: () => {},
    }),
  );
}

function renderRunningActions(showSendWhileRunning: boolean, hasSendableContent: boolean) {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      pendingAction: null,
      isRunning: true,
      showPlanFollowUpPrompt: false,
      promptHasText: hasSendableContent,
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent,
      showSendWhileRunning,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      onImplementPlanInNewThread: () => {},
    }),
  );
}

function renderSendButton() {
  return renderToStaticMarkup(
    createElement(ComposerPrimaryActions, {
      compact: true,
      pendingAction: null,
      isRunning: false,
      showPlanFollowUpPrompt: false,
      promptHasText: true,
      isSendBusy: false,
      sendDisabledReason: null,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isPreparingWorktree: false,
      hasSendableContent: true,
      onPreviousPendingQuestion: () => {},
      onInterrupt: () => {},
      onImplementPlanInNewThread: () => {},
    }),
  );
}

afterEach(() => {
  stageArtworkState.mode = "none";
  stageArtworkState.variant = null;
});

describe("formatPendingPrimaryActionLabel", () => {
  it("returns 'Submitting...' while responding", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: true,
        questionIndex: 0,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submitting...' while responding regardless of other flags", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: true,
        questionIndex: 3,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submit' in compact mode on the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit");
  });

  it("returns 'Next' in compact mode when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Next");
  });

  it("returns 'Next question' when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Next question");
  });

  it("returns singular 'Submit answer' on the last question when it is the only question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit answer");
  });

  it("returns plural 'Submit answers' on the last question when there are multiple questions", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Submit answers");
  });

  it("returns plural 'Submit answers' for higher question indices", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 5,
      }),
    ).toBe("Submit answers");
  });
});

describe("ComposerPrimaryActions", () => {
  it("offers Stop generation while a running turn is waiting for user input", () => {
    expect(renderPendingActions(true)).toContain('aria-label="Stop generation"');
  });

  it("does not offer Stop generation for a pending request without a running turn", () => {
    expect(renderPendingActions(false)).not.toContain('aria-label="Stop generation"');
  });

  it("matches the small pending action size without changing the standalone size", () => {
    expect(renderPendingActions(true)).toContain("size-8 sm:size-7");
    expect(renderStandaloneStop()).toContain("size-8 sm:h-8 sm:w-8");
    expect(renderStandaloneStop()).not.toContain("sm:size-7");
  });

  it("renders stage artwork inside the send button when artwork identification is active", () => {
    stageArtworkState.mode = "artwork";
    stageArtworkState.variant = "nightly";

    const markup = renderSendButton();

    expect(markup).toContain("stage-nightly");
    expect(markup).toContain("bg-transparent text-white");
    expect(markup).not.toContain("bg-message-action text-message-action-foreground");
  });

  it("keeps the normal send-button fill when artwork identification is inactive", () => {
    stageArtworkState.variant = "nightly";

    const markup = renderSendButton();

    expect(markup).not.toContain("stage-nightly");
    expect(markup).toContain("bg-message-action text-message-action-foreground");
  });

  it("only renders stop while running when Enter-to-send is available", () => {
    const markup = renderRunningActions(false, true);

    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).not.toContain('aria-label="Send message"');
  });

  it("renders send alongside stop while running when Enter-to-send is unavailable", () => {
    const markup = renderRunningActions(true, true);

    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).toContain('aria-label="Send message"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain("size-9 sm:size-8");
  });

  it("keeps stop as the only primary action while running with an empty composer", () => {
    const markup = renderRunningActions(true, false);

    expect(markup).toContain('aria-label="Stop generation"');
    expect(markup).not.toContain('aria-label="Send message"');
  });
});

describe("ComposerPrimaryActions dictation placement", () => {
  it("puts the mic immediately before the send button", () => {
    // The pair reads as one row of controls, so the mic has to precede the
    // submit button rather than sit down in the context strip.
    const markup = renderSendRow();

    const mic = markup.indexOf("dictation-control");
    const send = markup.indexOf('type="submit"');
    expect(mic).toBeGreaterThanOrEqual(0);
    expect(send).toBeGreaterThan(mic);
  });

  it("keeps the mic through a running turn", () => {
    // Regression: the mic used to live in the composer context strip, which
    // renders whatever the thread is doing. Moving it into this row put it in
    // the not-running branch only, so it vanished the moment work started —
    // exactly when someone is dictating the next message.
    for (const markup of [
      renderRunningActions(false, true),
      renderRunningActions(true, true),
      renderRunningActions(true, false),
      renderStandaloneStop(),
    ]) {
      expect(markup).toContain("dictation-control");
    }
  });

  it("puts the mic before stop, the way it precedes send when idle", () => {
    const markup = renderRunningActions(false, true);

    const mic = markup.indexOf("dictation-control");
    const stop = markup.indexOf('aria-label="Stop generation"');
    expect(mic).toBeGreaterThanOrEqual(0);
    expect(stop).toBeGreaterThan(mic);
  });

  it("gives the mic the send button's footprint", () => {
    // Same height and width so neither reads as the smaller sibling; the
    // send button stays the filled one.
    const markup = renderSendRow();

    expect(markup).toContain("h-9 w-9");
    expect(markup).toContain("sm:h-8 sm:w-8");
  });
});

describe("second opinion", () => {
  it("offers the verb once there is a prompt to race", () => {
    expect(renderSecondOpinionRow({ promptHasText: true })).toContain(
      'aria-label="Get a second opinion"',
    );
  });

  it("stays out of an empty composer, which has nothing to compare", () => {
    expect(renderSecondOpinionRow({ promptHasText: false })).not.toContain(
      'aria-label="Get a second opinion"',
    );
  });

  it("is absent while a turn runs, when the row is for stopping", () => {
    expect(renderSecondOpinionRow({ promptHasText: true, isRunning: true })).not.toContain(
      'aria-label="Get a second opinion"',
    );
  });

  it("stays out of surfaces that never pass the verb", () => {
    // The pending-answer rows render the same component with no prompt of
    // their own; a compare button there would act on nothing.
    expect(renderSendRow()).not.toContain('aria-label="Get a second opinion"');
  });

  it("sits ahead of the mic and send, reading left to right as widening reach", () => {
    const markup = renderSecondOpinionRow({ promptHasText: true });

    const compare = markup.indexOf('aria-label="Get a second opinion"');
    const mic = markup.indexOf("dictation-control");
    const send = markup.indexOf('type="submit"');
    expect(compare).toBeGreaterThanOrEqual(0);
    expect(mic).toBeGreaterThan(compare);
    expect(send).toBeGreaterThan(mic);
  });
});

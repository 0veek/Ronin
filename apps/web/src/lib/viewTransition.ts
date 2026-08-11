/**
 * Thin wrapper over the View Transitions API for shell-level surface swaps.
 *
 * The pattern every caller follows: set a `data-*` flag on <html> for the
 * duration of the transition, so the CSS in `styles/motion.css` can scope its
 * `::view-transition-*` rules to this transition and leave every other one
 * alone. Without the flag a single global `::view-transition-old(root)` rule
 * would fire on unrelated navigations too.
 *
 * Falls back to running the update directly — synchronously in the same task —
 * when the engine has no View Transitions support or the user has asked for
 * reduced motion. Callers never need to branch on either.
 */

export const PANEL_SURFACE_VIEW_TRANSITION_NAME = "t3-panel-surface";

type ViewTransition = {
  readonly finished: Promise<void>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransition;
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export interface ViewTransitionOptions {
  /**
   * The `data-*` attribute (camelCase dataset key) set on <html> while the
   * transition runs. Scopes the matching CSS to this transition only.
   */
  readonly flag: string;
  /** Skip the transition and just run the update — e.g. a viewport gate. */
  readonly enabled?: boolean;
}

/**
 * Run `update` inside a scoped view transition. Resolves once the animation has
 * finished, or immediately after the update when the transition is skipped.
 *
 * The update is guarded so it runs exactly once even if the browser rejects the
 * transition partway through; a failed transition still applies the change.
 */
export async function runViewTransition(
  update: () => void | Promise<void>,
  options: ViewTransitionOptions,
): Promise<void> {
  const transitionDocument =
    typeof document === "undefined" ? null : (document as ViewTransitionDocument);
  if (
    transitionDocument === null ||
    options.enabled === false ||
    prefersReducedMotion() ||
    !transitionDocument.startViewTransition
  ) {
    await update();
    return;
  }

  let updateStarted = false;
  const runUpdate = async () => {
    if (updateStarted) return;
    updateStarted = true;
    await update();
  };

  transitionDocument.documentElement.dataset[options.flag] = "true";
  try {
    const transition = transitionDocument.startViewTransition(runUpdate);
    try {
      await transition.finished;
    } catch {
      // A cancelled or superseded transition still owes the caller the update.
      await runUpdate();
    }
  } catch {
    await runUpdate();
  } finally {
    delete transitionDocument.documentElement.dataset[options.flag];
  }
}

/**
 * The right panel swapping which surface it shows (diff, preview, terminal,
 * …). The frame holds still; only its contents cross over.
 */
export function runPanelSurfaceTransition(update: () => void | Promise<void>): Promise<void> {
  return runViewTransition(update, { flag: "panelSurfaceTransition" });
}

import { runViewTransition } from "~/lib/viewTransition";

export const DRAFT_HERO_TRANSITION_ANIMATION_ID = "t3-draft-hero-transition";
export const DRAFT_HERO_TRANSITION_DURATION_MS = 180;
export const DRAFT_HERO_TRANSITION_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
export const MOBILE_COMPOSER_VIEW_TRANSITION_NAME = "t3-mobile-composer";
export const MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME = "t3-mobile-draft-headline";

let activeMobileComposerTransition: Promise<void> | null = null;

export async function waitForDraftHeroTransition(): Promise<void> {
  const mobileComposerTransition = activeMobileComposerTransition;
  if (typeof document === "undefined" || typeof document.getAnimations !== "function") {
    await mobileComposerTransition;
    return;
  }

  const activeTransitions = document
    .getAnimations()
    .filter((animation) => animation.id === DRAFT_HERO_TRANSITION_ANIMATION_ID);

  await Promise.all([
    mobileComposerTransition,
    ...activeTransitions.map(async (animation) => {
      try {
        await animation.finished;
      } catch {
        // A cancelled transition is already safe to hand off.
      }
    }),
  ]);
}

export async function runMobileComposerTransition(
  update: () => void | Promise<void>,
): Promise<void> {
  // The morph only exists on mobile, where the hero and docked composers are
  // two different layouts of the same element. On desktop both are on screen in
  // their final positions already, so there is nothing to morph between.
  const mobileViewport =
    typeof window === "undefined"
      ? false
      : (window.matchMedia?.("(max-width: 639px)").matches ?? false);

  const running = runViewTransition(update, {
    flag: "mobileComposerRouteTransition",
    enabled: mobileViewport,
  });
  // Handed to waitForDraftHeroTransition, which only cares that the animation
  // has settled -- a failed update is the caller's problem, not the waiter's.
  const settled = running.catch(() => undefined);
  activeMobileComposerTransition = settled;
  try {
    await running;
  } finally {
    if (activeMobileComposerTransition === settled) {
      activeMobileComposerTransition = null;
    }
  }
}

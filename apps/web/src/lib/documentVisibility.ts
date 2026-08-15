const HIDDEN_CLASS_NAME = "window-hidden";

/**
 * Marks the document while the window is not showing, so looping animations
 * can park themselves in CSS instead of repainting behind another window.
 *
 * A class on the root rather than React state on purpose: the surfaces that
 * loop (the sidebar working duel, the chat working glyph) are per-thread and
 * can be on screen many at a time, and re-rendering every one of them on a tab
 * switch costs more than the frames it saves. One listener, one class toggle,
 * and `animation-play-state` does the rest on the compositor.
 */
export function syncDocumentVisibilityClass(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const update = () => {
    document.documentElement.classList.toggle(
      HIDDEN_CLASS_NAME,
      document.visibilityState !== "visible",
    );
  };

  update();
  document.addEventListener("visibilitychange", update);
  return () => {
    document.removeEventListener("visibilitychange", update);
  };
}

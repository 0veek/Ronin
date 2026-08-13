import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import {
  diffAgentAttention,
  summarizeAttention,
  type AgentAttentionEvent,
  type ThreadAttentionBaseline,
} from "../lib/agentAttentionNotifications";
import { useThreadShells } from "../state/entities";
import { useUiStateStore } from "../uiStateStore";

/**
 * System notifications for agents that finished, failed, or stopped to ask.
 *
 * Headless; mounted once in the authenticated shell. Watches every connected
 * environment's thread shells and raises an OS notification when a turn
 * settles or an approval appears while Ronin is in the background. Clicking
 * one brings the window back (natively on desktop, via the opener in a
 * browser) and lands on the thread that asked.
 *
 * Renderer-side on purpose: the same `Notification` call is native toast in
 * the Electron shell and a browser notification on a paired phone or laptop,
 * so every client of an environment gets the feature from one implementation.
 */
export function AgentAttentionNotifier() {
  const shells = useThreadShells();
  const enabled = useUiStateStore((state) => state.agentNotificationsEnabled);
  const navigate = useNavigate();
  const baselineRef = useRef<ThreadAttentionBaseline | null>(null);
  const openRef = useRef<readonly Notification[]>([]);

  useEffect(() => {
    const { events, baseline } = diffAgentAttention(baselineRef.current, shells);
    // The baseline advances even while disabled or focused, so flipping the
    // toggle (or tabbing back in) never replays transitions already seen.
    baselineRef.current = baseline;

    if (events.length === 0) return;
    if (!enabled) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // Attention is only worth stealing while the user is elsewhere. In view,
    // the sidebar's own working indicators already tell this story.
    if (document.visibilityState === "visible" && document.hasFocus()) return;

    const reveal = (event?: AgentAttentionEvent) => {
      window.focus();
      void window.desktopBridge?.focusWindow?.();
      if (event !== undefined) {
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: event.environmentId, threadId: event.threadId },
        });
      }
    };

    const summary = summarizeAttention(events);
    const raised: Notification[] = [];
    if (summary !== null) {
      const notification = new Notification(summary.title, {
        body: summary.body,
        tag: summary.tag,
      });
      notification.addEventListener("click", () => {
        reveal();
        notification.close();
      });
      raised.push(notification);
    } else {
      for (const event of events) {
        const notification = new Notification(event.title, {
          body: event.body,
          tag: event.tag,
        });
        notification.addEventListener("click", () => {
          reveal(event);
          notification.close();
        });
        raised.push(notification);
      }
    }
    openRef.current = [...openRef.current, ...raised];
  }, [enabled, navigate, shells]);

  // Coming back on your own settles the debt: anything still sitting in the
  // notification tray is now stale chrome, so it is withdrawn.
  useEffect(() => {
    const dismissAll = () => {
      if (document.visibilityState !== "visible") return;
      for (const notification of openRef.current) notification.close();
      openRef.current = [];
    };
    document.addEventListener("visibilitychange", dismissAll);
    window.addEventListener("focus", dismissAll);
    return () => {
      document.removeEventListener("visibilitychange", dismissAll);
      window.removeEventListener("focus", dismissAll);
    };
  }, []);

  return null;
}

/**
 * Whether this device can raise notifications at all, and how to ask.
 *
 * Kept beside the notifier so the settings toggle and the firing path agree
 * on what "available" means. In the Electron shell permission is granted from
 * the start; a remote browser has to be asked, and asking is only legal from
 * a user gesture — which the settings switch is.
 */
export async function requestAgentNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

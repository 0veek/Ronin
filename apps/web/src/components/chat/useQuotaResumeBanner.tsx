/**
 * The composer banner for a turn parked on a spent subscription window.
 *
 * The countdown is the whole point of the banner, so it has to tick — but it
 * ticks on one shared ten-second timer that only exists while a banner is on
 * screen, not a per-second repaint. Ten seconds is finer than any label the
 * countdown renders, so the clock never looks stuck, and the timer costs
 * nothing on the overwhelmingly common path where nothing is parked.
 *
 * @module useQuotaResumeBanner
 */
import type { ThreadId } from "@t3tools/contracts";
import { HourglassIcon } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";

import {
  formatQuotaResumeCountdown,
  formatQuotaResumeProvider,
  formatQuotaResumeWindow,
  QUOTA_RESUME_TICK_MS,
} from "~/quotaResumeCountdown";
import { useThreadQuotaResume } from "~/state/quotaResume";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

// One module-level timer feeds every consumer, the same way useNowMinute does,
// so two banners can never tick out of step and an unmount always stops it.
let tickNow = Date.now();
let timerId: number | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  tickNow = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    timerId = window.setInterval(tick, QUOTA_RESUME_TICK_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  };
}

function getSnapshot(): number {
  // With no timer running the cached value is arbitrarily old, so a fresh
  // mount re-reads rather than rendering a countdown from the last time a
  // banner happened to be open.
  if (timerId === null) tickNow = Date.now();
  return tickNow;
}

function useTick(active: boolean): number {
  const value = useSyncExternalStore(
    active ? subscribe : noopSubscribe,
    active ? getSnapshot : getStaticSnapshot,
    active ? getSnapshot : getStaticSnapshot,
  );
  return value;
}

const noopSubscribe = () => () => {};
const STATIC_SNAPSHOT = 0;
const getStaticSnapshot = () => STATIC_SNAPSHOT;

/**
 * Banner describing this thread's parked turn, or `null` when nothing is
 * parked.
 *
 * Deliberately an `info` banner rather than a warning: nothing is wrong and
 * nothing needs doing. The turn is simply queued.
 */
export function useQuotaResumeBanner(
  threadId: ThreadId | null,
  sessionFailureKey: string | null,
): ComposerBannerStackItem | null {
  const { resume, cancel, runNow } = useThreadQuotaResume(threadId, sessionFailureKey);
  const nowMs = useTick(resume !== null && resume.state === "scheduled");

  return useMemo<ComposerBannerStackItem | null>(() => {
    if (resume === null) return null;

    const providerLabel = formatQuotaResumeProvider(resume.provider);
    const windowLabel = formatQuotaResumeWindow(resume.windowKind);
    const limitLabel = windowLabel === null ? "limit" : windowLabel;
    const countdown =
      resume.state === "scheduled"
        ? formatQuotaResumeCountdown({ resumeAtMs: Date.parse(resume.resumeAt), nowMs })
        : null;

    const title = (() => {
      switch (resume.state) {
        case "resuming":
          return `Resuming — ${providerLabel} ${limitLabel} reset`;
        case "blocked":
          return `${providerLabel} ${limitLabel} reached`;
        case "scheduled":
          // A countdown that has run out but whose fire has not landed yet is
          // a second or two of skew, not a state worth its own wording.
          return countdown === null
            ? `Resuming — ${providerLabel} ${limitLabel} reset`
            : `${providerLabel} ${limitLabel} reached — resuming ${countdown}`;
      }
    })();

    const description = (() => {
      if (resume.state === "blocked") {
        return "The reset is further out than your maximum automatic wait, so this turn is not queued. Resume it yourself, or raise the limit in Settings.";
      }
      const base = "Your last message is queued and sends itself when the window resets.";
      return resume.attempt > 1 ? `${base} Attempt ${resume.attempt}.` : base;
    })();

    return {
      id: `quota-resume:${resume.threadId}`,
      variant: "info",
      // Fronted over the calm notices: this is the one banner that explains
      // why a thread that looks idle is going to start talking on its own.
      urgent: true,
      icon: <HourglassIcon />,
      title:
        resume.detail === null ? (
          title
        ) : (
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 truncate">{title}</span>} />
            <TooltipPopup side="top" className="max-w-96 whitespace-pre-wrap">
              {resume.detail}
            </TooltipPopup>
          </Tooltip>
        ),
      description,
      actions:
        resume.state === "resuming" ? null : (
          <>
            <Button size="xs" variant="outline" onClick={() => void runNow()}>
              Resume now
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void cancel()}>
              Cancel
            </Button>
          </>
        ),
    };
  }, [cancel, nowMs, resume, runNow]);
}

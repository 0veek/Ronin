/**
 * The turn replay: what the agent did, in order, on a clock you control.
 *
 * Playback steps on a timer rather than sweeping a playhead every frame. A
 * turn is a sequence of discrete events, so animating between them would
 * repaint continuously and tell the reader nothing the step list does not
 * already say — and a continuously repainting surface is exactly what this app
 * refuses to ship.
 *
 * @module TurnReplayDialog
 */
import { PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import {
  describeReplayStep,
  formatReplayClock,
  formatReplayGap,
  replayStepDelayMs,
  type TurnReplay,
} from "~/turnReplay";

import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";

const TONE_CLASS: Record<ReturnType<typeof describeReplayStep>["tone"], string> = {
  thinking: "text-muted-foreground",
  tool: "text-foreground",
  info: "text-foreground",
  error: "text-destructive",
};

const ACTOR_CLASS: Record<ReturnType<typeof describeReplayStep>["actor"], string> = {
  You: "bg-primary/12 text-primary",
  Agent: "bg-foreground/10 text-foreground",
  Work: "bg-muted text-muted-foreground",
};

const ReplayStepRow = memo(function ReplayStepRow({
  active,
  gapMs,
  index,
  atMs,
  step,
}: {
  readonly active: boolean;
  readonly gapMs: number;
  readonly index: number;
  readonly atMs: number;
  readonly step: TurnReplay["steps"][number];
}) {
  const description = describeReplayStep(step.entry);
  const gapLabel = formatReplayGap(gapMs);
  return (
    <li
      className={cn(
        "rounded-md border border-transparent px-2 py-1.5 transition-colors",
        active && "border-border bg-accent/60",
      )}
      data-replay-step={index}
    >
      {gapLabel === null ? null : (
        <p className="mb-1 text-2xs text-muted-foreground/70">waited {gapLabel}</p>
      )}
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            "shrink-0 rounded-sm px-1 py-px text-2xs font-medium",
            ACTOR_CLASS[description.actor],
          )}
        >
          {description.actor}
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-sm", TONE_CLASS[description.tone])}>
          {description.label}
        </span>
        <span className="shrink-0 tabular-nums text-2xs text-muted-foreground/70">
          {formatReplayClock(atMs)}
        </span>
      </div>
      {description.detail === null ? null : (
        <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
          {description.detail}
        </p>
      )}
    </li>
  );
});

export function TurnReplayDialog({
  onOpenChange,
  open,
  replay,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly replay: TurnReplay | null;
}) {
  const stepCount = replay?.steps.length ?? 0;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  // Opening is what arms a replay: it starts at the beginning and plays, which
  // is what "replay" promises. Closing stops the timer with it.
  useEffect(() => {
    if (!open) {
      setPlaying(false);
      return;
    }
    setIndex(0);
    setPlaying(stepCount > 1);
  }, [open, replay?.turnId, stepCount]);

  useEffect(() => {
    if (!playing || replay === null) return;
    if (index >= stepCount - 1) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setIndex((current) => current + 1),
      replayStepDelayMs(replay, index),
    );
    return () => clearTimeout(timer);
  }, [index, playing, replay, stepCount]);

  // Follow the revealed step, but only while playing: scrolling under someone
  // who is dragging the scrubber fights them for control of the list.
  useEffect(() => {
    if (!playing) return;
    listRef.current
      ?.querySelector(`[data-replay-step="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index, playing]);

  const revealed = useMemo(
    () => (replay === null ? [] : replay.steps.slice(0, index + 1)),
    [index, replay],
  );

  const restart = useCallback(() => {
    setIndex(0);
    setPlaying(true);
  }, []);

  if (replay === null) return null;
  const atEnd = index >= stepCount - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Replay this turn</DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              aria-label={atEnd ? "Replay from the start" : playing ? "Pause" : "Play"}
              onClick={() => (atEnd ? restart() : setPlaying((current) => !current))}
            >
              {atEnd ? (
                <RotateCcwIcon className="size-3.5" />
              ) : playing ? (
                <PauseIcon className="size-3.5" />
              ) : (
                <PlayIcon className="size-3.5" />
              )}
            </Button>
            <input
              type="range"
              className="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
              min={0}
              max={Math.max(stepCount - 1, 0)}
              step={1}
              value={index}
              aria-label="Replay position"
              aria-valuetext={`Step ${index + 1} of ${stepCount}`}
              onChange={(event) => {
                setPlaying(false);
                setIndex(Number(event.target.value));
              }}
            />
            <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
              {index + 1}/{stepCount} · {formatReplayClock(replay.durationMs)}
            </span>
          </div>
          <ol className="max-h-[52vh] min-h-0 flex-1 overflow-auto" ref={listRef}>
            {revealed.map((step, stepIndex) => (
              <ReplayStepRow
                active={stepIndex === index}
                atMs={step.atMs}
                gapMs={step.gapMs}
                index={stepIndex}
                key={step.entry.id}
                step={step}
              />
            ))}
          </ol>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

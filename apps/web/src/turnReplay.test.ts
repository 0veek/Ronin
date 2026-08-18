import type { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "./session-logic";
import {
  buildTurnReplay,
  describeReplayStep,
  REPLAY_EXCERPT_MAX_CHARS,
  formatReplayClock,
  formatReplayGap,
  REPLAY_MAX_GAP_MS,
  REPLAY_TAIL_MS,
  REPLAY_VERBATIM_GAP_MS,
  replayStepDelayMs,
} from "./turnReplay";

const TURN = "turn-1" as TurnId;
const OTHER_TURN = "turn-2" as TurnId;

function messageEntry(id: string, createdAt: string, turnId: TurnId | null): TimelineEntry {
  return {
    id,
    kind: "message",
    createdAt,
    message: { turnId },
  } as unknown as TimelineEntry;
}

function workEntry(id: string, createdAt: string, turnId: TurnId | null): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt,
    entry: { id, createdAt, turnId, label: id, tone: "tool" },
  } as unknown as TimelineEntry;
}

function planEntry(id: string, createdAt: string): TimelineEntry {
  return {
    id,
    kind: "turn-plan",
    createdAt,
    turnPlan: { id, createdAt },
  } as unknown as TimelineEntry;
}

const at = (seconds: number) =>
  new Date(Date.parse("2026-05-01T10:00:00.000Z") + seconds * 1_000).toISOString();

describe("buildTurnReplay", () => {
  it("keeps only the entries belonging to the turn", () => {
    const replay = buildTurnReplay(
      [
        messageEntry("before", at(-30), OTHER_TURN),
        messageEntry("m1", at(0), TURN),
        workEntry("w1", at(2), TURN),
        messageEntry("after", at(9), OTHER_TURN),
        workEntry("w2", at(5), TURN),
      ],
      TURN,
    );
    expect(replay?.steps.map((step) => step.entry.id)).toEqual(["m1", "w1", "w2"]);
  });

  it("leaves plans out, since a plan is about a turn rather than a step in it", () => {
    const replay = buildTurnReplay(
      [messageEntry("m1", at(0), TURN), planEntry("plan", at(1)), workEntry("w1", at(2), TURN)],
      TURN,
    );
    expect(replay?.steps.map((step) => step.entry.id)).toEqual(["m1", "w1"]);
  });

  it("refuses a turn with nothing to order", () => {
    expect(buildTurnReplay([], TURN)).toBeNull();
    expect(buildTurnReplay([messageEntry("m1", at(0), TURN)], TURN)).toBeNull();
    expect(buildTurnReplay([messageEntry("m1", at(0), OTHER_TURN)], TURN)).toBeNull();
  });

  it("holds the order of entries that share a timestamp", () => {
    const replay = buildTurnReplay(
      [
        workEntry("first", at(1), TURN),
        workEntry("second", at(1), TURN),
        workEntry("third", at(1), TURN),
      ],
      TURN,
    );
    expect(replay?.steps.map((step) => step.entry.id)).toEqual(["first", "second", "third"]);
  });

  it("measures the turn on the real clock", () => {
    const replay = buildTurnReplay(
      [messageEntry("m1", at(0), TURN), workEntry("w1", at(90), TURN)],
      TURN,
    );
    expect(replay?.durationMs).toBe(90_000);
    expect(replay?.steps[1]?.atMs).toBe(90_000);
    expect(replay?.steps[1]?.gapMs).toBe(90_000);
  });

  it("plays short gaps verbatim and compresses long ones", () => {
    const short = buildTurnReplay(
      [workEntry("a", at(0), TURN), workEntry("b", at(0.2), TURN)],
      TURN,
    );
    expect(short?.steps[1]?.playheadMs).toBe(200);

    const long = buildTurnReplay(
      [workEntry("a", at(0), TURN), workEntry("b", at(600), TURN)],
      TURN,
    );
    // Ten minutes of waiting must not cost ten minutes of watching.
    expect(long!.steps[1]!.playheadMs).toBeLessThanOrEqual(REPLAY_MAX_GAP_MS);
    expect(long!.steps[1]!.playheadMs).toBeGreaterThan(REPLAY_VERBATIM_GAP_MS);
  });

  it("keeps a longer wait distinguishable from a shorter one", () => {
    const twoSeconds = buildTurnReplay(
      [workEntry("a", at(0), TURN), workEntry("b", at(2), TURN)],
      TURN,
    );
    const twoMinutes = buildTurnReplay(
      [workEntry("a", at(0), TURN), workEntry("b", at(120), TURN)],
      TURN,
    );
    expect(twoMinutes!.steps[1]!.playheadMs).toBeGreaterThan(twoSeconds!.steps[1]!.playheadMs);
  });
});

describe("replayStepDelayMs", () => {
  const replay = buildTurnReplay(
    [workEntry("a", at(0), TURN), workEntry("b", at(0.2), TURN), workEntry("c", at(600), TURN)],
    TURN,
  )!;

  it("rests for the compressed gap before the next step", () => {
    expect(replayStepDelayMs(replay, 0)).toBe(200);
  });

  it("never sits through a real ten-minute wait", () => {
    expect(replayStepDelayMs(replay, 1)).toBeLessThanOrEqual(REPLAY_MAX_GAP_MS);
  });

  it("gives the last step time to be read", () => {
    expect(replayStepDelayMs(replay, 2)).toBe(REPLAY_TAIL_MS);
    expect(replayStepDelayMs(replay, 99)).toBe(REPLAY_TAIL_MS);
  });
});

describe("formatting", () => {
  it("stays quiet about gaps too short to matter", () => {
    expect(formatReplayGap(0)).toBeNull();
    expect(formatReplayGap(999)).toBeNull();
  });

  it("names a gap at the scale a reader thinks in", () => {
    expect(formatReplayGap(4_000)).toBe("4s");
    expect(formatReplayGap(134_000)).toBe("2m 14s");
    expect(formatReplayGap(3_780_000)).toBe("1h 03m");
  });

  it("clocks the turn from its own start", () => {
    expect(formatReplayClock(0)).toBe("0:00");
    expect(formatReplayClock(64_000)).toBe("1:04");
    expect(formatReplayClock(-5)).toBe("0:00");
  });
});

describe("describeReplayStep", () => {
  it("names who acted", () => {
    const user = {
      kind: "message",
      createdAt: at(0),
      message: { role: "user", text: "fix the loader", turnId: TURN },
    } as unknown as TimelineEntry;
    expect(describeReplayStep(user).actor).toBe("You");
    expect(describeReplayStep(user).label).toBe("Sent the prompt");

    const assistant = {
      kind: "message",
      createdAt: at(1),
      message: { role: "assistant", text: "done", turnId: TURN },
    } as unknown as TimelineEntry;
    expect(describeReplayStep(assistant).actor).toBe("Agent");
  });

  it("prefers the command a tool ran over its prose detail", () => {
    const work = {
      kind: "work",
      createdAt: at(2),
      entry: {
        turnId: TURN,
        label: "Ran tests",
        command: "vp test run",
        detail: "some prose",
        tone: "tool",
      },
    } as unknown as TimelineEntry;
    expect(describeReplayStep(work).detail).toBe("vp test run");
    expect(describeReplayStep(work).tone).toBe("tool");
  });

  it("flattens whitespace and cuts a long excerpt", () => {
    const message = {
      kind: "message",
      createdAt: at(0),
      message: { role: "assistant", text: `line\n\nline   ${"x".repeat(400)}`, turnId: TURN },
    } as unknown as TimelineEntry;
    const detail = describeReplayStep(message).detail;
    expect(detail).not.toBeNull();
    expect(detail).not.toContain("\n");
    expect(detail!.length).toBeLessThanOrEqual(REPLAY_EXCERPT_MAX_CHARS);
    expect(detail!.endsWith("…")).toBe(true);
  });

  it("says nothing rather than an empty excerpt", () => {
    const empty = {
      kind: "message",
      createdAt: at(0),
      message: { role: "assistant", text: "   ", turnId: TURN },
    } as unknown as TimelineEntry;
    expect(describeReplayStep(empty).detail).toBeNull();
  });
});

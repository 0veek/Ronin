import type { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveTurnStartedAtByTurnId, formatTurnDuration, turnDurationLabel } from "./turnReceipt";

const TURN = "turn-1" as TurnId;

function messageEntry(input: { id: string; createdAt: string; turnId: TurnId | null }) {
  return {
    id: input.id,
    kind: "message" as const,
    createdAt: input.createdAt,
    message: { turnId: input.turnId },
  };
}

describe("deriveTurnStartedAtByTurnId", () => {
  it("dates a turn from the first entry that carries its id", () => {
    const started = deriveTurnStartedAtByTurnId([
      messageEntry({ id: "m1", createdAt: "2026-05-01T10:00:00.000Z", turnId: TURN }),
      messageEntry({ id: "m2", createdAt: "2026-05-01T10:00:30.000Z", turnId: TURN }),
    ] as never);

    expect(started.get(TURN)).toBe("2026-05-01T10:00:00.000Z");
  });

  it("ignores entries with no turn, which cannot date anything", () => {
    const started = deriveTurnStartedAtByTurnId([
      messageEntry({ id: "m0", createdAt: "2026-05-01T09:00:00.000Z", turnId: null }),
      messageEntry({ id: "m1", createdAt: "2026-05-01T10:00:00.000Z", turnId: TURN }),
    ] as never);

    expect(started.size).toBe(1);
    expect(started.get(TURN)).toBe("2026-05-01T10:00:00.000Z");
  });
});

describe("formatTurnDuration", () => {
  it("reports seconds on their own", () => {
    expect(formatTurnDuration("2026-05-01T10:00:00.000Z", "2026-05-01T10:00:04.000Z")).toBe("4s");
  });

  it("pairs minutes with seconds, and drops seconds when there are none", () => {
    expect(formatTurnDuration("2026-05-01T10:00:00.000Z", "2026-05-01T10:01:12.000Z")).toBe(
      "1m 12s",
    );
    expect(formatTurnDuration("2026-05-01T10:00:00.000Z", "2026-05-01T10:02:00.000Z")).toBe("2m");
  });

  it("drops to hours and minutes for long runs rather than counting seconds", () => {
    expect(formatTurnDuration("2026-05-01T10:00:00.000Z", "2026-05-01T12:05:30.000Z")).toBe(
      "2h 5m",
    );
    expect(formatTurnDuration("2026-05-01T10:00:00.000Z", "2026-05-01T13:00:00.000Z")).toBe("3h");
  });

  it("says nothing about a turn too short to be worth a number", () => {
    expect(formatTurnDuration("2026-05-01T10:00:00.000Z", "2026-05-01T10:00:00.400Z")).toBeNull();
  });

  it("says nothing when the clock ran backwards", () => {
    // Clock skew between the client and a remote environment, not a fact about
    // the turn.
    expect(formatTurnDuration("2026-05-01T10:00:05.000Z", "2026-05-01T10:00:00.000Z")).toBeNull();
  });

  it("says nothing about unparseable timestamps", () => {
    expect(formatTurnDuration("not-a-date", "2026-05-01T10:00:00.000Z")).toBeNull();
  });
});

describe("turnDurationLabel", () => {
  it("omits the label for a turn whose opening message was never loaded", () => {
    expect(
      turnDurationLabel({
        turnId: TURN,
        completedAt: "2026-05-01T10:01:00.000Z",
        startedAtByTurnId: new Map(),
      }),
    ).toBeNull();
  });

  it("measures from the turn's own start to its checkpoint", () => {
    expect(
      turnDurationLabel({
        turnId: TURN,
        completedAt: "2026-05-01T10:01:00.000Z",
        startedAtByTurnId: new Map([[TURN, "2026-05-01T10:00:00.000Z"]]),
      }),
    ).toBe("1m");
  });
});

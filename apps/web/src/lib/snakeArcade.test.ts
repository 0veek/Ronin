import { describe, expect, it } from "vite-plus/test";

import {
  SNAKE_LOGO_CELLS,
  createSnakeArcade,
  resizeSnakeArcade,
  snakeDirectionForKey,
  steerSnakeArcade,
  stepSnakeArcade,
  type SnakeArcadeState,
} from "./snakeArcade";

/** A random that never varies keeps every spawn landing in the same place. */
const fixedRandom = (value: number) => () => value;

function makeGame(overrides: Partial<SnakeArcadeState> = {}): SnakeArcadeState {
  const state = createSnakeArcade({
    cols: 20,
    rows: 12,
    providerCount: 4,
    random: fixedRandom(0),
  });
  return { ...state, ...overrides };
}

const step = (state: SnakeArcadeState, random = fixedRandom(0)) =>
  stepSnakeArcade(state, { providerCount: 4, random });

describe("createSnakeArcade", () => {
  it("starts with a snake pointed right", () => {
    const state = makeGame();

    expect(state.body).toHaveLength(3);
    expect(state.direction).toEqual({ x: 1, y: 0 });
    expect(state.status).toBe("playing");
    expect(state.score).toBe(0);
  });

  it("refuses a board too small to hold a pickup", () => {
    const state = createSnakeArcade({ cols: 1, rows: 1, providerCount: 1, random: fixedRandom(0) });

    expect(state.cols).toBeGreaterThanOrEqual(SNAKE_LOGO_CELLS + 2);
    expect(state.rows).toBeGreaterThanOrEqual(SNAKE_LOGO_CELLS + 2);
  });
});

describe("steerSnakeArcade", () => {
  it("queues a turn instead of applying it immediately", () => {
    const state = steerSnakeArcade(makeGame(), "up");

    expect(state.queuedDirection).toEqual({ x: 0, y: -1 });
    expect(state.direction).toEqual({ x: 1, y: 0 });
  });

  it("ignores a reversal onto its own neck", () => {
    const state = steerSnakeArcade(makeGame(), "left");

    expect(state.queuedDirection).toBeNull();
  });

  it("ignores steering once the game is over", () => {
    const over = makeGame({ status: "over" });

    expect(steerSnakeArcade(over, "up")).toBe(over);
  });
});

describe("stepSnakeArcade", () => {
  it("moves the head and drops the tail", () => {
    const state = step(makeGame({ pellet: { x: 19, y: 11 } }));

    expect(state.body).toHaveLength(3);
    expect(state.body[0]).toEqual({ x: 7, y: 6 });
  });

  it("wraps around the edge rather than ending the run", () => {
    const state = step(
      makeGame({
        body: [
          { x: 19, y: 6 },
          { x: 18, y: 6 },
        ],
        pellet: { x: 0, y: 11 },
      }),
    );

    expect(state.status).toBe("playing");
    expect(state.body[0]).toEqual({ x: 0, y: 6 });
  });

  it("grows and scores on a pellet", () => {
    const state = step(
      makeGame({
        body: [
          { x: 5, y: 6 },
          { x: 4, y: 6 },
        ],
        pellet: { x: 6, y: 6 },
      }),
    );

    expect(state.body).toHaveLength(3);
    expect(state.score).toBe(1);
    expect(state.pellet).not.toEqual({ x: 6, y: 6 });
  });

  it("ends the run when the head meets the body", () => {
    const state = step(
      makeGame({
        body: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },
          { x: 6, y: 6 },
          { x: 5, y: 6 },
          { x: 4, y: 6 },
        ],
        direction: { x: 1, y: 0 },
        pellet: { x: 0, y: 0 },
        grow: 0,
      }),
    );

    expect(state.status).toBe("over");
  });

  it("lets the head take the tail cell it is about to vacate", () => {
    const state = step(
      makeGame({
        body: [
          { x: 5, y: 5 },
          { x: 5, y: 6 },
          { x: 6, y: 6 },
          { x: 6, y: 5 },
        ],
        direction: { x: 0, y: 1 },
        queuedDirection: { x: 1, y: 0 },
        pellet: { x: 0, y: 0 },
      }),
    );

    expect(state.status).toBe("playing");
  });

  it("takes a provider mark for a bigger score and says something about it", () => {
    const state = step(
      makeGame({
        body: [{ x: 5, y: 5 }],
        pellet: { x: 0, y: 0 },
        logo: { providerIndex: 2, x: 6, y: 4, ticksLeft: 40 },
      }),
    );

    expect(state.score).toBe(5);
    expect(state.logo).toBeNull();
    expect(state.speech?.text).toBeTruthy();
  });

  it("lets a speech line time out", () => {
    const state = step(
      makeGame({
        pellet: { x: 0, y: 0 },
        speech: { text: "YOINK", ticksLeft: 1 },
      }),
    );

    expect(state.speech).toBeNull();
  });

  it("expires an untouched provider mark", () => {
    const state = step(
      makeGame({
        pellet: { x: 0, y: 0 },
        logo: { providerIndex: 1, x: 15, y: 8, ticksLeft: 1 },
      }),
    );

    expect(state.logo).toBeNull();
    expect(state.ticksToNextLogo).toBeGreaterThan(0);
  });

  it("spawns a provider mark once the gap runs out", () => {
    const state = step(makeGame({ pellet: { x: 0, y: 0 }, logo: null, ticksToNextLogo: 1 }));

    expect(state.logo).not.toBeNull();
    expect(state.logo?.x).toBeLessThanOrEqual(state.cols - SNAKE_LOGO_CELLS);
    expect(state.logo?.y).toBeLessThanOrEqual(state.rows - SNAKE_LOGO_CELLS);
  });

  it("never spawns a mark when no provider icons exist", () => {
    const state = stepSnakeArcade(makeGame({ pellet: { x: 0, y: 0 }, ticksToNextLogo: 1 }), {
      providerCount: 0,
      random: fixedRandom(0),
    });

    expect(state.logo).toBeNull();
  });

  it("does nothing once the run is over", () => {
    const over = makeGame({ status: "over" });

    expect(step(over)).toBe(over);
  });
});

describe("resizeSnakeArcade", () => {
  it("keeps the same state when the board did not change", () => {
    const state = makeGame();

    expect(resizeSnakeArcade(state, { cols: state.cols, rows: state.rows })).toBe(state);
  });

  it("folds the snake back inside a smaller board without doubling a cell", () => {
    const state = resizeSnakeArcade(
      makeGame({
        body: [
          { x: 19, y: 11 },
          { x: 9, y: 1 },
          { x: 8, y: 1 },
        ],
      }),
      { cols: 10, rows: 10 },
    );

    const keys = state.body.map((cell) => `${cell.x},${cell.y}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(state.body.every((cell) => cell.x < 10 && cell.y < 10)).toBe(true);
  });

  it("drops a pickup that no longer fits", () => {
    const state = resizeSnakeArcade(
      makeGame({ logo: { providerIndex: 0, x: 16, y: 8, ticksLeft: 20 } }),
      { cols: 10, rows: 10 },
    );

    expect(state.logo).toBeNull();
  });
});

describe("snakeDirectionForKey", () => {
  it("reads arrows and WASD", () => {
    expect(snakeDirectionForKey("ArrowUp")).toBe("up");
    expect(snakeDirectionForKey("d")).toBe("right");
    expect(snakeDirectionForKey("W")).toBe("up");
  });

  it("leaves every other key to the app", () => {
    expect(snakeDirectionForKey("Enter")).toBeNull();
    expect(snakeDirectionForKey("k")).toBeNull();
  });
});

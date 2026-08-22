/**
 * The snake that lives on the empty workspace screen.
 *
 * Pure state: one tick in, one state out, with randomness passed in so the whole thing is
 * deterministic under test. Nothing here schedules a frame -- the surface owns the clock, and only
 * winds it while somebody is actually playing.
 */

export interface SnakeCell {
  readonly x: number;
  readonly y: number;
}

export interface SnakeLogoPickup {
  /** Which provider mark is sitting on the board. The surface maps it to an icon. */
  readonly providerIndex: number;
  readonly x: number;
  readonly y: number;
  readonly ticksLeft: number;
}

export interface SnakeSpeech {
  readonly text: string;
  readonly ticksLeft: number;
}

export interface SnakeArcadeState {
  readonly cols: number;
  readonly rows: number;
  readonly body: ReadonlyArray<SnakeCell>;
  readonly direction: SnakeCell;
  /** Applied on the next tick, so two turns in one frame cannot fold the snake onto itself. */
  readonly queuedDirection: SnakeCell | null;
  readonly pellet: SnakeCell;
  readonly grow: number;
  readonly logo: SnakeLogoPickup | null;
  readonly ticksToNextLogo: number;
  readonly speech: SnakeSpeech | null;
  readonly score: number;
  readonly status: "playing" | "over";
}

export type SnakeDirection = "up" | "down" | "left" | "right";

export interface SnakeArcadeOptions {
  readonly cols: number;
  readonly rows: number;
  readonly providerCount: number;
  readonly random: () => number;
}

/** The pickup is a provider mark, so it covers a 3x3 block rather than a single cell. */
export const SNAKE_LOGO_CELLS = 3;

const LOGO_GROWTH = 5;
const LOGO_SCORE = 5;
const PELLET_GROWTH = 1;
const LOGO_LIFE_TICKS = 170;
const LOGO_GAP_MIN_TICKS = 60;
const LOGO_GAP_MAX_TICKS = 150;
const SPEECH_TICKS = 34;
const STARTING_LENGTH = 3;

/** What the snake pipes up with once it has swallowed a provider mark. */
export const SNAKE_CHATTER: ReadonlyArray<string> = [
  "NOM NOM NOM",
  "MINE!",
  "DIBS",
  "SNACK TIME",
  "IS THIS EDIBLE?",
  "OOH, SHINY",
  "ACQUIRING TARGET",
  "BRB, EATING",
  "404: FOOD FOUND",
  "SSSSSSS",
  "TASTES LIKE TABS",
  "NEEDS MORE SALT",
  "NO TRADEMARKS HARMED",
  "SHIP IT",
  "YOINK",
  "CACHE MISS, SNACK HIT",
];

const DIRECTION_VECTORS: Record<SnakeDirection, SnakeCell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function wrap(value: number, max: number): number {
  if (max <= 0) return 0;
  return ((value % max) + max) % max;
}

function randomInt(random: () => number, max: number): number {
  return Math.min(max - 1, Math.max(0, Math.floor(random() * max)));
}

function occupies(body: ReadonlyArray<SnakeCell>, x: number, y: number): boolean {
  return body.some((cell) => cell.x === x && cell.y === y);
}

function coversLogo(logo: SnakeLogoPickup | null, x: number, y: number): boolean {
  if (!logo) return false;
  return (
    x >= logo.x && x < logo.x + SNAKE_LOGO_CELLS && y >= logo.y && y < logo.y + SNAKE_LOGO_CELLS
  );
}

function placePellet(
  body: ReadonlyArray<SnakeCell>,
  logo: SnakeLogoPickup | null,
  cols: number,
  rows: number,
  random: () => number,
): SnakeCell {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = randomInt(random, cols);
    const y = randomInt(random, rows);
    if (!occupies(body, x, y) && !coversLogo(logo, x, y)) return { x, y };
  }
  // A board this crowded is already a win; drop it on the head and let the next tick sort it out.
  return body[0] ?? { x: 0, y: 0 };
}

function nextLogoGap(random: () => number): number {
  return LOGO_GAP_MIN_TICKS + randomInt(random, LOGO_GAP_MAX_TICKS - LOGO_GAP_MIN_TICKS + 1);
}

export function createSnakeArcade(options: SnakeArcadeOptions): SnakeArcadeState {
  const cols = Math.max(SNAKE_LOGO_CELLS + 2, Math.floor(options.cols));
  const rows = Math.max(SNAKE_LOGO_CELLS + 2, Math.floor(options.rows));
  const headX = Math.max(STARTING_LENGTH, Math.floor(cols / 3));
  const headY = Math.floor(rows / 2);
  const body = Array.from({ length: STARTING_LENGTH }, (_, index) => ({
    x: headX - index,
    y: headY,
  }));

  return {
    cols,
    rows,
    body,
    direction: DIRECTION_VECTORS.right,
    queuedDirection: null,
    pellet: placePellet(body, null, cols, rows, options.random),
    grow: 0,
    logo: null,
    ticksToNextLogo: nextLogoGap(options.random),
    speech: null,
    score: 0,
    status: "playing",
  };
}

/** A turn straight back along the body is the one input a snake must ignore. */
export function steerSnakeArcade(
  state: SnakeArcadeState,
  direction: SnakeDirection,
): SnakeArcadeState {
  if (state.status !== "playing") return state;
  const vector = DIRECTION_VECTORS[direction];
  if (vector.x === -state.direction.x && vector.y === -state.direction.y) return state;
  if (vector.x === state.direction.x && vector.y === state.direction.y) return state;
  return { ...state, queuedDirection: vector };
}

function spawnLogo(
  state: SnakeArcadeState,
  providerCount: number,
  random: () => number,
): SnakeLogoPickup | null {
  if (providerCount <= 0) return null;
  const x = randomInt(random, Math.max(1, state.cols - SNAKE_LOGO_CELLS));
  const y = randomInt(random, Math.max(1, state.rows - SNAKE_LOGO_CELLS));
  return {
    providerIndex: randomInt(random, providerCount),
    x,
    y,
    ticksLeft: LOGO_LIFE_TICKS,
  };
}

export function stepSnakeArcade(
  state: SnakeArcadeState,
  options: { readonly providerCount: number; readonly random: () => number },
): SnakeArcadeState {
  if (state.status !== "playing") return state;

  const direction = state.queuedDirection ?? state.direction;
  const head = state.body[0] ?? { x: 0, y: 0 };
  // Edges wrap. This is an easter egg found by accident, not a game somebody meant to lose.
  const next = {
    x: wrap(head.x + direction.x, state.cols),
    y: wrap(head.y + direction.y, state.rows),
  };

  const ateLogo = coversLogo(state.logo, next.x, next.y);
  const atePellet = next.x === state.pellet.x && next.y === state.pellet.y;
  const growth = state.grow + (atePellet ? PELLET_GROWTH : 0) + (ateLogo ? LOGO_GROWTH : 0);
  // The tail cell frees up on the same tick unless the snake is growing into it.
  const survivors = growth > 0 ? state.body : state.body.slice(0, -1);
  if (occupies(survivors, next.x, next.y)) {
    return { ...state, direction, queuedDirection: null, status: "over" };
  }

  const body = [next, ...survivors];
  const speech = ateLogo
    ? {
        text: SNAKE_CHATTER[randomInt(options.random, SNAKE_CHATTER.length)] ?? SNAKE_CHATTER[0]!,
        ticksLeft: SPEECH_TICKS,
      }
    : state.speech && state.speech.ticksLeft > 1
      ? { ...state.speech, ticksLeft: state.speech.ticksLeft - 1 }
      : null;

  let logo = ateLogo ? null : state.logo;
  let ticksToNextLogo = state.ticksToNextLogo;
  if (logo) {
    logo = logo.ticksLeft > 1 ? { ...logo, ticksLeft: logo.ticksLeft - 1 } : null;
    if (!logo) ticksToNextLogo = nextLogoGap(options.random);
  } else {
    ticksToNextLogo = ateLogo ? nextLogoGap(options.random) : ticksToNextLogo - 1;
    if (ticksToNextLogo <= 0) {
      logo = spawnLogo(state, options.providerCount, options.random);
      ticksToNextLogo = logo === null ? nextLogoGap(options.random) : 0;
    }
  }

  return {
    ...state,
    body,
    direction,
    queuedDirection: null,
    grow: Math.max(0, growth - 1),
    pellet: atePellet
      ? placePellet(body, logo, state.cols, state.rows, options.random)
      : state.pellet,
    logo,
    ticksToNextLogo,
    speech,
    score: state.score + (atePellet ? 1 : 0) + (ateLogo ? LOGO_SCORE : 0),
  };
}

/**
 * Keeps a running game on a resized board by folding every cell back inside it, rather than
 * throwing away a snake somebody is in the middle of steering.
 */
export function resizeSnakeArcade(
  state: SnakeArcadeState,
  size: { readonly cols: number; readonly rows: number },
): SnakeArcadeState {
  const cols = Math.max(SNAKE_LOGO_CELLS + 2, Math.floor(size.cols));
  const rows = Math.max(SNAKE_LOGO_CELLS + 2, Math.floor(size.rows));
  if (cols === state.cols && rows === state.rows) return state;

  const seen = new Set<string>();
  const body: SnakeCell[] = [];
  for (const cell of state.body) {
    const folded = { x: wrap(cell.x, cols), y: wrap(cell.y, rows) };
    const key = `${folded.x},${folded.y}`;
    // Folding can collapse two cells onto one, which would read as a self-collision next tick.
    if (seen.has(key)) continue;
    seen.add(key);
    body.push(folded);
  }

  return {
    ...state,
    cols,
    rows,
    body: body.length > 0 ? body : state.body.slice(0, 1),
    pellet: { x: wrap(state.pellet.x, cols), y: wrap(state.pellet.y, rows) },
    logo:
      state.logo &&
      state.logo.x + SNAKE_LOGO_CELLS <= cols &&
      state.logo.y + SNAKE_LOGO_CELLS <= rows
        ? state.logo
        : null,
  };
}

const ARROW_DIRECTIONS: Record<string, SnakeDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  a: "left",
  s: "down",
  d: "right",
  W: "up",
  A: "left",
  S: "down",
  D: "right",
};

/** The keys that both start the game and steer it. Anything else is left to the app. */
export function snakeDirectionForKey(key: string): SnakeDirection | null {
  return ARROW_DIRECTIONS[key] ?? null;
}

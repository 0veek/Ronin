import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import {
  SNAKE_LOGO_CELLS,
  createSnakeArcade,
  resizeSnakeArcade,
  snakeDirectionForKey,
  steerSnakeArcade,
  stepSnakeArcade,
  type SnakeArcadeState,
} from "~/lib/snakeArcade";

import {
  AntigravityIcon,
  ClaudeAI,
  CursorIcon,
  DroidIcon,
  GrokIcon,
  type Icon,
  KiloIcon,
  OpenAI,
  OpenCodeIcon,
  PiAgentIcon,
} from "./Icons";

const PROVIDER_MARKS: ReadonlyArray<{ readonly label: string; readonly Icon: Icon }> = [
  { label: "Claude Code", Icon: ClaudeAI },
  { label: "Codex", Icon: OpenAI },
  { label: "Cursor", Icon: CursorIcon },
  { label: "OpenCode", Icon: OpenCodeIcon },
  { label: "Grok", Icon: GrokIcon },
  { label: "Antigravity", Icon: AntigravityIcon },
  { label: "Droid", Icon: DroidIcon },
  { label: "Kilo", Icon: KiloIcon },
  { label: "Pi", Icon: PiAgentIcon },
];

const CELL_SIZE = 14;
const TICK_MS = 90;

/**
 * A snake hiding on the screen with nothing open on it.
 *
 * It is asleep until somebody presses an arrow key, and it goes straight back to sleep on game
 * over, on Escape, when the tab is hidden, and when the window loses focus. Ronin runs on
 * high-refresh displays all day, so an idle animation here would be a real cost paid by everyone
 * for a joke almost nobody has found yet: dormant, this paints its grid exactly once.
 */
export function SnakeArcadeBackground({ className }: { readonly className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<SnakeArcadeState | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const sizeRef = useRef({ cols: 0, rows: 0, width: 0, height: 0 });
  const [playing, setPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [logo, setLogo] = useState<SnakeArcadeState["logo"]>(null);

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !host || !context) return;

    const { width, height, cols, rows } = sizeRef.current;
    const styles = getComputedStyle(host);
    const ink = styles.color;
    context.clearRect(0, 0, width, height);

    // The dormant look: a faint dot grid, painted once and then left alone.
    context.fillStyle = ink;
    context.globalAlpha = 0.07;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < cols; column += 1) {
        context.fillRect(
          column * CELL_SIZE + CELL_SIZE / 2 - 1,
          row * CELL_SIZE + CELL_SIZE / 2 - 1,
          2,
          2,
        );
      }
    }

    const game = gameRef.current;
    if (!game) {
      context.globalAlpha = 1;
      return;
    }

    context.globalAlpha = 0.55;
    context.fillStyle = ink;
    context.beginPath();
    context.arc(
      game.pellet.x * CELL_SIZE + CELL_SIZE / 2,
      game.pellet.y * CELL_SIZE + CELL_SIZE / 2,
      3,
      0,
      Math.PI * 2,
    );
    context.fill();

    game.body.forEach((cell, index) => {
      context.globalAlpha = index === 0 ? 0.85 : Math.max(0.18, 0.6 - index * 0.012);
      context.fillRect(
        cell.x * CELL_SIZE + 1,
        cell.y * CELL_SIZE + 1,
        CELL_SIZE - 2,
        CELL_SIZE - 2,
      );
    });

    const head = game.body[0];
    if (game.speech && head) {
      const text = game.speech.text;
      context.font = '10px ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';
      const textWidth = context.measureText(text).width;
      const boxWidth = textWidth + 12;
      const left = Math.min(Math.max(4, head.x * CELL_SIZE - boxWidth / 2), width - boxWidth - 4);
      const top = Math.max(4, head.y * CELL_SIZE - 22);
      context.globalAlpha = 0.9;
      context.fillRect(left, top, boxWidth, 16);
      context.globalAlpha = 1;
      context.fillStyle =
        styles.backgroundColor === "rgba(0, 0, 0, 0)" ? "#000" : styles.backgroundColor;
      context.fillText(text, left + 6, top + 11);
      context.fillStyle = ink;
    }

    context.globalAlpha = 1;
  }, []);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    const rect = host.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(CELL_SIZE, Math.floor(rect.width));
    const height = Math.max(CELL_SIZE, Math.floor(rect.height));
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);

    sizeRef.current = {
      width,
      height,
      cols: Math.max(1, Math.floor(width / CELL_SIZE)),
      rows: Math.max(1, Math.floor(height / CELL_SIZE)),
    };
    if (gameRef.current) {
      gameRef.current = resizeSnakeArcade(gameRef.current, sizeRef.current);
    }
    paint();
  }, [paint]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    gameRef.current = null;
    setPlaying(false);
    setLogo(null);
    paint();
  }, [paint]);

  // Held in a ref so the keydown listener never has to be torn down and rebuilt mid-run.
  const runFrameRef = useRef<(timestamp: number) => void>(() => {});
  runFrameRef.current = (timestamp: number) => {
    const game = gameRef.current;
    if (!game) return;
    if (timestamp - lastTickRef.current >= TICK_MS) {
      lastTickRef.current = timestamp;
      const next = stepSnakeArcade(game, {
        providerCount: PROVIDER_MARKS.length,
        random: Math.random,
      });
      gameRef.current = next;
      if (next.score !== game.score) setScore(next.score);
      if (next.logo !== game.logo) setLogo(next.logo);
      paint();
      if (next.status === "over") {
        frameRef.current = null;
        // The board stays up for a beat so the run has an ending rather than a blink.
        window.setTimeout(() => stop(), 900);
        return;
      }
    }
    frameRef.current = requestAnimationFrame((next) => runFrameRef.current(next));
  };

  useEffect(() => {
    measure();
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(host);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (reducedMotion) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      // Anything with a real focus target owns its own arrow keys.
      if (target instanceof HTMLElement && target !== document.body) return;

      if (event.key === "Escape" && gameRef.current) {
        event.preventDefault();
        stop();
        return;
      }

      const direction = snakeDirectionForKey(event.key);
      if (!direction) return;
      event.preventDefault();

      if (!gameRef.current) {
        const { cols, rows } = sizeRef.current;
        gameRef.current = createSnakeArcade({
          cols,
          rows,
          providerCount: PROVIDER_MARKS.length,
          random: Math.random,
        });
        setScore(0);
        setPlaying(true);
        lastTickRef.current = 0;
        frameRef.current = requestAnimationFrame((timestamp) => runFrameRef.current(timestamp));
      }
      gameRef.current = steerSnakeArcade(gameRef.current, direction);
    };

    // A game nobody is looking at is a game nobody is playing.
    const onLeave = () => {
      if (gameRef.current) stop();
    };
    const onVisibility = () => {
      if (document.hidden) onLeave();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [reducedMotion, stop]);

  const mark = logo === null ? null : PROVIDER_MARKS[logo.providerIndex % PROVIDER_MARKS.length];

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden text-foreground",
        className,
      )}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      {logo && mark ? (
        <div
          className="absolute transition-opacity duration-200"
          style={{
            left: logo.x * CELL_SIZE,
            top: logo.y * CELL_SIZE,
            width: SNAKE_LOGO_CELLS * CELL_SIZE,
            height: SNAKE_LOGO_CELLS * CELL_SIZE,
            opacity: logo.ticksLeft < 12 ? 0.15 : 0.75,
          }}
        >
          <mark.Icon className="size-full" />
        </div>
      ) : null}
      {playing ? (
        <p className="absolute right-3 bottom-2 font-mono text-2xs text-muted-foreground/60 tabular-nums">
          {score} · esc to stop
        </p>
      ) : null}
    </div>
  );
}

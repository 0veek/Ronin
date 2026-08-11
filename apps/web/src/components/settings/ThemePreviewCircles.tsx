import { MoonIcon, SunIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getThemeColorsForMode,
  getThemeModes,
  type ThemeAppearance,
  type ThemeDefinition,
} from "../../themePalette";

const THEME_PREVIEW_ROLES = [
  "sidebar",
  "canvas",
  "surface",
  "accentSurface",
  "accent",
  "messageSurface",
  "messageAction",
] as const;
type ThemePreviewRole = (typeof THEME_PREVIEW_ROLES)[number];
type ThemeCardPreview = {
  mode: ThemeAppearance;
  colors: Readonly<Record<ThemePreviewRole, string>>;
};
export type ThemeCardDefinition = {
  id: string;
  label: string;
  previews: ReadonlyArray<ThemeCardPreview>;
};
export type ThemeMode = ThemeAppearance | "system";
export type ThemeCardPreviewColors = ThemeCardPreview["colors"];

const STANDARD_THEME_PREVIEW_COLORS: Record<
  ThemeAppearance,
  Readonly<Record<ThemePreviewRole, string>>
> = {
  light: {
    sidebar: "#fafafa",
    canvas: "#fcfcfc",
    surface: "#ffffff",
    accentSurface: "#f4f4f5",
    accent: "#f4f4f5",
    messageSurface: "#e4e4e7",
    messageAction: "#4f46e5",
  },
  dark: {
    sidebar: "#0f0f10",
    canvas: "#0a0a0a",
    surface: "#121212",
    accentSurface: "#27272a",
    accent: "#1c1c1f",
    messageSurface: "#27272a",
    messageAction: "#8b9cff",
  },
};

export const STANDARD_THEME_CARDS: ReadonlyArray<ThemeCardDefinition> = [
  {
    id: "default",
    label: "Ronin",
    previews: (["light", "dark"] as const).map((mode) => ({
      mode,
      colors: STANDARD_THEME_PREVIEW_COLORS[mode],
    })),
  },
];

export function previewColorsOf(
  card: ThemeCardDefinition,
  mode: ThemeAppearance,
): ThemeCardPreviewColors | null {
  return card.previews.find((preview) => preview.mode === mode)?.colors ?? null;
}

export function getThemeCardDefinition(theme: ThemeDefinition): ThemeCardDefinition {
  return {
    id: theme.id,
    label: theme.label,
    previews: getThemeModes(theme).map((mode) => {
      const colors = getThemeColorsForMode(theme, mode) ?? theme.colors;
      return {
        mode,
        colors: {
          sidebar: colors.sidebar,
          canvas: colors.canvas,
          surface: colors.surface,
          accentSurface: colors.accentSurface,
          accent: colors.accent,
          messageSurface: colors.messageSurface,
          messageAction: colors.messageAction,
        },
      };
    }),
  };
}

/**
 * The swatch was a blurred two-hotspot radial gradient in an inset-ringed
 * circle -- a lit glass ball. It read as a lozenge of mood rather than a
 * palette, and at 56px the blur cost a composited layer per theme card.
 *
 * A flat swatch can be literal instead: it is the shell in miniature, the same
 * regions the wireframe draws, so a glance at the ball answers "what will the
 * sidebar look like next to the canvas" rather than "is this one warm".
 */
function themePreviewLine(mode: ThemeAppearance): string {
  return mode === "dark" ? "rgb(255 255 255 / 0.16)" : "rgb(0 0 0 / 0.12)";
}

function ThemePreviewSwatch({
  colors,
  mode,
}: {
  colors: ThemeCardPreviewColors;
  mode: ThemeAppearance;
}) {
  const line = themePreviewLine(mode);
  return (
    <span
      aria-hidden
      className="relative block size-14 shrink-0 overflow-hidden rounded-(--radius)"
      style={{ backgroundColor: colors.canvas, boxShadow: `inset 0 0 0 1px ${line}` }}
    >
      <span
        className="absolute inset-y-0 left-0 w-[32%]"
        style={{ backgroundColor: colors.sidebar, boxShadow: `inset -1px 0 0 ${line}` }}
      />
      {/* The accent marks the active sidebar row, exactly as the shell does. */}
      <span
        className="absolute left-0 top-[26%] h-[16%] w-[6%]"
        style={{ backgroundColor: colors.messageAction }}
      />
      <span
        className="absolute right-[14%] top-[22%] h-[24%] w-[38%]"
        style={{ backgroundColor: colors.messageSurface }}
      />
      <span
        className="absolute bottom-[20%] left-[42%] right-[14%] h-[14%]"
        style={{ backgroundColor: colors.accent }}
      />
    </span>
  );
}

/**
 * A theme card's light and dark swatches. Clicking one assigns that theme to
 * that half of the appearance mix; assigned swatches carry a ring and a sun or
 * moon badge.
 */
export function ThemePreviewCircles({
  label,
  activeModes,
  onSelectMode,
  previews,
}: {
  label: string;
  activeModes: ReadonlyArray<ThemeMode>;
  onSelectMode: (mode: ThemeMode) => void;
  previews: ThemeCardDefinition["previews"];
}) {
  return (
    <div className="flex min-h-16 items-center justify-center gap-2.5 px-3 pt-3">
      {previews.map((preview) => {
        const mode = preview.mode;
        const isPicked = activeModes.includes(mode);
        return (
          <Tooltip key={mode}>
            <TooltipTrigger
              render={
                <button
                  aria-label={`Use ${label} ${mode} mode`}
                  aria-pressed={isPicked}
                  className={cn(
                    "relative flex size-[68px] shrink-0 transform-gpu cursor-pointer items-center justify-center rounded-(--radius) p-1.5 outline-none transition-transform duration-(--duration-fast) ease-out hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                    isPicked && "hover:scale-100",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectMode(mode);
                  }}
                  type="button"
                >
                  <ThemePreviewSwatch colors={preview.colors} mode={mode} />
                  {isPicked ? (
                    <>
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 rounded-(--radius)"
                        style={{ boxShadow: "inset 0 0 0 2px var(--ring)" }}
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute bottom-0 right-0 flex size-5 items-center justify-center rounded-(--control-radius) border border-border bg-background text-foreground"
                      >
                        {mode === "light" ? (
                          <SunIcon className="size-3" />
                        ) : (
                          <MoonIcon className="size-3" />
                        )}
                      </span>
                    </>
                  ) : null}
                </button>
              }
            />
            <TooltipPopup>
              {mode === "light" ? "Use for light mode only" : "Use for dark mode only"}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </div>
  );
}

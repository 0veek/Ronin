import { cn } from "../../lib/utils";
import type { ThemeCardPreviewColors } from "./ThemePreviewCircles";

/**
 * A miniature of the app: topbar, sidebar, a short conversation, the composer,
 * and the right panel.
 *
 * The old miniature drew the shell it replaced -- rounded thread pills floating
 * inside an inset sidebar, and an orchestrator island with a drop shadow
 * hovering over the composer. Neither exists now, so the drawing would have
 * been advertising chrome the theme could no longer produce. What it shows
 * instead is what the redesign actually renders: full-bleed rows divided by
 * hairlines, an accent rule marking the active one, flat underlined tabs, and
 * a panel that is a bounded region rather than a floating card.
 */
export function ThemeWireframePane({
  colors,
  clip,
}: {
  colors: ThemeCardPreviewColors;
  clip?: "left" | "right" | undefined;
}) {
  const line = "rgb(127 127 127 / 0.25)";
  return (
    <span
      className="absolute inset-0"
      style={
        clip === undefined
          ? undefined
          : {
              clipPath:
                clip === "left"
                  ? "polygon(0 0, calc(50% - 1px) 0, calc(50% - 1px) 100%, 0 100%)"
                  : "polygon(calc(50% + 1px) 0, 100% 0, 100% 100%, calc(50% + 1px) 100%)",
            }
      }
    >
      <span className="absolute inset-0" style={{ backgroundColor: colors.canvas }} />
      <span
        className="absolute inset-y-0 left-0 w-[22%]"
        style={{ backgroundColor: colors.sidebar, boxShadow: `inset -1px 0 0 ${line}` }}
      />

      {/* Topbar: one hairline under a breadcrumb, no fill of its own. */}
      <span className="absolute inset-x-0 top-[11%] h-px" style={{ backgroundColor: line }} />
      <span
        className="absolute left-[26%] top-[4%] h-[3%] w-[18%]"
        style={{ backgroundColor: line, opacity: 0.8 }}
      />

      {/* Sidebar: a mono section label, then full-bleed hairline-divided rows.
          The active row is marked by an accent rule, not a filled pill. */}
      <span
        className="absolute left-[4%] top-[16%] h-[2.5%] w-[9%]"
        style={{ backgroundColor: line, opacity: 0.9 }}
      />
      {[0, 1, 2].map((row) => (
        <span key={row}>
          <span
            className="absolute left-0 w-[22%]"
            style={{ top: `${24 + row * 13}%`, height: "1px", backgroundColor: line }}
          />
          <span
            className="absolute left-[6%] w-[13%]"
            style={{
              top: `${29 + row * 13}%`,
              height: "3%",
              backgroundColor: row === 0 ? colors.messageAction : line,
              opacity: row === 0 ? 0.9 : 0.7,
            }}
          />
        </span>
      ))}
      <span
        className="absolute left-0 w-[1.5%]"
        style={{ top: "24%", height: "13%", backgroundColor: colors.messageAction }}
      />

      {/* Conversation: one message surface, then unfilled body lines. */}
      <span
        className="absolute right-[30%] top-[19%] h-[9%] w-[22%] rounded-[3px]"
        style={{ backgroundColor: colors.messageSurface }}
      />
      <span
        className="absolute left-[26%] top-[34%] h-[3.5%] w-[32%] rounded-[2px]"
        style={{ backgroundColor: line }}
      />
      <span
        className="absolute left-[26%] top-[42%] h-[3.5%] w-[24%] rounded-[2px]"
        style={{ backgroundColor: line }}
      />

      {/* Composer: one box, one border, with the context strip as a region
          inside it divided off by a single hairline. */}
      <span
        className="absolute bottom-[7%] left-[26%] right-[32%] h-[20%] overflow-hidden rounded-[4px]"
        style={{ backgroundColor: colors.surface, boxShadow: `inset 0 0 0 1px ${line}` }}
      >
        <span
          className="absolute left-[7%] top-[18%] block h-[16%] w-[46%] rounded-[2px]"
          style={{ backgroundColor: line, opacity: 0.7 }}
        />
        <span className="absolute inset-x-0 bottom-[34%] h-px" style={{ backgroundColor: line }} />
        <span
          className="absolute bottom-[10%] right-[7%] block aspect-square h-[20%] rounded-[2px]"
          style={{ backgroundColor: colors.messageAction }}
        />
      </span>

      {/* Right panel: bounded by a rule, tabs marked by an underline. */}
      <span
        className="absolute bottom-0 right-0 top-[11%] w-[30%]"
        style={{ boxShadow: `inset 1px 0 0 ${line}` }}
      >
        <span className="absolute inset-x-0 top-[13%] h-px" style={{ backgroundColor: line }} />
        <span
          className="absolute left-[10%] top-[5%] h-[3%] w-[22%]"
          style={{ backgroundColor: colors.messageAction, opacity: 0.9 }}
        />
        <span
          className="absolute left-[10%] top-[12.2%] h-[1.8%] w-[22%]"
          style={{ backgroundColor: colors.messageAction }}
        />
        <span
          className="absolute left-[40%] top-[5%] h-[3%] w-[22%]"
          style={{ backgroundColor: line, opacity: 0.8 }}
        />
        {[0, 1, 2, 3].map((row) => (
          <span
            className="absolute left-[10%]"
            key={row}
            style={{
              top: `${24 + row * 9}%`,
              height: "3%",
              width: `${64 - row * 9}%`,
              backgroundColor: line,
              opacity: 0.6,
            }}
          />
        ))}
      </span>
    </span>
  );
}

export function ThemeWireframe({
  className,
  panes,
}: {
  /** Sizing (height) for the frame; the pane geometry is percentage based. */
  className?: string;
  panes: ReadonlyArray<{ colors: ThemeCardPreviewColors; clip?: "left" | "right" }>;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block w-full overflow-hidden rounded-(--radius) border border-border",
        className,
      )}
    >
      {panes.map((pane) => (
        <ThemeWireframePane clip={pane.clip} colors={pane.colors} key={pane.clip ?? "pane"} />
      ))}
    </span>
  );
}

import { memo, type CSSProperties } from "react";
import { cn } from "~/lib/utils";

export function hasNonZeroStat(stat: { additions: number; deletions: number }): boolean {
  return stat.additions > 0 || stat.deletions > 0;
}

function formatCompactDiffCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  if (value < 1_000_000_000) {
    const m = value / 1_000_000;
    return `${m < 10 ? m.toFixed(1).replace(/\.0$/, "") : Math.round(m)}m`;
  }
  const b = value / 1_000_000_000;
  return `${b < 10 ? b.toFixed(1).replace(/\.0$/, "") : Math.round(b)}b`;
}

/**
 * The share of the change that is additions, as a CSS percentage.
 *
 * Both counts zero would divide by zero, and it is the one case with no shape
 * to draw anyway -- callers filter it with `hasNonZeroStat`, and `ink` renders
 * nothing when it slips through.
 */
function additionShare(additions: number, deletions: number): string {
  const total = additions + deletions;
  if (total === 0) return "0%";
  return `${(additions / total) * 100}%`;
}

export const DiffStatLabel = memo(function DiffStatLabel(props: {
  additions: number;
  deletions: number;
  className?: string;
  showParentheses?: boolean;
  layout?: "aligned" | "inline";
  /**
   * Underline the counts with a two-tone rule split at the same ratio. Borrowed
   * from the sidebar usage meter, where the measurement and the rule that
   * closes the row are the same line: the shape is readable before the digits
   * are, and a diffstat is one of the few numbers in this app that a user scans
   * rather than reads.
   */
  ink?: boolean;
}) {
  const {
    additions,
    deletions,
    className,
    showParentheses = false,
    layout = "aligned",
    ink = false,
  } = props;
  const counts = (
    <span
      role="group"
      aria-label={`${additions} additions, ${deletions} deletions`}
      className={cn(
        layout === "inline"
          ? "inline-flex items-center gap-1 tabular-nums align-middle"
          : "inline-grid grid-cols-[4ch_4ch] gap-2 text-right tabular-nums align-middle",
        className,
      )}
    >
      <span aria-hidden="true" className="font-mono text-success">
        +{formatCompactDiffCount(additions)}
      </span>
      <span aria-hidden="true" className="font-mono text-destructive">
        -{formatCompactDiffCount(deletions)}
      </span>
    </span>
  );

  return (
    <>
      {showParentheses && <span className="text-muted-foreground/70">(</span>}
      {ink && hasNonZeroStat({ additions, deletions }) ? (
        <span className="inline-flex flex-col items-stretch align-middle">
          {counts}
          <span
            aria-hidden="true"
            className="diffstat-ink"
            style={{ "--diffstat-add-share": additionShare(additions, deletions) } as CSSProperties}
          />
        </span>
      ) : (
        counts
      )}
      {showParentheses && <span className="text-muted-foreground/70">)</span>}
    </>
  );
});

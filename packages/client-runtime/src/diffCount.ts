const DIFF_COUNT_FORMAT = new Intl.NumberFormat();

/** Formats exact diff counts using the viewer's digit grouping. */
export function formatDiffCount(count: number): string {
  return DIFF_COUNT_FORMAT.format(count);
}

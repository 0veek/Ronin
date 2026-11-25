import type { ProjectEntry } from "@t3tools/contracts";
import { normalizeSearchQuery } from "@t3tools/shared/searchRanking";

export const PROJECT_FILE_PICKER_RESULT_LIMIT = 200;

export interface ProjectFilePickerMatch {
  readonly name: string;
  readonly nameMatchIndices: ReadonlyArray<number>;
  readonly path: string;
  readonly pathMatchIndices: ReadonlyArray<number>;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * First ordered subsequence of `query` inside `value`, as highlight indices.
 * Returns null when `value` does not contain the subsequence at all — the
 * entry still renders (the server matched it), just without highlights.
 */
function findMatchIndices(value: string, query: string): number[] | null {
  if (!query) return [];

  const normalizedValue = value.toLowerCase();
  // Lowercasing lengthens İ (to i̇) and shortens nothing, so only a longer result needs mapping back.
  const sourceSpans: Array<readonly [number, number]> = [];
  if (normalizedValue.length !== value.length) {
    let sourceOffset = 0;
    for (const char of value) {
      const span = [sourceOffset, sourceOffset + char.length] as const;
      for (let n = char.toLowerCase().length; n > 0; n -= 1) sourceSpans.push(span);
      sourceOffset = span[1];
    }
  }
  const indices: number[] = [];
  let queryIndex = 0;

  for (let valueIndex = 0; valueIndex < normalizedValue.length; valueIndex += 1) {
    if (normalizedValue[valueIndex] !== query[queryIndex]) continue;
    const [start, end] = sourceSpans[valueIndex] ?? [valueIndex, valueIndex + 1];
    for (let i = Math.max(start, (indices.at(-1) ?? -1) + 1); i < end; i += 1) indices.push(i);
    queryIndex += 1;
    if (queryIndex === query.length) return indices;
  }

  return null;
}

/**
 * Maps server search results to picker rows. Server ordering is preserved —
 * ranking already happened there; this pass only filters to files and
 * computes highlight positions with the same query normalization the server
 * applied.
 */
export function getProjectFilePickerMatches(
  entries: ReadonlyArray<ProjectEntry>,
  rawQuery: string,
  limit = PROJECT_FILE_PICKER_RESULT_LIMIT,
): ProjectFilePickerMatch[] {
  if (limit <= 0) return [];

  const query = normalizeSearchQuery(rawQuery, {
    trimLeadingPattern: /^[@./]+/,
  }).replaceAll(/\s/g, "");
  const matches: ProjectFilePickerMatch[] = [];

  for (const entry of entries) {
    if (entry.kind !== "file") continue;

    const name = fileName(entry.path);
    const nameMatchIndices = findMatchIndices(name, query);
    const pathMatchIndices = findMatchIndices(entry.path, query);
    matches.push({
      name,
      nameMatchIndices: nameMatchIndices ?? [],
      path: entry.path,
      pathMatchIndices: pathMatchIndices ?? [],
    });
    if (matches.length >= limit) break;
  }

  return matches;
}

const EFFORT_ORDER = ["low", "medium", "high", "thinking"] as const;

export function parseAntigravityCliModelLabel(
  value: string,
): { model: string; effort?: string } | null {
  // oxlint-disable-next-line no-control-regex -- stripping ANSI SGR codes requires matching ESC.
  const stripped = value.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (!stripped) return null;

  const tabIndex = stripped.indexOf("\t");
  const labelColumn =
    tabIndex >= 0 ? stripped.slice(tabIndex + 1).trim() : stripped.replace(/^(?:[*•-]\s+)+/u, "");
  const trimmed = labelColumn.replace(/^(?:[*•-]\s+)+/u, "").trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(.*?)\s+\(([^()]+)\)$/u);
  if (!match?.[1] || !match[2]) return { model: trimmed };
  return {
    model: match[1].trim(),
    effort: match[2].trim().toLowerCase(),
  };
}

export function parseAntigravityModelLines(output: string): ReadonlyArray<{
  readonly slug: string;
  readonly name: string;
  readonly efforts: ReadonlyArray<string>;
}> {
  const groups = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/g)) {
    const parsed = parseAntigravityCliModelLabel(line);
    if (!parsed) continue;
    const efforts = groups.get(parsed.model) ?? [];
    if (parsed.effort && !efforts.includes(parsed.effort)) efforts.push(parsed.effort);
    groups.set(parsed.model, efforts);
  }
  return [...groups.entries()].map(([model, discoveredEfforts]) => {
    const efforts = discoveredEfforts.toSorted((left, right) => {
      const leftIndex = EFFORT_ORDER.indexOf(left as (typeof EFFORT_ORDER)[number]);
      const rightIndex = EFFORT_ORDER.indexOf(right as (typeof EFFORT_ORDER)[number]);
      return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
    });
    return { slug: model, name: model, efforts };
  });
}

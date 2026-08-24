/**
 * Reader for `agy models`, the only list of Antigravity models that is true for
 * the CLI actually installed.
 *
 * Each row is `<id>\t<label>`: the value `--model` takes, then how Antigravity
 * writes it. Ronin keeps both verbatim. Reasoning effort lives inside the id
 * (`gemini-3.7-flash-high`) and the CLI rejects a family id unless `--effort`
 * comes with it, so a whole row is the only spelling we know is launchable —
 * which is why the label stays in the model name rather than being split off
 * into an option.
 *
 * @module AntigravityModels
 */

export interface AntigravityCliModel {
  readonly slug: string;
  readonly name: string;
}

// oxlint-disable-next-line no-control-regex -- stripping ANSI SGR codes requires matching ESC.
const ANSI_SGR = /\x1b\[[0-9;]*m/g;
/** `agy` marks the active model with a bullet in some builds. */
const LEADING_MARKER = /^(?:[*•-]\s+)+/u;
/** Column gap used by builds that align the two columns with spaces, not a tab. */
const COLUMN_GAP = /\s{2,}/u;
/**
 * Model ids carry a digit or a separator (`gemini-3.7-flash-high`, `gpt-5`).
 * Prose does not, which is how a space-aligned row is told apart from the
 * progress chatter that shares its shape once the tab is gone.
 */
const LOOKS_LIKE_MODEL_ID = /[\d._:/-]/u;

export function parseAntigravityModelLine(value: string): AntigravityCliModel | null {
  const stripped = value.replace(ANSI_SGR, "").trim();
  const unmarked = stripped.replace(LEADING_MARKER, "").trim();
  const tabIndex = unmarked.indexOf("\t");
  if (tabIndex >= 0) {
    const slug = unmarked.slice(0, tabIndex).trim();
    if (!slug || /\s/u.test(slug)) return null;
    const name = unmarked
      .slice(tabIndex + 1)
      .replace(LEADING_MARKER, "")
      .trim();
    return { slug, name: name || slug };
  }

  // Builds that align the columns with spaces instead of a tab would otherwise
  // report no models at all, and the picker falls back to a single hardcoded
  // guess when that happens. Progress chatter ("Fetching available models...")
  // still has to be turned away, so the id column has to look like an id.
  const gap = COLUMN_GAP.exec(unmarked);
  if (!gap) return null;
  const slug = unmarked.slice(0, gap.index).trim();
  if (!slug || /\s/u.test(slug) || !LOOKS_LIKE_MODEL_ID.test(slug)) return null;
  const name = unmarked
    .slice(gap.index + gap[0].length)
    .replace(LEADING_MARKER, "")
    .trim();
  return { slug, name: name || slug };
}

export function parseAntigravityModelLines(output: string): ReadonlyArray<AntigravityCliModel> {
  const models: AntigravityCliModel[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/g)) {
    const model = parseAntigravityModelLine(line);
    if (!model || seen.has(model.slug)) continue;
    seen.add(model.slug);
    models.push(model);
  }
  return models;
}

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

export function parseAntigravityModelLine(value: string): AntigravityCliModel | null {
  const stripped = value.replace(ANSI_SGR, "").trim();
  const tabIndex = stripped.indexOf("\t");
  // Progress chatter ("Fetching available models...") has no id column, and a
  // row without one is not something we could ever pass to `--model`.
  if (tabIndex < 0) return null;

  const slug = stripped.slice(0, tabIndex).replace(LEADING_MARKER, "").trim();
  if (!slug || /\s/u.test(slug)) return null;

  const name = stripped
    .slice(tabIndex + 1)
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

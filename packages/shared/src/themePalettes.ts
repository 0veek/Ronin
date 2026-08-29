/**
 * Theme ids that both the web client and the server need to agree on.
 *
 * The palettes themselves stay in `apps/web/src/themePalette.ts` — only the
 * identifiers live here, because the server has to reject a published theme
 * that would collide with a built-in without pulling in the web app's colour
 * machinery.
 */

export const PAPER_THEME_ID = "paper" as const;
export const GRAPHITE_THEME_ID = "graphite" as const;
export const TSUKIMI_THEME_ID = "tsukimi" as const;
export const AIZOME_THEME_ID = "aizome" as const;
export const URUSHI_THEME_ID = "urushi" as const;
export const SAKURA_THEME_ID = "t3-chat" as const;
export const GROVE_THEME_ID = "grove" as const;
export const OCEAN_THEME_ID = "ocean" as const;
export const EMBER_THEME_ID = "ember" as const;
export const IRIS_THEME_ID = "iris" as const;
export const OBSIDIAN_THEME_ID = "obsidian" as const;
export const MIDNIGHT_THEME_ID = "midnight" as const;
export const CARBON_THEME_ID = "carbon" as const;
export const NEBULA_THEME_ID = "nebula" as const;
export const OLED_VOID_THEME_ID = "oled-void" as const;
export const OLED_AZURE_THEME_ID = "oled-azure" as const;
export const OLED_PHOSPHOR_THEME_ID = "oled-phosphor" as const;
export const OLED_PLASMA_THEME_ID = "oled-plasma" as const;

/**
 * Every theme this build actually ships, in picker order. Only these resolve to
 * a palette, so this is what the CLI lists as selectable.
 */
export const BUILT_IN_THEME_IDS = [
  PAPER_THEME_ID,
  TSUKIMI_THEME_ID,
  GRAPHITE_THEME_ID,
  AIZOME_THEME_ID,
  URUSHI_THEME_ID,
  OBSIDIAN_THEME_ID,
  CARBON_THEME_ID,
  OLED_VOID_THEME_ID,
] as const;

/**
 * Ids this fork holds but no longer ships a palette for. They stay reserved so
 * a custom or published theme cannot take one and capture clients whose stored
 * preference still names it.
 */
export const RETIRED_THEME_IDS = [
  SAKURA_THEME_ID,
  GROVE_THEME_ID,
  OCEAN_THEME_ID,
  EMBER_THEME_ID,
  IRIS_THEME_ID,
  MIDNIGHT_THEME_ID,
  NEBULA_THEME_ID,
  OLED_AZURE_THEME_ID,
  OLED_PHOSPHOR_THEME_ID,
  OLED_PLASMA_THEME_ID,
] as const;

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];

/**
 * Ids older saves still carry. A stored preference may name one, so they stay
 * reserved even though nothing offers them any more: letting a custom or
 * published theme take one would capture clients that never chose it.
 */
export const LEGACY_THEME_IDS = [
  "t3-chat-dark",
  "t3-grove",
  "t3-ocean",
  "t3-ember",
  "t3-iris",
  "t3-obsidian",
  "t3-midnight",
  "t3-carbon",
  "t3-nebula",
  "t3-oled-void",
  "t3-oled-azure",
  "t3-oled-phosphor",
  "t3-oled-plasma",
] as const;

/**
 * Ids a theme may not take: the appearance keywords a stored preference uses,
 * every built-in, and the legacy aliases. Taking one would either be shadowed
 * by the built-in or capture clients that never chose it, so the client
 * library and the publish path both consult this set.
 */
export const RESERVED_THEME_IDS: ReadonlySet<string> = new Set([
  "system",
  "light",
  "dark",
  ...BUILT_IN_THEME_IDS,
  ...RETIRED_THEME_IDS,
  ...LEGACY_THEME_IDS,
]);

/**
 * Closed to a machine publishing a theme. Identical to the reserved set today;
 * kept separate because publishing and client-side resolution are different
 * questions, and upstream distinguishes them for its mobile default.
 */
export const UNPUBLISHABLE_THEME_IDS: ReadonlySet<string> = RESERVED_THEME_IDS;

import { SETTINGS_PAGE_META, type SettingsPath } from "./settingsNavigation";

export type { SettingsPath } from "./settingsNavigation";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
}

/**
 * Section labels in sidebar order. The sidebar nav and the search-result
 * subtitles both render from this record, so each label exists once.
 */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/general": SETTINGS_PAGE_META["/settings/general"].label,
  "/settings/appearance": SETTINGS_PAGE_META["/settings/appearance"].label,
  "/settings/keybindings": SETTINGS_PAGE_META["/settings/keybindings"].label,
  "/settings/speech-to-text": SETTINGS_PAGE_META["/settings/speech-to-text"].label,
  "/settings/providers": SETTINGS_PAGE_META["/settings/providers"].label,
  "/settings/skills": SETTINGS_PAGE_META["/settings/skills"].label,
  "/settings/source-control": SETTINGS_PAGE_META["/settings/source-control"].label,
  "/settings/connections": SETTINGS_PAGE_META["/settings/connections"].label,
  "/settings/archived": SETTINGS_PAGE_META["/settings/archived"].label,
};

/**
 * Every searchable setting, in result order. This catalog is the single
 * source of truth for anchor ids and visible titles: panels render both via
 * `searchableSetting`, so a retitle (or, later, a translation pass) happens
 * here once instead of separately in the panel and the index.
 */
export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "speech-to-text",
    title: "Dictation",
    to: "/settings/speech-to-text",
  },
  {
    id: "speech-to-text-deepgram",
    title: "Deepgram API key",
    to: "/settings/speech-to-text",
  },
  {
    id: "speech-to-text-groq",
    title: "Groq API key",
    to: "/settings/speech-to-text",
  },
  {
    id: "speech-to-text-openrouter",
    title: "OpenRouter API key",
    to: "/settings/speech-to-text",
  },
  {
    id: "color-scheme",
    title: "Color scheme",
    to: "/settings/appearance",
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "theme",
    title: "Themes",
    to: "/settings/appearance",
    // Theme cards live directly under the scheme tiles; the section is the
    // stable scroll destination for both.
    targetId: "appearance",
  },
  {
    id: "environment-identification",
    title: "Environment identification",
    to: "/settings/appearance",
    // The setting is stage-dependent, so its parent section is the stable destination.
    targetId: "appearance",
  },
  {
    id: "interface-font",
    title: "Interface font",
    to: "/settings/appearance",
  },
  {
    id: "prompt-font",
    title: "Prompt font",
    to: "/settings/appearance",
  },
  {
    id: "code-font",
    title: "Code font",
    to: "/settings/appearance",
  },
  {
    id: "terminal-font",
    title: "Terminal font",
    to: "/settings/appearance",
  },
  {
    id: "font-smoothing",
    title: "Font smoothing",
    to: "/settings/appearance",
  },
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/appearance",
  },
  {
    id: "project-grouping",
    title: "Project grouping",
    to: "/settings/general",
  },
  {
    id: "auto-settle-inactive-threads",
    title: "Auto-settle inactive threads",
    to: "/settings/general",
  },
  {
    id: "auto-settle-merged-threads",
    title: "Auto-settle merged threads",
    to: "/settings/general",
  },
  {
    id: "agent-notifications",
    title: "Agent notifications",
    to: "/settings/general",
  },
  {
    id: "time-format",
    title: "Time format",
    to: "/settings/general",
  },
  {
    id: "hide-whitespace-changes",
    title: "Hide whitespace changes",
    to: "/settings/general",
  },
  {
    id: "provider-update-checks",
    title: "Provider update checks",
    to: "/settings/general",
  },
  {
    id: "new-threads",
    title: "New threads",
    to: "/settings/general",
  },
  {
    id: "start-from-origin",
    title: "Start from origin",
    to: "/settings/general",
    targetId: "new-threads",
  },
  {
    id: "add-project-starts-in",
    title: "Add project starts in",
    to: "/settings/general",
  },
  {
    id: "archive-confirmation",
    title: "Archive confirmation",
    to: "/settings/general",
  },
  {
    id: "delete-confirmation",
    title: "Delete confirmation",
    to: "/settings/general",
  },
  {
    id: "text-generation-model",
    title: "Text generation model",
    to: "/settings/general",
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    title: "Plan mode (legacy)",
    to: "/settings/general",
  },
  {
    id: "keybindings",
    title: "Keybindings",
    to: "/settings/keybindings",
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
  },
  {
    id: "agent-skills",
    title: "Agent skills",
    to: "/settings/skills",
  },
  {
    id: "portable-skills",
    title: "Ronin skills folder",
    to: "/settings/skills",
    targetId: "agent-skills",
  },
  {
    id: "source-control",
    title: "Source control",
    to: "/settings/source-control",
  },
  {
    id: "remote-environments",
    title: "Remote environments",
    to: "/settings/connections",
  },
  {
    id: "archive",
    title: "Archived threads",
    to: "/settings/archived",
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = Object.fromEntries(
  SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item]),
) as Readonly<Record<SettingsSearchItemId, SettingsSearchItem>>;

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart.
 */
export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID[id];
  return { id: anchorId, title };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function settingsSearchScore(item: SettingsSearchItem, normalizedQuery: string): number | null {
  const title = normalizeSearchText(item.title);
  if (title === normalizedQuery) return 0;
  if (title.startsWith(normalizedQuery)) return 1;
  if (title.includes(normalizedQuery)) return 2;

  const page = SETTINGS_PAGE_META[item.to];
  const secondaryText = normalizeSearchText(
    [page.label, page.description, ...page.searchTerms].join(" "),
  );
  const queryTerms = normalizedQuery.split(" ");
  return queryTerms.every((term) => secondaryText.includes(term)) ? 3 : null;
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];

  return items
    .map((item, index) => ({ index, item, score: settingsSearchScore(item, normalizedQuery) }))
    .filter(
      (result): result is { index: number; item: SettingsSearchItem; score: number } =>
        result.score !== null,
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ item }) => item);
}

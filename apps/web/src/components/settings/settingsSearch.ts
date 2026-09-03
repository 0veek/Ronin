import { isElectron } from "~/env";
import { isMacPlatform, normalizeSearchText } from "~/lib/utils";
import { SETTINGS_PAGE_META, type SettingsPath } from "./settingsNavigation";

export type { SettingsPath } from "./settingsNavigation";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  /** Descriptions, option labels, and aliases people may remember instead of the title. */
  readonly searchTerms?: ReadonlyArray<string>;
  // Its row only renders in the desktop app, so a browser result would land on
  // an anchor that isn't there.
  readonly desktopOnly?: boolean;
  readonly macOnly?: boolean;
  /** The auto-settle rows only render against a server that settles threads itself. */
  readonly requiresThreadAutoSettlement?: boolean;
}

/**
 * Whether the environment a search runs against actually renders each
 * conditional row. A result that scrolls to an anchor nothing mounted is worse
 * than no result, so the catalog is filtered before it is searched.
 */
export interface SettingsSearchAvailability {
  readonly hasThreadAutoSettlement: boolean;
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
  "/settings/automations": SETTINGS_PAGE_META["/settings/automations"].label,
  "/settings/build-systems": SETTINGS_PAGE_META["/settings/build-systems"].label,
  "/settings/integrations": SETTINGS_PAGE_META["/settings/integrations"].label,
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
    searchTerms: ["appearance light dark system mode"],
    to: "/settings/appearance",
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "theme",
    title: "Themes",
    searchTerms: ["appearance colors palette custom import"],
    to: "/settings/appearance",
    // Theme cards live directly under the scheme tiles; the section is the
    // stable scroll destination for both.
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    title: "Contrast",
    searchTerms: ["colors borders interface"],
    to: "/settings/appearance",
  },
  {
    id: "panel-animations",
    title: "Panel animations",
    to: "/settings/appearance",
  },
  {
    id: "environment-identification",
    title: "Environment identification",
    searchTerms: ["dev nightly artwork pill label hide none"],
    to: "/settings/appearance",
    // The setting is stage-dependent, so its parent section is the stable destination.
    targetId: "appearance",
  },
  {
    id: "interface-font",
    title: "Interface font",
    searchTerms: ["typography family size system sans"],
    to: "/settings/appearance",
  },
  {
    id: "prompt-font",
    title: "Prompt font",
    searchTerms: ["typography family size composer input"],
    to: "/settings/appearance",
  },
  {
    id: "code-font",
    title: "Code font",
    searchTerms: ["typography family size monospace code blocks diffs file previews"],
    to: "/settings/appearance",
  },
  {
    id: "terminal-font",
    title: "Terminal font",
    searchTerms: ["typography family size monospace output"],
    to: "/settings/appearance",
  },
  {
    id: "font-smoothing",
    title: "Font smoothing",
    searchTerms: ["typography text grayscale anti aliasing macos thin"],
    to: "/settings/appearance",
    macOnly: true,
  },
  {
    id: "word-wrap",
    title: "Word wrap",
    searchTerms: ["long lines code blocks tables diffs file previews"],
    to: "/settings/appearance",
  },
  {
    id: "chat-width",
    title: "Chat width",
    to: "/settings/appearance",
    targetId: "appearance",
  },
  {
    id: "project-grouping",
    title: "Project grouping",
    searchTerms: ["combine matching repositories environments sidebar"],
    to: "/settings/general",
  },
  {
    id: "auto-settle-inactive-threads",
    title: "Auto-settle inactive threads",
    searchTerms: ["sidebar inactivity days no activity automatically"],
    to: "/settings/general",
    requiresThreadAutoSettlement: true,
  },
  {
    id: "auto-settle-merged-threads",
    title: "Auto-settle merged threads",
    searchTerms: ["pull request merge closed automatically sidebar"],
    to: "/settings/general",
    requiresThreadAutoSettlement: true,
  },
  {
    id: "agent-notifications",
    title: "Agent notifications",
    to: "/settings/general",
  },
  {
    id: "agent-sounds",
    title: "Agent sounds",
    to: "/settings/general",
  },
  {
    id: "days-before-auto-settle",
    title: "Days of inactivity before auto-settle",
    to: "/settings/general",
    targetId: "auto-settle-inactive-threads",
    searchTerms: ["thread timeout activity sidebar"],
    requiresThreadAutoSettlement: true,
  },
  {
    id: "time-format",
    title: "Time format",
    searchTerms: ["timestamp clock locale system browser os 12 hour 24 hour"],
    to: "/settings/general",
  },
  {
    id: "hide-whitespace-changes",
    title: "Hide whitespace changes",
    searchTerms: ["diff ignore spaces edits default"],
    to: "/settings/general",
  },
  {
    id: "proactive-panels",
    title: "Proactive panels",
    searchTerms: ["automatically open diff pull request pr right panel agent completion"],
    to: "/settings/general",
  },
  {
    id: "provider-update-checks",
    title: "Provider update checks",
    searchTerms: ["installed cli versions newer available codex claude cursor grok opencode"],
    to: "/settings/general",
  },
  {
    id: "continue-threads-after-server-update",
    title: "Continue threads after server updates",
    to: "/settings/general",
    searchTerms: ["resume running active work restart desktop update automatically"],
  },
  {
    id: "resume-after-limit",
    title: "Resume after limit resets",
    to: "/settings/general",
  },
  {
    id: "new-threads",
    title: "New threads",
    searchTerms: ["default workspace mode draft local worktree"],
    to: "/settings/general",
  },
  {
    id: "start-from-origin",
    title: "Start from origin",
    searchTerms: ["new worktrees latest matching remote branch local"],
    to: "/settings/general",
    targetId: "new-threads",
  },
  {
    id: "add-project-starts-in",
    title: "Add project starts in",
    searchTerms: ["base directory folder browser path home"],
    to: "/settings/general",
  },
  {
    id: "unpin-confirmation",
    title: "Unpin confirmation",
    searchTerms: ["ask before thread pinned section"],
    to: "/settings/general",
  },
  {
    id: "archive-confirmation",
    title: "Archive confirmation",
    searchTerms: ["ask before thread second click inline action"],
    to: "/settings/general",
  },
  {
    id: "delete-confirmation",
    title: "Delete confirmation",
    searchTerms: ["ask before thread chat history"],
    to: "/settings/general",
  },
  {
    id: "quit-confirmation",
    title: "Quit shortcut",
    searchTerms: ["confirmation desktop app exit direct hold double click press twice"],
    to: "/settings/general",
    desktopOnly: true,
  },
  {
    id: "text-generation-model",
    title: "Text generation model",
    searchTerms: ["generated thread titles source control content default provider"],
    to: "/settings/general",
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    searchTerms: ["logs traces processes resource history failures spans cpu memory"],
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    title: "Plan mode (legacy)",
    searchTerms: ["build plan composer old"],
    to: "/settings/general",
  },
  {
    id: "legacy-context-window-indicator",
    title: "Context window indicator (legacy)",
    searchTerms: ["composer meter usage tokens circle old"],
    to: "/settings/general",
  },
  {
    id: "keybindings",
    title: "Keybindings",
    searchTerms: ["keyboard shortcuts hotkeys commands bindings json"],
    to: "/settings/keybindings",
  },
  {
    id: "providers",
    title: "Providers",
    searchTerms: [
      "agents cli codex claude cursor grok opencode instances authentication api key models configuration binary path config directory endpoint arguments environment variables display name accent color custom favorite hidden auto compact",
    ],
    to: "/settings/providers",
  },
  {
    id: "agent-skills",
    title: "Agent skills",
    to: "/settings/skills",
  },
  {
    id: "automations",
    title: "Automations",
    to: "/settings/automations",
  },
  {
    id: "build-systems",
    title: "Build systems",
    to: "/settings/build-systems",
  },
  {
    id: "portable-skills",
    title: "Ronin skills folder",
    to: "/settings/skills",
    targetId: "agent-skills",
  },
  {
    id: "agent-browser-access",
    title: "Agent browser access",
    searchTerms: ["allow open drive preview tools sessions"],
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-profiles",
    title: "Browser profiles",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-profile",
    title: "Default browser profile",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-viewport",
    title: "Default browser viewport",
    searchTerms: ["preview size width height device desktop mobile rotate"],
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-zoom",
    title: "Default browser zoom",
    searchTerms: ["preview page scale tabs percent"],
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-appearance",
    title: "Default browser appearance",
    searchTerms: ["preview color scheme light dark system os"],
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-recording-frame-rate",
    title: "Browser recording frame rate",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-auto-show-floating-preview",
    title: "Auto-show floating preview",
    searchTerms: ["agent opens browser pop into view hide"],
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "source-control",
    title: "Source control",
    searchTerms: [
      "version control git github gitlab bitbucket azure devops hosting integrations credentials scan server environment",
    ],
    to: "/settings/source-control",
  },
  {
    id: "remote-environments",
    title: "Remote environments",
    searchTerms: ["add pair backend host code ssh config agent tunnel saved"],
    to: "/settings/connections",
  },
  {
    id: "archive",
    title: "Archived threads",
    searchTerms: ["restore reopen deleted history projects"],
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

export function filterAvailableSettingsSearchItems(
  availability: SettingsSearchAvailability,
): ReadonlyArray<SettingsSearchItem> {
  const items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS;
  return items.filter(
    (item) => !item.requiresThreadAutoSettlement || availability.hasThreadAutoSettlement,
  );
}

/**
 * Lower is better. A setting's own terms beat the page's, so "dark mode" lands
 * on Color scheme rather than on every row the Appearance page happens to hold.
 */
function settingsSearchScore(
  item: SettingsSearchItem,
  normalizedQuery: string,
  queryTerms: ReadonlyArray<string>,
): number | null {
  const title = normalizeSearchText(item.title);
  if (title === normalizedQuery) return 0;
  if (title.startsWith(normalizedQuery)) return 1;
  if (title.includes(normalizedQuery)) return 2;
  if (queryTerms.every((term) => title.includes(term))) return 3;

  const itemTerms = (item.searchTerms ?? []).map(normalizeSearchText);
  if (itemTerms.some((field) => field.includes(normalizedQuery))) return 4;
  const itemText = [title, ...itemTerms].join(" ");
  if (itemTerms.length > 0 && queryTerms.every((term) => itemText.includes(term))) return 5;

  const page = SETTINGS_PAGE_META[item.to];
  const secondaryText = normalizeSearchText(
    [page.label, page.description, ...page.searchTerms].join(" "),
  );
  return queryTerms.every((term) => secondaryText.includes(term)) ? 6 : null;
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const queryTerms = normalizedQuery.split(" ");
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;

  return items
    .filter(
      (item) =>
        (isElectron || item.desktopOnly !== true) && (!item.macOnly || isMacPlatform(platform)),
    )
    .map((item, index) => ({
      index,
      item,
      score: settingsSearchScore(item, normalizedQuery, queryTerms),
    }))
    .filter(
      (result): result is { index: number; item: SettingsSearchItem; score: number } =>
        result.score !== null,
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ item }) => item);
}

import { describe, expect, it } from "vite-plus/test";

import {
  getSettingsPageMeta,
  SETTINGS_NAV_GROUPS,
  SETTINGS_PAGE_META,
  type SettingsPath,
} from "./settingsNavigation";

describe("settings navigation", () => {
  it("places every public settings page in exactly one navigation group", () => {
    const groupedPaths = SETTINGS_NAV_GROUPS.flatMap((group) => group.paths);
    const publicPaths = Object.keys(SETTINGS_PAGE_META).filter(
      (path): path is SettingsPath => path !== "/settings/diagnostics",
    );

    expect(new Set(groupedPaths).size).toBe(groupedPaths.length);
    expect([...groupedPaths].sort()).toEqual(publicPaths.sort());
  });

  it("resolves route metadata after normalizing a trailing slash", () => {
    expect(getSettingsPageMeta("/settings/appearance/")?.label).toBe("Appearance");
    expect(getSettingsPageMeta("/threads")).toBeNull();
  });
});

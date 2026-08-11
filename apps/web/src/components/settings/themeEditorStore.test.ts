import { afterEach, describe, expect, it } from "vite-plus/test";

import { GRAPHITE_THEME_ID, PAPER_THEME_ID } from "../../themePalette";
import { toggleThemeEditorForTheme, useThemeEditorStore } from "./themeEditorStore";

afterEach(() => {
  useThemeEditorStore.getState().closeThemeEditor();
});

describe("toggleThemeEditorForTheme", () => {
  it("opens a new editor seeded from the theme active for the current appearance", () => {
    toggleThemeEditorForTheme({
      theme: PAPER_THEME_ID,
      themeHalves: { dark: GRAPHITE_THEME_ID },
      initialAppearance: "dark",
    });

    expect(useThemeEditorStore.getState().session).toMatchObject({
      editingThemeId: null,
      seedThemeId: GRAPHITE_THEME_ID,
      seedName: null,
      initialAppearance: "dark",
    });
  });

  it("closes an open editor", () => {
    toggleThemeEditorForTheme({
      theme: PAPER_THEME_ID,
      themeHalves: null,
      initialAppearance: "light",
    });
    toggleThemeEditorForTheme({
      theme: PAPER_THEME_ID,
      themeHalves: null,
      initialAppearance: "light",
    });

    expect(useThemeEditorStore.getState().session).toBeNull();
  });
});

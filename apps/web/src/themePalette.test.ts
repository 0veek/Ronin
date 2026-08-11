import { describe, expect, it, vi } from "vite-plus/test";

import {
  applyThemeColorPreview,
  applyThemePalette,
  getThemeColorsForMode,
  getThemeDefinition,
  getThemeModes,
  getThemePreviewSidebarArtwork,
  getThemePreferenceMode,
  isKnownThemePreference,
  getCustomThemes,
  invalidateCustomThemes,
  installCustomTheme,
  canonicalThemePreference,
  parseThemeFile,
  parseThemeHalves,
  resolveDesktopTheme,
  resolveThemeAppearance,
  serializeThemeFile,
  subscribeToThemePreview,
  subscribeToCustomThemes,
  CARBON_THEME,
  GRAPHITE_THEME,
  OBSIDIAN_THEME,
  OLED_VOID_THEME,
  PAPER_THEME,
  updateCustomTheme,
  CUSTOM_THEMES_STORAGE_KEY,
  createManagedThemeColors,
  createVividThemeColors,
  getDefaultThemeColors,
  THEME_FILE_VERSION,
} from "./themePalette";

function contrastRatio(first: string, second: string): number {
  const toRgb = (value: string) => {
    const hex = value.slice(1);
    return [0, 1, 2].map(
      (channel) => Number.parseInt(hex.slice(channel * 2, channel * 2 + 2), 16) / 255,
    );
  };
  const luminance = (value: string) =>
    toRgb(value)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("theme files", () => {
  it("derives a readable palette from extreme simple-editor colors", () => {
    const light = createManagedThemeColors("light", "#111827", "#ffff00");
    const dark = createManagedThemeColors("dark", "#ffffff", "#ffff00");
    const darkDefaults = getDefaultThemeColors("dark");

    expect(light.canvas).not.toBe("#111827");
    expect(dark.canvas).not.toBe("#ffffff");
    expect(contrastRatio(light.accent, light.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.accent, dark.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.textMuted, light.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.textMuted, dark.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light.textMuted, light.canvas)).toBeLessThan(5.5);
    expect(contrastRatio(dark.textMuted, dark.canvas)).toBeLessThan(5.5);
    expect(contrastRatio(light.textMuted, light.canvas)).toBeCloseTo(4.705, 1);
    expect(contrastRatio(dark.textMuted, dark.canvas)).toBeCloseTo(5.082, 1);
    expect(light.secondaryLabel).toBe(light.textMuted);
    expect(dark.secondaryLabel).toBe(dark.textMuted);
    expect(contrastRatio(light.accentForeground, light.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dark.accentForeground, dark.accent)).toBeGreaterThanOrEqual(4.5);
    // Status colors fall back to Ronin's standard red and amber rather than
    // the flagship palette's, so no generated theme inherits a brand tint.
    const channels = (value: string) =>
      [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as [
        number,
        number,
        number,
      ];
    for (const colors of [light, dark]) {
      const [errorRed, errorGreen, errorBlue] = channels(colors.error);
      // Red leads by a wide margin; the old default was a pink whose blue sat
      // close behind its red.
      expect(errorRed).toBeGreaterThan(errorGreen * 2);
      expect(errorRed).toBeGreaterThan(errorBlue * 2);
      expect(contrastRatio(colors.error, "#ffffff")).toBeGreaterThanOrEqual(2.5);
      expect(contrastRatio(colors.errorForeground, colors.errorSurface)).toBeGreaterThanOrEqual(
        4.5,
      );
      const [warnRed, warnGreen, warnBlue] = channels(colors.warning);
      expect(warnRed).toBeGreaterThan(warnBlue);
      expect(warnGreen).toBeGreaterThan(warnBlue);
    }
    expect(dark.error).not.toBe(darkDefaults.error);
  });

  it("derives readable, distinctive vivid palettes from exact seeds", () => {
    const seeds: ReadonlyArray<["light" | "dark", string, string]> = [
      ["light", "#f4f9f2", "#1d8a4e"],
      ["dark", "#101a2c", "#4f8fe8"],
      ["dark", "#211a23", "#df5398"],
      ["light", "#fdf6ec", "#c2571b"],
      // Inverted canvases: the palette follows the picked color, not the slot.
      ["light", "#111827", "#8ab4f8"],
      ["dark", "#f5ecf5", "#a84370"],
    ];
    for (const [appearance, canvas, accent] of seeds) {
      const colors = createVividThemeColors(appearance, canvas, accent);
      // Exact seeds are honored.
      expect(colors.canvas).toBe(canvas);
      expect(colors.accent).toBe(accent);
      // Readability is solved per surface.
      expect(contrastRatio(colors.text, colors.canvas)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(colors.textMuted, colors.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.textMuted, colors.canvas)).toBeLessThan(5.5);
      expect(contrastRatio(colors.mutedForeground, colors.muted)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.placeholder, colors.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
      expect(colors.secondaryLabel).toBe(colors.textMuted);
      expect(contrastRatio(colors.accentForeground, colors.accent)).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(colors.messageActionForeground, colors.messageAction),
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.messageForeground, colors.messageSurface)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(colors.secondaryForeground, colors.secondary)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(colors.sidebarForeground, colors.sidebar)).toBeGreaterThanOrEqual(4.5);
      // The companion action is a distinct voice, not the accent again.
      expect(colors.messageAction).not.toBe(colors.accent);
      // Update family follows the theme, not the default palette.
      expect(colors.update).toBe(accent);
    }
  });

  it("keys status colors off the canvas, not the appearance slot", () => {
    // Inverted seeds: a dark canvas in the light slot must still get the dark
    // status pair, or the alert foreground lands on a dark surface unreadable.
    const inverted = [
      createVividThemeColors("light", "#111827", "#8ab4f8"),
      createVividThemeColors("dark", "#f5ecf5", "#a84370"),
      createManagedThemeColors("light", "#0d1117", "#69b1ff", { exactSeeds: true }),
      createManagedThemeColors("dark", "#fdfdfd", "#c2571b", { exactSeeds: true }),
    ];
    for (const colors of inverted) {
      expect(contrastRatio(colors.errorForeground, colors.errorSurface)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(colors.warningForeground, colors.warningSurface)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("merges a small user file onto the matching contrast-safe base palette", () => {
    const theme = parseThemeFile({
      version: THEME_FILE_VERSION,
      name: "Ocean dusk",
      appearance: "dark",
      colors: {
        canvas: "#07152f",
        accent: "#67c2ff",
      },
    });

    expect(theme).toMatchObject({
      id: "ocean-dusk",
      label: "Ocean dusk",
      appearance: "dark",
      colors: {
        canvas: "#07152f",
        accent: "#67c2ff",
        placeholder: "#968d9f",
      },
    });
  });

  it("rejects unknown roles and invalid color values", () => {
    expect(() =>
      parseThemeFile({
        version: THEME_FILE_VERSION,
        name: "Broken",
        appearance: "light",
        colors: { background: "#ffffff" },
      }),
    ).toThrow('"background" is not a supported theme color role.');

    expect(() =>
      parseThemeFile({
        version: THEME_FILE_VERSION,
        name: "Broken",
        appearance: "light",
        colors: { accent: "var(--danger)" },
      }),
    ).toThrow('The color for "accent" must be a hex color');
  });

  it("serializes a theme back into the importable file shape", () => {
    const serialized = serializeThemeFile(PAPER_THEME);
    expect(JSON.parse(serialized)).toMatchObject({
      version: THEME_FILE_VERSION,
      id: PAPER_THEME.id,
      name: PAPER_THEME.label,
      appearance: "light",
    });
  });

  it("keeps sidebar artwork opt-in through theme files", () => {
    const withoutArtwork = parseThemeFile({
      version: THEME_FILE_VERSION,
      name: "Plain sidebar",
      appearance: "light",
      colors: { accent: "#5b6cff" },
    });
    const withArtwork = parseThemeFile({
      version: THEME_FILE_VERSION,
      name: "Art sidebar",
      appearance: "light",
      colors: { accent: "#5b6cff" },
      sidebarArtwork: true,
    });

    expect(withoutArtwork.sidebarArtwork).toBeUndefined();
    expect(withArtwork.sidebarArtwork).toBe(true);
    expect(JSON.parse(serializeThemeFile(withArtwork)).sidebarArtwork).toBe(true);
  });

  it("publishes sidebar artwork changes from the live theme preview", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToThemePreview(listener);
    vi.stubGlobal("document", {
      documentElement: {
        classList: { toggle: vi.fn() },
        dataset: {},
        style: { removeProperty: vi.fn(), setProperty: vi.fn() },
      },
    });

    applyThemeColorPreview(PAPER_THEME.colors, "light", true);
    expect(getThemePreviewSidebarArtwork()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    applyThemePalette("system");
    expect(getThemePreviewSidebarArtwork()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    vi.unstubAllGlobals();
  });

  it("keeps optional light and dark palettes under one theme id", () => {
    const theme = parseThemeFile({
      version: THEME_FILE_VERSION,
      id: "aurora",
      name: "Aurora",
      appearance: "light",
      colors: { canvas: "#f8fbff", text: "#10243d" },
      variants: {
        dark: { canvas: "#101827", text: "#eef5ff" },
      },
    });

    expect(getThemeModes(theme)).toEqual(["light", "dark"]);
    expect(getThemeColorsForMode(theme, "dark")).toMatchObject({
      canvas: "#101827",
      text: "#eef5ff",
    });
    expect(getThemeModes(PAPER_THEME)).toEqual(["light", "dark"]);
    expect(resolveThemeAppearance(PAPER_THEME.id, true, true)).toBe("dark");
    expect(resolveDesktopTheme(PAPER_THEME.id, true)).toBe("system");
    expect(resolveThemeAppearance(PAPER_THEME.id, false, false, "dark")).toBe("dark");
    expect(resolveDesktopTheme(PAPER_THEME.id, false, "dark")).toBe("dark");
    expect(JSON.parse(serializeThemeFile(theme)).variants.dark).toMatchObject({
      canvas: "#101827",
      text: "#eef5ff",
    });
  });

  // The Sakura preset was retired, but its two colour tables stayed on as the
  // structural role base every managed theme spreads over -- so the roles a
  // generated palette never sets (error, warning) still resolve to something
  // readable. Pinning them here keeps that base from drifting unnoticed.
  it("keeps the default role base faithful and readable", () => {
    expect(getDefaultThemeColors("light")).toMatchObject({
      canvas: "#fdf7fd",
      chrome: "#fdf7fd",
      toolbarBorder: "#efbdeb",
      toolbarControl: "#f3e6f5",
      toolbarControlHover: "#eccfe3",
      surfaceRaised: "#fdfafd",
      input: "#e7c1dc",
      focus: "#db2777",
      messageSurface: "#f7def2",
      codeBackground: "#f5ecf9",
      codeForeground: "#673c8b",
      accentSurface: "#f3e6f5",
      sidebar: "#f2e1f4",
    });
    expect(getDefaultThemeColors("dark")).toMatchObject({
      canvas: "#1f1a24",
      chrome: "#1f1a24",
      surface: "#29232d",
      surfaceRaised: "#2c2631",
      input: "#302029",
      focus: "#db2777",
      messageSurface: "#2b2431",
      codeBackground: "#1f1a24",
      sidebar: "#171018",
      sidebarBorder: "#322028",
    });

    for (const mode of ["light", "dark"] as const) {
      const colors = getDefaultThemeColors(mode);
      expect(contrastRatio(colors.text, colors.canvas)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(colors.textMuted, colors.canvas)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.messageForeground, colors.messageSurface)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(colors.secondaryForeground, colors.secondary)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(colors.sidebarForeground, colors.sidebar)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.accentForeground, colors.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("includes the dual-mode maintainer themes", () => {
    const maintainerThemes = [
      PAPER_THEME,
      GRAPHITE_THEME,
      OBSIDIAN_THEME,
      CARBON_THEME,
      OLED_VOID_THEME,
    ];
    const oledThemes = new Set([OLED_VOID_THEME.id]);
    for (const theme of maintainerThemes) {
      expect(getThemeDefinition(theme.id)).toBe(theme);
      expect(getThemeModes(theme)).toEqual(["light", "dark"]);
      expect(theme.colors.accent).toMatch(/^#[0-9a-f]{6}$/i);
      const oppositeAppearance = theme.appearance === "light" ? "dark" : "light";
      expect(theme.variants?.[oppositeAppearance]?.accent).toMatch(/^#[0-9a-f]{6}$/i);

      for (const mode of ["light", "dark"] as const) {
        const colors = getThemeColorsForMode(theme, mode);
        expect(colors).not.toBeNull();
        expect(contrastRatio(colors!.text, colors!.canvas)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors!.textMuted, colors!.canvas)).toBeGreaterThanOrEqual(4.5);
        // OLED dark uses exact pure-black seeds, so muted text contrast lands
        // higher than the managed charcoal envelope used by other presets.
        if (!(oledThemes.has(theme.id) && mode === "dark")) {
          expect(contrastRatio(colors!.textMuted, colors!.canvas)).toBeLessThan(5.5);
          expect(contrastRatio(colors!.textMuted, colors!.canvas)).toBeCloseTo(
            mode === "dark" ? 5.082 : 4.705,
            1,
          );
        }
        if (oledThemes.has(theme.id) && mode === "dark") {
          expect(colors!.canvas).toBe("#000000");
          expect(colors!.chrome).toBe("#000000");
          expect(colors!.sidebar).toBe("#000000");
          expect(colors!.codeBackground).toBe("#000000");
          expect(colors!.terminalBackground).toBe("#000000");
        }
        expect(contrastRatio(colors!.accentForeground, colors!.accent)).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(colors!.toolbarControlForeground, colors!.toolbarControl),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(colors!.messageForeground, colors!.messageSurface),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(colors!.messageActionForeground, colors!.messageAction),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(colors!.messageActionForeground, colors!.messageActionHover),
        ).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors!.mutedForeground, colors!.muted)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(colors!.placeholder, colors!.surfaceRaised)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it("rejects a variant that repeats the base appearance", () => {
    expect(() =>
      parseThemeFile({
        version: THEME_FILE_VERSION,
        name: "Duplicate light",
        appearance: "light",
        colors: { canvas: "#f8fbff" },
        variants: { light: { canvas: "#101827" } },
      }),
    ).toThrow('Theme variants must not repeat the base appearance "light".');
  });

  it("keeps a single-mode theme on its only palette", () => {
    const theme = parseThemeFile({
      version: THEME_FILE_VERSION,
      id: "midnight-slate",
      name: "Midnight Slate",
      appearance: "dark",
      colors: { canvas: "#111827", messageAction: "#2563eb" },
    });

    expect(getThemeModes(theme)).toEqual(["dark"]);
    expect(getThemeColorsForMode(theme, "dark")).toMatchObject({ canvas: "#111827" });
    expect(getThemeColorsForMode(theme, "light")).toBeNull();
  });

  it("invalidates cached themes when another tab clears localStorage", () => {
    let storedThemes: string | null = JSON.stringify([
      {
        id: "ocean-dusk",
        label: "Ocean dusk",
        appearance: "dark",
        colors: { canvas: "#07152f" },
      },
    ]);
    let storageHandler: ((event: StorageEvent) => void) | undefined;
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === "storage") storageHandler = listener;
      },
      removeEventListener: vi.fn(),
      localStorage: {
        getItem: (key: string) => (key === CUSTOM_THEMES_STORAGE_KEY ? storedThemes : null),
      },
    });

    invalidateCustomThemes();
    expect(getCustomThemes()).toHaveLength(1);
    const listener = vi.fn();
    const unsubscribe = subscribeToCustomThemes(listener);

    storedThemes = null;
    storageHandler?.({ key: null } as StorageEvent);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCustomThemes()).toEqual([]);
    unsubscribe();
    invalidateCustomThemes();
    vi.unstubAllGlobals();
  });

  it("updates a personal theme without changing its id", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });

    invalidateCustomThemes();
    const createdTheme = installCustomTheme(
      parseThemeFile({
        version: THEME_FILE_VERSION,
        id: "aurora",
        name: "Aurora",
        appearance: "light",
        colors: { canvas: "#f8fbff", accent: "#5b6cff" },
        sidebarArtwork: true,
      }),
    );
    const updatedTheme = updateCustomTheme({
      ...createdTheme,
      label: "Aurora Night",
      colors: { ...createdTheme.colors, accent: "#7c3aed" },
    });

    expect(updatedTheme).toMatchObject({
      id: "aurora",
      label: "Aurora Night",
      sidebarArtwork: true,
    });
    invalidateCustomThemes();
    expect(getCustomThemes()).toEqual([updatedTheme]);
    expect(JSON.parse(stored.get(CUSTOM_THEMES_STORAGE_KEY) ?? "[]")[0]).toMatchObject({
      id: "aurora",
      label: "Aurora Night",
      sidebarArtwork: true,
    });

    vi.unstubAllGlobals();
    invalidateCustomThemes();
  });
});

describe("stored theme preferences", () => {
  it("lets a configured half unlock an appearance the base theme lacks", () => {
    // Light-only base: without halves, dark requests fall back to light.
    // "paper" is a built-in id now, so the custom fixture needs its own stock.
    const lightOnly = parseThemeFile({
      version: THEME_FILE_VERSION,
      id: "vellum",
      name: "Vellum",
      appearance: "light",
      colors: { canvas: "#f8fbff" },
    });
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) =>
          key === CUSTOM_THEMES_STORAGE_KEY ? JSON.stringify([lightOnly]) : null,
      },
    });
    invalidateCustomThemes();
    try {
      expect(resolveThemeAppearance("vellum", true, true)).toBe("light");
      const halves = { dark: GRAPHITE_THEME.id };
      expect(resolveThemeAppearance("vellum", true, true, undefined, halves)).toBe("dark");
      expect(resolveThemeAppearance("vellum", false, false, "dark", halves)).toBe("dark");
      expect(resolveDesktopTheme("vellum", true, undefined, halves)).toBe("system");
    } finally {
      vi.unstubAllGlobals();
      invalidateCustomThemes();
    }
  });

  // The retired presets are the interesting case now: an install pinned to one
  // must fall through to the runtime default rather than throw or render bare.
  it("drops a preference pinned to a retired preset", () => {
    for (const retired of ["t3-chat", "t3-chat-dark", "grove", "ocean", "ember", "iris"]) {
      expect(getThemeDefinition(retired)).toBeNull();
      expect(isKnownThemePreference(retired)).toBe(false);
    }
    // The alias table survives them: it still normalizes, it just no longer
    // lands on a definition. The dark-variant alias keeps its raw form,
    // because it carries a mode hint and not only an id.
    expect(canonicalThemePreference("t3-grove")).toBe("grove");
    expect(canonicalThemePreference("t3-chat-dark")).toBe("t3-chat-dark");
    expect(getThemePreferenceMode("t3-chat-dark")).toBe("dark");
    // A mix half naming a retired preset is dropped, not half-applied.
    expect(parseThemeHalves(JSON.stringify({ light: "t3-ocean", dark: "t3-grove" }))).toBeNull();
  });

  it("recognizes only preferences the runtime can render", () => {
    for (const preference of ["light", "dark", "system", PAPER_THEME.id, GRAPHITE_THEME.id]) {
      expect(isKnownThemePreference(preference)).toBe(true);
    }
    expect(isKnownThemePreference(`${GRAPHITE_THEME.id}:dark`)).toBe(false);
    expect(isKnownThemePreference("missing-theme")).toBe(false);
  });

  it("keeps stored themes with unknown roles and drops invalid entries", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) =>
          key === CUSTOM_THEMES_STORAGE_KEY
            ? JSON.stringify([
                {
                  id: "aurora",
                  label: "Aurora",
                  appearance: "light",
                  colors: { canvas: "#f8fbff", futureRole: "#123456", accent: "not-a-color" },
                  variants: { light: { canvas: "#101827" } },
                },
                { id: "light", label: "Reserved", appearance: "light", colors: {} },
                { id: "aurora", label: "Duplicate", appearance: "dark", colors: {} },
              ])
            : null,
      },
    });
    invalidateCustomThemes();

    const themes = getCustomThemes();
    expect(themes).toHaveLength(1);
    expect(themes[0]).toMatchObject({
      id: "aurora",
      colors: { canvas: "#f8fbff", accent: getDefaultThemeColors("light").accent },
    });
    // The variant shadowing the base appearance is dropped so the theme
    // round-trips through parseThemeFile on export.
    expect(getThemeModes(themes[0]!)).toEqual(["light"]);

    vi.unstubAllGlobals();
    invalidateCustomThemes();
  });
});

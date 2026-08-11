import { describe, expect, it, vi } from "vite-plus/test";

import indexHtml from "../index.html?raw";
import {
  CARBON_THEME,
  CUSTOM_THEMES_STORAGE_KEY,
  getDefaultThemeColors,
  getThemeColorsForMode,
  GRAPHITE_THEME,
  invalidateCustomThemes,
  isKnownThemePreference,
  OBSIDIAN_THEME,
  OLED_VOID_THEME,
  PAPER_THEME,
  resolveThemeAppearance,
  THEME_APPEARANCE_MODE_STORAGE_KEY,
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  toCanonicalThemeColor,
} from "./themePalette";

const THEME_STORAGE_KEY = "t3code:theme";
// A custom theme that omits chrome falls back to the runtime default, so the
// boot copy of that default stays derived from the real palette.
const DEFAULT_DARK_CHROME = getDefaultThemeColors("dark").chrome;

const bootScript = (() => {
  const match = indexHtml.match(/<script>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Could not find the inline boot script in index.html");
  return match[1];
})();

type BootResult = {
  isDark: boolean;
  themeId: string | undefined;
  themeSelected: string | undefined;
  backgroundColor: string;
  bootVariables: Record<string, string>;
  metaContent: string | null;
};

function runBootScript(options: {
  storage?: Record<string, string>;
  storageThrows?: boolean;
  prefersDark: boolean;
}): BootResult {
  const classes = new Set<string>();
  const bootVariables: Record<string, string> = {};
  const meta = {
    content: null as string | null,
    setAttribute(_name: string, value: string) {
      this.content = value;
    },
  };
  const documentElement = {
    dataset: {} as Record<string, string | undefined>,
    classList: {
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
      toggle: (name: string, force?: boolean) => {
        const next = force ?? !classes.has(name);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
    },
    style: {
      backgroundColor: "",
      setProperty: (name: string, value: string) => {
        bootVariables[name] = value;
      },
    },
  };
  const fakeDocument = {
    documentElement,
    querySelectorAll: (selector: string) => (selector === 'meta[name="theme-color"]' ? [meta] : []),
  };
  const fakeWindow = {
    localStorage: {
      getItem: (key: string): string | null => {
        if (options.storageThrows) throw new Error("storage blocked");
        return options.storage?.[key] ?? null;
      },
    },
    matchMedia: () => ({ matches: options.prefersDark }),
  };

  const fakeCss = {
    supports: (property: string, value: string) =>
      property === "color" && toCanonicalThemeColor(value) !== null,
  };

  new Function("window", "document", "CSS", bootScript)(fakeWindow, fakeDocument, fakeCss);

  return {
    isDark: classes.has("dark"),
    themeId: documentElement.dataset.themeId,
    themeSelected: documentElement.dataset.themeSelected,
    backgroundColor: documentElement.style.backgroundColor,
    bootVariables,
    metaContent: meta.content,
  };
}

/** Mirrors getStored + readAppearanceModePreference + resolveThemeAppearance from the runtime. */
function runtimeResolvedAppearance(
  storage: Record<string, string>,
  prefersDark: boolean,
): "light" | "dark" {
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => storage[key] ?? null },
    matchMedia: () => ({ matches: prefersDark }),
  });
  invalidateCustomThemes();
  try {
    const raw = storage[THEME_STORAGE_KEY] ?? null;
    const theme = raw !== null && isKnownThemePreference(raw) ? raw : "system";
    const followRaw = storage[THEME_FOLLOW_SYSTEM_STORAGE_KEY] ?? null;
    const appearanceRaw = storage[THEME_APPEARANCE_MODE_STORAGE_KEY] ?? null;
    const appearanceMode =
      appearanceRaw === "light" || appearanceRaw === "dark" || appearanceRaw === "system"
        ? appearanceRaw
        : followRaw === "true"
          ? "system"
          : followRaw === "false"
            ? null
            : theme === "system"
              ? "system"
              : null;
    const followSystem = appearanceMode === "system";
    return resolveThemeAppearance(theme, prefersDark, followSystem, appearanceMode ?? undefined);
  } finally {
    vi.unstubAllGlobals();
    invalidateCustomThemes();
  }
}

// Named for a stock that is not in the curated set: "paper" is a built-in id
// now, and a custom theme is never allowed to claim a reserved one.
const VELLUM_LIGHT_ONLY = {
  id: "vellum",
  label: "Vellum",
  appearance: "light",
  colors: { canvas: "#f8fbff", text: "#10243d", accent: "#5b6cff" },
};
const AURORA_DUAL = {
  id: "aurora",
  label: "Aurora",
  appearance: "light",
  colors: { canvas: "#f8fbff", text: "#10243d", accent: "#5b6cff" },
  variants: { dark: { canvas: "#101827", text: "#eef5ff", accent: "#7c93ff" } },
};
const CHARCOAL_DARK_ONLY = {
  id: "charcoal",
  label: "Charcoal",
  appearance: "dark",
  colors: { canvas: "#1c1210", text: "#ffe8d9", accent: "#ff7a45" },
};

describe("index.html boot script", () => {
  const parityCases: ReadonlyArray<{
    name: string;
    storage: Record<string, string>;
    prefersDark: boolean;
  }> = [
    { name: "no stored preference on a dark OS", storage: {}, prefersDark: true },
    {
      name: "Paper follows a dark OS",
      storage: { [THEME_STORAGE_KEY]: "paper", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    },
    {
      name: "an explicit global dark mode applies to Paper",
      storage: {
        [THEME_STORAGE_KEY]: "paper",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "dark",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "false",
      },
      prefersDark: false,
    },
    {
      name: "Graphite follows a light OS",
      storage: { [THEME_STORAGE_KEY]: "graphite", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: false,
    },
    {
      name: "a dark-first Obsidian ignores a light OS when not following it",
      storage: { [THEME_STORAGE_KEY]: "obsidian", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "false" },
      prefersDark: false,
    },
    {
      name: "Carbon follows a dark OS",
      storage: { [THEME_STORAGE_KEY]: "carbon", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    },
    {
      name: "OLED Void follows a light OS",
      storage: { [THEME_STORAGE_KEY]: "oled-void", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: false,
    },
    // The retired palettes: their ids stay reserved but no longer resolve, so
    // both the boot script and the runtime have to land on the same fallback.
    {
      name: "a retired grove preference falls back to system",
      storage: { [THEME_STORAGE_KEY]: "grove", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    },
    {
      name: "a legacy t3-grove preference falls back to system through the alias",
      storage: { [THEME_STORAGE_KEY]: "t3-grove", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    },
    {
      name: "legacy t3-chat-dark falls back to system",
      storage: { [THEME_STORAGE_KEY]: "t3-chat-dark" },
      prefersDark: true,
    },
    {
      name: "a dual-mode custom theme follows the OS",
      storage: {
        [THEME_STORAGE_KEY]: "aurora",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([AURORA_DUAL]),
      },
      prefersDark: true,
    },
    {
      name: "a dark-only custom theme stays dark on a light OS",
      storage: {
        [THEME_STORAGE_KEY]: "charcoal",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([CHARCOAL_DARK_ONLY]),
      },
      prefersDark: false,
    },
    {
      name: "a legacy mode-suffixed preference is treated as unknown",
      storage: {
        [THEME_STORAGE_KEY]: "aurora:dark",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([AURORA_DUAL]),
      },
      prefersDark: true,
    },
    {
      name: "a removed custom theme falls back to system",
      storage: { [THEME_STORAGE_KEY]: "gone-theme" },
      prefersDark: true,
    },
    {
      name: "a corrupted follow-system value falls back to inference",
      storage: { [THEME_STORAGE_KEY]: "system", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "1" },
      prefersDark: true,
    },
    {
      name: "follow-system off keeps an explicit light preference on a dark OS",
      storage: { [THEME_STORAGE_KEY]: "light", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "false" },
      prefersDark: true,
    },
    {
      name: "a bare dark preference stays dark on a light OS",
      storage: { [THEME_STORAGE_KEY]: "dark" },
      prefersDark: false,
    },
    {
      name: "follow-system off keeps a bare dark preference on a light OS",
      storage: { [THEME_STORAGE_KEY]: "dark", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "false" },
      prefersDark: false,
    },
  ];

  it.each(parityCases)("matches the runtime appearance: $name", ({ storage, prefersDark }) => {
    const boot = runBootScript({ storage, prefersDark });
    expect(boot.isDark).toBe(runtimeResolvedAppearance(storage, prefersDark) === "dark");
  });

  it("marks built-in and custom themes on the document element", () => {
    const paper = runBootScript({
      storage: { [THEME_STORAGE_KEY]: "paper", [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true" },
      prefersDark: true,
    });
    expect(paper.themeId).toBe("paper");
    expect(paper.themeSelected).toBe("true");
    expect(paper.isDark).toBe(true);

    const aurora = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "aurora",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([AURORA_DUAL]),
      },
      prefersDark: true,
    });
    expect(aurora.themeId).toBe("aurora");
    expect(aurora.isDark).toBe(true);
    expect(aurora.backgroundColor).toBe(DEFAULT_DARK_CHROME);
    expect(aurora.bootVariables["--boot-background"]).toBe(AURORA_DUAL.variants.dark.canvas);
    expect(aurora.metaContent).toBe(DEFAULT_DARK_CHROME);
  });

  it("accepts exponent-form OKLCH before the runtime mounts", () => {
    const colors = {
      canvas: "oklch(9.5e-1 1e-2 2.8e2)",
      chrome: "oklch(9.4e-1 1e-2 2.8e2)",
      text: "oklch(2e-1 0 0 / 9e-1)",
      accent: "oklch(6.2e-1 0.2 2.8e2)",
    };
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "scientific",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([
          {
            id: "scientific",
            label: "Scientific",
            appearance: "light",
            colors,
          },
        ]),
      },
      prefersDark: false,
    });

    expect(boot.bootVariables["--boot-background"]).toBe(colors.canvas);
    expect(boot.bootVariables["--boot-foreground"]).toBe(colors.text);
    expect(boot.bootVariables["--boot-accent"]).toBe(colors.accent);
    expect(boot.backgroundColor).toBe(colors.chrome);
    expect(boot.metaContent).toBe(colors.chrome);
  });

  it("accepts legacy CSS color formats before the runtime mounts", () => {
    const colors = {
      canvas: "rgb(248 251 255)",
      chrome: "hsl(210 100% 99%)",
      text: "rebeccapurple",
      accent: "color(display-p3 0.36 0.42 1)",
    };
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "legacy-css",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([
          {
            id: "legacy-css",
            label: "Legacy CSS",
            appearance: "light",
            colors,
          },
        ]),
      },
      prefersDark: false,
    });

    expect(boot.bootVariables["--boot-background"]).toBe(colors.canvas);
    expect(boot.bootVariables["--boot-foreground"]).toBe(colors.text);
    expect(boot.bootVariables["--boot-accent"]).toBe(colors.accent);
    expect(boot.backgroundColor).toBe(colors.chrome);
  });

  // Asserting against the real palette definitions (not literals) turns the
  // boot script's hand-maintained copy into a CI-enforced contract: any
  // palette change breaks this test until the copy in index.html is updated.
  it("keeps every built-in boot splash in sync with the real palettes", () => {
    for (const theme of [
      PAPER_THEME,
      GRAPHITE_THEME,
      OBSIDIAN_THEME,
      CARBON_THEME,
      OLED_VOID_THEME,
    ]) {
      for (const mode of ["light", "dark"] as const) {
        const colors = getThemeColorsForMode(theme, mode);
        expect(colors).not.toBeNull();
        const boot = runBootScript({
          storage: {
            [THEME_STORAGE_KEY]: theme.id,
            [THEME_APPEARANCE_MODE_STORAGE_KEY]: mode,
          },
          prefersDark: mode === "dark",
        });
        expect(boot.themeId).toBe(theme.id);
        expect(boot.isDark).toBe(mode === "dark");
        expect(boot.bootVariables["--boot-background"]).toBe(colors!.canvas);
        expect(boot.bootVariables["--boot-foreground"]).toBe(colors!.text);
        expect(boot.bootVariables["--boot-accent"]).toBe(colors!.accent);
        expect(boot.backgroundColor).toBe(colors!.chrome);
        expect(boot.metaContent).toBe(colors!.chrome);
      }

      // Only Paper is light-first, so the boot script can no longer assume a
      // base appearance. With follow-system off and no explicit mode stored,
      // the splash has to land on the definition's own appearance -- this is
      // what pins the BUILT_IN_THEME_APPEARANCES copy to the real palettes.
      const base = runBootScript({
        storage: {
          [THEME_STORAGE_KEY]: theme.id,
          [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "false",
        },
        prefersDark: theme.appearance === "light",
      });
      expect(base.isDark).toBe(theme.appearance === "dark");
    }
  });

  it("applies the matching half of an automatic mix to the splash", () => {
    const storage = {
      [THEME_STORAGE_KEY]: "paper",
      [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
      "t3code:theme-halves:v1": JSON.stringify({ dark: GRAPHITE_THEME.id }),
    };

    const dark = runBootScript({ storage, prefersDark: true });
    expect(dark.isDark).toBe(true);
    expect(dark.themeId).toBe(GRAPHITE_THEME.id);
    expect(dark.bootVariables["--boot-background"]).toBe(
      getThemeColorsForMode(GRAPHITE_THEME, "dark")!.canvas,
    );

    const light = runBootScript({ storage, prefersDark: false });
    expect(light.isDark).toBe(false);
    expect(light.themeId).toBe("paper");
    expect(light.bootVariables["--boot-background"]).toBe(
      getThemeColorsForMode(PAPER_THEME, "light")!.canvas,
    );
  });

  it("lets a dark half go dark when the light-only base cannot", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: VELLUM_LIGHT_ONLY.id,
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([VELLUM_LIGHT_ONLY]),
        "t3code:theme-halves:v1": JSON.stringify({ dark: GRAPHITE_THEME.id }),
      },
      prefersDark: true,
    });
    expect(boot.isDark).toBe(true);
    expect(boot.themeId).toBe(GRAPHITE_THEME.id);
  });

  it("paints the half's splash when the base theme no longer exists", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "gone-theme",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        "t3code:theme-halves:v1": JSON.stringify({ dark: GRAPHITE_THEME.id }),
      },
      prefersDark: true,
    });
    expect(boot.isDark).toBe(true);
    expect(boot.themeId).toBe(GRAPHITE_THEME.id);
    expect(boot.themeSelected).toBe("true");
    expect(boot.bootVariables["--boot-background"]).toBe(
      getThemeColorsForMode(GRAPHITE_THEME, "dark")!.canvas,
    );
  });

  // The alias table still resolves t3-grove onto grove; grove is simply not a
  // theme any more, so the half has to be dropped rather than half-applied.
  it("ignores a legacy-prefixed mix half naming a retired theme", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "paper",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        "t3code:theme-halves:v1": JSON.stringify({ dark: "t3-grove" }),
      },
      prefersDark: true,
    });
    expect(boot.themeId).toBe("paper");
    expect(boot.isDark).toBe(true);
    expect(boot.bootVariables["--boot-background"]).toBe(
      getThemeColorsForMode(PAPER_THEME, "dark")!.canvas,
    );
  });

  it("ignores a mix half that names an unknown theme", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "paper",
        [THEME_APPEARANCE_MODE_STORAGE_KEY]: "system",
        "t3code:theme-halves:v1": JSON.stringify({ dark: "gone-theme" }),
      },
      prefersDark: true,
    });
    expect(boot.themeId).toBe("paper");
    expect(boot.isDark).toBe(true);
  });

  it("uses runtime defaults for malformed custom roles", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "partial",
        [THEME_FOLLOW_SYSTEM_STORAGE_KEY]: "true",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([
          {
            id: "partial",
            label: "Partial",
            appearance: "dark",
            colors: { canvas: "not-a-color", text: "#fffaff", accent: "nope" },
          },
        ]),
      },
      prefersDark: true,
    });

    expect(boot.themeId).toBe("partial");
    expect(boot.bootVariables["--boot-background"]).toBe(getDefaultThemeColors("dark").canvas);
    expect(boot.bootVariables["--boot-foreground"]).toBe("#fffaff");
    expect(boot.bootVariables["--boot-accent"]).toBe(getDefaultThemeColors("dark").accent);
    expect(boot.backgroundColor).toBe(DEFAULT_DARK_CHROME);
    expect(boot.metaContent).toBe(DEFAULT_DARK_CHROME);
  });

  it("ignores malformed custom theme entries before applying a splash", () => {
    const boot = runBootScript({
      storage: {
        [THEME_STORAGE_KEY]: "broken",
        [CUSTOM_THEMES_STORAGE_KEY]: JSON.stringify([
          { id: "broken", label: "Broken", appearance: "light", colors: "bad" },
        ]),
      },
      prefersDark: false,
    });

    expect(boot.themeId).toBeUndefined();
    expect(boot.themeSelected).toBeUndefined();
    expect(boot.backgroundColor).toBe("#ffffff");
    expect(boot.metaContent).toBe("#ffffff");
  });

  it("leaves unknown preferences unthemed so the runtime default applies", () => {
    const boot = runBootScript({
      storage: { [THEME_STORAGE_KEY]: "gone-theme" },
      prefersDark: true,
    });
    expect(boot.themeId).toBeUndefined();
    expect(boot.themeSelected).toBeUndefined();
    expect(boot.isDark).toBe(true);
  });

  it("follows the OS appearance when storage is unavailable", () => {
    const light = runBootScript({ storageThrows: true, prefersDark: false });
    expect(light.isDark).toBe(false);
    expect(light.themeId).toBeUndefined();

    const dark = runBootScript({ storageThrows: true, prefersDark: true });
    expect(dark.isDark).toBe(true);
  });
});

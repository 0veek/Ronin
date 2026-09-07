import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const key = "t3code:usage-page-preferences:v1";
const defaults = { metric: "cost", windowDays: 30 } as const;

let values: Map<string, string>;
let storage: Storage;

// `useLocalStorage` captures `window.localStorage` when it loads, so each case
// stubs the global and re-imports through it.
async function loadPreferences() {
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
  return import("./usagePagePreferences");
}

beforeEach(() => {
  values = new Map();
  storage = {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("Usage page preferences", () => {
  it("uses defaults when no preference has been saved", async () => {
    const { readUsagePagePreferences } = await loadPreferences();
    expect(readUsagePagePreferences()).toEqual(defaults);
  });

  it.each([1, 7, 30, 90] as const)(
    "round-trips every metric with a %i-day range",
    async (windowDays) => {
      const { readUsagePagePreferences, saveUsagePagePreferences } = await loadPreferences();
      for (const metric of ["cost", "tokens"] as const) {
        saveUsagePagePreferences({ metric, windowDays });
        expect(readUsagePagePreferences()).toEqual({ metric, windowDays });
      }
    },
  );

  it.each([
    "not-json",
    '{"metric":"unknown","windowDays":7}',
    '{"metric":"cost","windowDays":365}',
  ])("replaces invalid preferences on the next save: %s", async (value) => {
    values.set(key, value);
    const { readUsagePagePreferences, saveUsagePagePreferences } = await loadPreferences();
    expect(readUsagePagePreferences()).toEqual(defaults);
    saveUsagePagePreferences({ metric: "tokens", windowDays: 7 });
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowDays: 7 });
  });

  it("contains write failures and can save again after storage recovers", async () => {
    const { readUsagePagePreferences, saveUsagePagePreferences } = await loadPreferences();
    saveUsagePagePreferences(defaults);
    const write = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveUsagePagePreferences({ metric: "tokens", windowDays: 7 })).not.toThrow();
    expect(readUsagePagePreferences()).toEqual(defaults);
    write.mockRestore();
    saveUsagePagePreferences({ metric: "tokens", windowDays: 7 });
    expect(readUsagePagePreferences()).toEqual({ metric: "tokens", windowDays: 7 });
  });

  it("contains failures when the browser blocks storage access", async () => {
    const { readUsagePagePreferences, saveUsagePagePreferences } = await loadPreferences();
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readUsagePagePreferences()).toEqual(defaults);
    expect(() => saveUsagePagePreferences({ metric: "tokens", windowDays: 7 })).not.toThrow();
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  filterAvailableSettingsSearchItems,
  searchableSetting,
  searchSettings,
  SETTINGS_SEARCH_ITEMS,
  type SettingsSearchItem,
} from "./settingsSearch";

const ITEMS: ReadonlyArray<SettingsSearchItem> = [
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/general",
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/connections",
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
  },
  {
    id: "provider-updates",
    title: "Update checks",
    to: "/settings/general",
  },
  {
    id: "automatic-updates",
    title: "Automatic updates",
    to: "/settings/general",
  },
];

describe("searchSettings", () => {
  it("matches setting titles and their navigation vocabulary", () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("network", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("connections", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("claude", ITEMS).map((item) => item.id)).toEqual(["providers"]);
  });

  it("matches normalized title substrings", () => {
    expect(searchSettings("  WORD   WRAP  ", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("identification").map((item) => item.id)).toEqual([
      "environment-identification",
    ]);
    expect(searchSettings("panel animations").map((item) => item.id)).toEqual(["panel-animations"]);
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("keeps catalog order for multiple title matches", () => {
    expect(searchSettings("update", ITEMS).map((item) => item.id)).toEqual([
      "provider-updates",
      "automatic-updates",
    ]);
  });

  it("lists thread confirmations in panel order", () => {
    expect(searchSettings("confirmation").map((item) => item.id)).toEqual([
      "unpin-confirmation",
      "archive-confirmation",
      "delete-confirmation",
    ]);
  });

  it("ranks direct setting-title matches ahead of broader section matches", () => {
    const matches = searchSettings("model");

    expect(matches[0]?.id).toBe("text-generation-model");
    expect(matches.some((item) => item.to === "/settings/providers")).toBe(true);
  });

  it("finds settings with common task vocabulary", () => {
    expect(searchSettings("dark")[0]?.to).toBe("/settings/appearance");
    expect(searchSettings("git")[0]?.to).toBe("/settings/source-control");
    expect(searchSettings("ssh")[0]?.to).toBe("/settings/connections");
    expect(searchSettings("automation")[0]?.to).toBe("/settings/automations");
    expect(searchSettings("build system")[0]?.to).toBe("/settings/build-systems");
  });

  it("returns no results for an empty query", () => {
    expect(searchSettings("   ", ITEMS)).toEqual([]);
  });

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "quit-confirmation")).toBe(true);
    expect(searchSettings("quit confirmation")).toEqual([]);
  });

  it("hides automatic settlement settings when the server cannot settle threads itself", () => {
    const gated = new Set([
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
    ]);
    const available = filterAvailableSettingsSearchItems({ hasThreadAutoSettlement: false });

    expect(available.map((item) => item.id).filter((id) => gated.has(id))).toEqual([]);
  });

  it("shows automatic settlement settings when the server supports them", () => {
    const available = filterAvailableSettingsSearchItems({ hasThreadAutoSettlement: true });

    expect(searchSettings("auto-settle", available).map((item) => item.id)).toEqual([
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
    ]);
  });

  it("finds a setting by its description rather than its title", () => {
    expect(searchSettings("dark mode")[0]).toMatchObject({ id: "color-scheme" });
    expect(searchSettings("monospace").map((item) => item.id)).toContain("code-font");
  });

  it("keeps catalog result ids unique", () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("serves anchor props to panels from the catalog", () => {
    expect(searchableSetting("word-wrap")).toEqual({ id: "word-wrap", title: "Word wrap" });
    expect(searchableSetting("archive")).toEqual({ id: "archive", title: "Archived threads" });
    expect(searchableSetting("automations")).toEqual({ id: "automations", title: "Automations" });
  });

  it("routes appearance settings to their current section", () => {
    expect(searchSettings("theme")[0]).toMatchObject({
      id: "theme",
      to: "/settings/appearance",
    });
    expect(searchSettings("word wrap")[0]).toMatchObject({
      id: "word-wrap",
      to: "/settings/appearance",
    });
    expect(searchSettings("chat width")[0]).toMatchObject({
      id: "chat-width",
      to: "/settings/appearance",
    });
    expect(searchSettings("environment identification")[0]).toMatchObject({
      id: "environment-identification",
      to: "/settings/appearance",
      targetId: "appearance",
    });
  });

  it("routes browser recording quality to integrations", () => {
    expect(searchSettings("recording frame rate")[0]).toMatchObject({
      id: "browser-recording-frame-rate",
      to: "/settings/integrations",
      targetId: "browser",
    });
  });
});

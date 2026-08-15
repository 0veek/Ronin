import { compileResolvedKeybindingsConfig, DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { buildShortcutsCheatSheet } from "./shortcutsCheatSheet";

const DEFAULTS = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);

function sheet() {
  return buildShortcutsCheatSheet(DEFAULTS, "Win32");
}

function entryFor(command: string) {
  return sheet()
    .flatMap((section) => section.entries)
    .find((entry) => entry.command === command);
}

describe("buildShortcutsCheatSheet", () => {
  it("groups shortcuts by the part of the app they act on", () => {
    const titles = sheet().map((section) => section.title);

    expect(titles).toContain("General");
    expect(titles).toContain("Terminal");
    expect(titles).toContain("Threads");
    // Order is the declared order, not alphabetical: General leads because it
    // is what someone opening the sheet for the first time wants.
    expect(titles[0]).toBe("General");
  });

  it("collapses the nine numbered jump bindings into one row each", () => {
    const entries = sheet().flatMap((section) => section.entries);
    const jumpEntries = entries.filter((entry) => entry.command.startsWith("thread.jump."));

    expect(jumpEntries).toHaveLength(1);
    expect(jumpEntries[0]!.label).toBe("Jump to thread 1-9");
  });

  it("keeps every shortcut for a command bound to more than one", () => {
    // chat.new ships bound twice, and a sheet that showed one would be lying
    // about the other.
    expect(entryFor("chat.new")!.shortcuts.length).toBeGreaterThan(1);
  });

  it("shows the shortcut for the platform it is asked about", () => {
    expect(entryFor("commandPalette.toggle")!.shortcuts[0]).toBe("Ctrl+K");
    expect(
      buildShortcutsCheatSheet(DEFAULTS, "MacIntel")
        .flatMap((section) => section.entries)
        .find((entry) => entry.command === "commandPalette.toggle")!.shortcuts[0],
    ).toBe("⌘K");
  });

  it("lists the cheat sheet's own shortcut, so it is discoverable twice", () => {
    expect(entryFor("shortcuts.toggle")).toBeDefined();
  });

  it("returns nothing at all rather than empty sections when nothing is bound", () => {
    expect(buildShortcutsCheatSheet([], "Win32")).toEqual([]);
  });

  it("gives every entry a human label rather than a raw command id", () => {
    for (const section of sheet()) {
      for (const entry of section.entries) {
        expect(entry.label).not.toContain(".");
        expect(entry.shortcuts.length).toBeGreaterThan(0);
      }
    }
  });
});

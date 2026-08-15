import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { formatShortcutLabel } from "../keybindings";
import { commandLabel } from "./settings/KeybindingsSettings.logic";

export interface CheatSheetEntry {
  readonly command: KeybindingCommand;
  readonly label: string;
  /** Every shortcut bound to this command, in declaration order. A command can
      legitimately have more than one (chat.new ships with two). */
  readonly shortcuts: readonly string[];
}

export interface CheatSheetSection {
  readonly title: string;
  readonly entries: readonly CheatSheetEntry[];
}

/**
 * Section titles keyed by the command's first segment, in the order they are
 * shown. A cheat sheet grouped alphabetically is a list; grouped by the part
 * of the app a shortcut acts on, it is a map.
 */
const SECTION_BY_PREFIX: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["General", ["sidebar", "commandPalette", "shortcuts", "filePicker", "projectSearch", "editor"]],
  ["Threads", ["thread", "chat"]],
  ["Composer", ["composer", "modelPicker"]],
  ["Terminal", ["terminal"]],
  ["Workspace", ["diff", "rightPanel", "preview", "themeEditor"]],
  ["Scripts", ["script"]],
];

const OTHER_SECTION_TITLE = "Other";

/**
 * The nine numbered jump bindings are one idea, not nine. Listed individually
 * they are 18 of the ~45 rows on the sheet and push everything else off the
 * screen, so each family collapses to its first member and is relabelled.
 */
const COLLAPSED_FAMILIES: ReadonlyArray<{
  readonly prefix: string;
  readonly keepCommand: KeybindingCommand;
  readonly label: string;
}> = [
  { prefix: "thread.jump.", keepCommand: "thread.jump.1", label: "Jump to thread 1-9" },
  {
    prefix: "modelPicker.jump.",
    keepCommand: "modelPicker.jump.1",
    label: "Pick model 1-9",
  },
];

function sectionTitleFor(command: KeybindingCommand): string {
  const prefix = String(command).split(".")[0] ?? "";
  for (const [title, prefixes] of SECTION_BY_PREFIX) {
    if (prefixes.includes(prefix)) return title;
  }
  return OTHER_SECTION_TITLE;
}

function collapsedFamilyFor(command: KeybindingCommand) {
  return COLLAPSED_FAMILIES.find((family) => String(command).startsWith(family.prefix)) ?? null;
}

/**
 * Turns the bindings that are actually in force into a readable sheet.
 *
 * Built from the resolved config rather than the defaults so a user who
 * rebound something is shown their binding, and a user who cleared one is not
 * told to press a key that does nothing.
 */
export function buildShortcutsCheatSheet(
  keybindings: ResolvedKeybindingsConfig,
  platform?: string,
): readonly CheatSheetSection[] {
  const entriesByCommand = new Map<KeybindingCommand, { label: string; shortcuts: string[] }>();

  for (const binding of keybindings) {
    const family = collapsedFamilyFor(binding.command);
    if (family !== null && binding.command !== family.keepCommand) continue;

    const label = family?.label ?? commandLabel(binding.command);
    const shortcut =
      platform === undefined
        ? formatShortcutLabel(binding.shortcut)
        : formatShortcutLabel(binding.shortcut, platform);

    const existing = entriesByCommand.get(binding.command);
    if (existing === undefined) {
      entriesByCommand.set(binding.command, { label, shortcuts: [shortcut] });
      continue;
    }
    // The same command bound to the same keys twice (a user override layered
    // over the default) is one shortcut, not two.
    if (!existing.shortcuts.includes(shortcut)) existing.shortcuts.push(shortcut);
  }

  const sectionOrder = [...SECTION_BY_PREFIX.map(([title]) => title), OTHER_SECTION_TITLE];
  const entriesBySection = new Map<string, CheatSheetEntry[]>();

  for (const [command, entry] of entriesByCommand) {
    const title = sectionTitleFor(command);
    const bucket = entriesBySection.get(title) ?? [];
    bucket.push({ command, label: entry.label, shortcuts: entry.shortcuts });
    entriesBySection.set(title, bucket);
  }

  return sectionOrder.flatMap((title) => {
    const entries = entriesBySection.get(title);
    if (entries === undefined || entries.length === 0) return [];
    return [
      {
        title,
        entries: entries.toSorted((left, right) => left.label.localeCompare(right.label)),
      },
    ];
  });
}

import {
  ActivityIcon,
  ArchiveIcon,
  BlocksIcon,
  BotIcon,
  BoxesIcon,
  ClockIcon,
  GitBranchIcon,
  KeyboardIcon,
  Link2Icon,
  MicIcon,
  PaletteIcon,
  Settings2Icon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

export type SettingsPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/speech-to-text"
  | "/settings/providers"
  | "/settings/skills"
  | "/settings/automations"
  | "/settings/build-systems"
  | "/settings/integrations"
  | "/settings/source-control"
  | "/settings/connections"
  | "/settings/archived";

export interface SettingsPageMeta {
  readonly description: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly searchTerms: ReadonlyArray<string>;
}

export const SETTINGS_PAGE_META = {
  "/settings/general": {
    label: "General",
    description: "Everyday behavior, defaults, and notifications.",
    icon: Settings2Icon,
    searchTerms: ["behavior", "defaults", "notifications", "threads", "startup"],
  },
  "/settings/appearance": {
    label: "Appearance",
    description: "Themes, typography, and editor presentation.",
    icon: PaletteIcon,
    searchTerms: ["theme", "dark", "light", "color", "font", "typography", "editor", "width"],
  },
  "/settings/keybindings": {
    label: "Keybindings",
    description: "Keyboard shortcuts for commands and navigation.",
    icon: KeyboardIcon,
    searchTerms: ["keyboard", "shortcut", "hotkey", "command"],
  },
  "/settings/speech-to-text": {
    label: "Dictation",
    description: "Voice input, transcription providers, and models.",
    icon: MicIcon,
    searchTerms: ["voice", "microphone", "speech", "transcription", "audio"],
  },
  "/settings/providers": {
    label: "Providers",
    description: "Models, authentication, and agent runtimes.",
    icon: BotIcon,
    searchTerms: ["model", "authentication", "login", "api", "codex", "claude", "cursor"],
  },
  "/settings/skills": {
    label: "Agent skills",
    description: "Reusable instructions and specialized workflows.",
    icon: BoxesIcon,
    searchTerms: ["skill", "workflow", "instruction", "agent"],
  },
  "/settings/automations": {
    label: "Automations",
    description: "Prompts a project runs on a schedule.",
    icon: ClockIcon,
    searchTerms: ["schedule", "cron", "recurring", "daily", "automation", "unattended"],
  },
  "/settings/build-systems": {
    label: "Build systems",
    description: "Teams of models that share a task and a workspace.",
    icon: UsersIcon,
    searchTerms: ["team", "crew", "orchestrator", "multi-agent", "delegate", "build system"],
  },
  "/settings/integrations": {
    label: "Integrations",
    description: "How the built-in browser opens and what it opens with.",
    icon: BlocksIcon,
    searchTerms: ["browser", "preview", "viewport", "zoom", "device", "appearance", "floating"],
  },
  "/settings/source-control": {
    label: "Source control",
    description: "Git, branches, pull requests, and worktrees.",
    icon: GitBranchIcon,
    searchTerms: ["git", "github", "branch", "pull request", "pr", "worktree"],
  },
  "/settings/connections": {
    label: "Connections",
    description: "Devices, remote environments, and network access.",
    icon: Link2Icon,
    searchTerms: ["ssh", "remote", "network", "tailscale", "pairing", "device"],
  },
  "/settings/archived": {
    label: "Archive",
    description: "Find and restore conversations you archived.",
    icon: ArchiveIcon,
    searchTerms: ["history", "old", "restore", "unarchive", "conversation"],
  },
  "/settings/diagnostics": {
    label: "Diagnostics",
    description: "Inspect local activity, failures, and performance.",
    icon: ActivityIcon,
    searchTerms: ["logs", "traces", "errors", "performance", "debug"],
  },
} as const satisfies Readonly<Record<string, SettingsPageMeta>>;

export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly paths: ReadonlyArray<SettingsPath>;
}> = [
  {
    label: "Personal",
    paths: [
      "/settings/general",
      "/settings/appearance",
      "/settings/keybindings",
      "/settings/speech-to-text",
    ],
  },
  {
    label: "Agents",
    paths: [
      "/settings/providers",
      "/settings/skills",
      "/settings/automations",
      "/settings/build-systems",
    ],
  },
  {
    label: "Workspace",
    paths: ["/settings/integrations", "/settings/source-control", "/settings/connections"],
  },
  {
    label: "History",
    paths: ["/settings/archived"],
  },
];

export function getSettingsPageMeta(pathname: string): SettingsPageMeta | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  return SETTINGS_PAGE_META[normalizedPathname as keyof typeof SETTINGS_PAGE_META] ?? null;
}

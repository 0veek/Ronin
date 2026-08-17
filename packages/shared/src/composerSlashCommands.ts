export const BUILT_IN_COMPOSER_SLASH_COMMANDS = [
  "clear",
  "compact",
  "model",
  "plan",
  "debug",
  "default",
  "review",
  "fork",
  "side",
  "status",
] as const;

export type BuiltInComposerSlashCommand = (typeof BUILT_IN_COMPOSER_SLASH_COMMANDS)[number];

export interface ComposerSlashCommandDefinition {
  readonly command: BuiltInComposerSlashCommand;
  readonly label: `/${BuiltInComposerSlashCommand}`;
  readonly description: string;
}

export interface ComposerSlashInvocation {
  readonly command: BuiltInComposerSlashCommand;
  readonly args: string;
}

export type ForkSlashCommandTarget = "local" | "worktree";
export type ReviewSlashCommandTarget = "changes" | "base-branch";

export const COMPOSER_SLASH_COMMAND_DEFINITIONS: Record<
  BuiltInComposerSlashCommand,
  ComposerSlashCommandDefinition
> = {
  clear: {
    command: "clear",
    label: "/clear",
    description: "Start a fresh thread and clear the current conversation context",
  },
  compact: {
    command: "compact",
    label: "/compact",
    description: "Compact the current thread context to free space",
  },
  model: {
    command: "model",
    label: "/model",
    description: "Switch response model for this thread",
  },
  plan: {
    command: "plan",
    label: "/plan",
    description: "Switch this thread into plan mode",
  },
  debug: {
    command: "debug",
    label: "/debug",
    description: "Switch this thread into debug mode: reproduce, fix, then verify",
  },
  default: {
    command: "default",
    label: "/default",
    description: "Switch this thread back to normal chat mode",
  },
  review: {
    command: "review",
    label: "/review",
    description: "Start a code review for current changes",
  },
  fork: {
    command: "fork",
    label: "/fork",
    description: "Start a new thread in this project, locally or in a new worktree",
  },
  side: {
    command: "side",
    label: "/side",
    description: "Start a parallel thread in this project",
  },
  status: {
    command: "status",
    label: "/status",
    description: "Show context usage and rate-limit status",
  },
};

export function normalizeComposerSlashCommandName(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

export function isBuiltInComposerSlashCommand(value: string): value is BuiltInComposerSlashCommand {
  const normalized = normalizeComposerSlashCommandName(value);
  return BUILT_IN_COMPOSER_SLASH_COMMANDS.some((command) => command === normalized);
}

export function parseComposerSlashInvocation(text: string): ComposerSlashInvocation | null {
  const match = /^\/([a-z-]+)(?:\s+(.*))?$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  const command = normalizeComposerSlashCommandName(match[1] ?? "");
  if (!isBuiltInComposerSlashCommand(command)) {
    return null;
  }
  return {
    command,
    args: (match[2] ?? "").trim(),
  };
}

export function getAvailableComposerSlashCommands(input: {
  planModeEnabled: boolean;
  nativeCommandNames?: ReadonlyArray<string>;
  canOfferForkCommand?: boolean;
  canOfferSideCommand?: boolean;
}): BuiltInComposerSlashCommand[] {
  const nativeNames = new Set(
    (input.nativeCommandNames ?? []).map((name) => normalizeComposerSlashCommandName(name)),
  );

  const commands: BuiltInComposerSlashCommand[] = ["clear", "compact", "model"];
  if (input.planModeEnabled) {
    commands.push("plan");
  }
  // Debug mode is carried by prompt instructions rather than a native provider
  // mode, so it works everywhere and is not gated on the plan-mode flag.
  // "/default" comes with it: it is the only way back out.
  commands.push("debug", "default");
  commands.push("review");
  if (input.canOfferForkCommand !== false) {
    commands.push("fork");
  }
  if (input.canOfferSideCommand !== false) {
    commands.push("side");
  }
  commands.push("status");

  return commands.filter((command) => {
    if (command === "model" || command === "plan" || command === "debug" || command === "default") {
      return true;
    }
    // Leave native provider commands alone. Claude's /status and /clear are
    // documented session tools; intercepting them would break that flow.
    return !nativeNames.has(command);
  });
}

export function shouldHideProviderNativeSlashCommand(
  commandName: string,
  availableAppCommands: ReadonlySet<string>,
): boolean {
  return availableAppCommands.has(normalizeComposerSlashCommandName(commandName));
}

export function buildReviewPrompt(input: { target: ReviewSlashCommandTarget }): string {
  const baseInstruction =
    "Review the local code changes for bugs, risks, behavioural regressions, and missing tests. Findings first, ordered by severity.";
  if (input.target === "base-branch") {
    return `${baseInstruction}\nFocus on the current branch diff against its base branch.`;
  }
  return `${baseInstruction}\nFocus on the current uncommitted changes.`;
}

export function buildSlashReviewComposerPrompt(args: string): string {
  const trimmedArgs = args.trim();
  const normalizedArgs = trimmedArgs.toLowerCase();
  const reviewTarget: ReviewSlashCommandTarget =
    normalizedArgs === "base" || normalizedArgs.startsWith("base ") ? "base-branch" : "changes";
  const basePrompt = buildReviewPrompt({ target: reviewTarget });
  if (!trimmedArgs) {
    return basePrompt;
  }
  if (reviewTarget === "base-branch") {
    const baseBranchHint = trimmedArgs.replace(/^base\b/i, "").trim();
    return baseBranchHint.length > 0
      ? `${basePrompt}\nUse ${baseBranchHint} as the base branch if needed.`
      : basePrompt;
  }
  return `${basePrompt}\nFocus especially on: ${trimmedArgs}`;
}

export function parseForkSlashCommandArgs(args: string): {
  target: ForkSlashCommandTarget | null;
  invalid: boolean;
} {
  const trimmedArgs = args.trim();
  if (!trimmedArgs) {
    return { target: null, invalid: false };
  }
  const match = /^(local|worktree)$/i.exec(trimmedArgs);
  if (!match) {
    return { target: null, invalid: true };
  }
  return {
    target: match[1]!.toLowerCase() as ForkSlashCommandTarget,
    invalid: false,
  };
}

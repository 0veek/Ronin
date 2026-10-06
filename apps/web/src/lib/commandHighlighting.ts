const MAX_COMMAND_SEGMENTS = 64;

type ShellCommandSplit = {
  readonly firstCommand: string;
  readonly remainingCommand: string | null;
  readonly separator: string | null;
};

type Heredoc = {
  readonly delimiter: string;
  readonly stripTabs: boolean;
};

type ShellSeparator = {
  readonly index: number;
  readonly length: number;
};

type ShellCommentRange = {
  readonly start: number;
  readonly end: number;
};

function commandWithoutShellComments(
  command: string,
  end: number,
  comments: ReadonlyArray<ShellCommentRange>,
): string {
  let result = "";
  let cursor = 0;
  for (const comment of comments) {
    if (comment.start >= end) break;
    result += command.slice(cursor, comment.start);
    cursor = Math.min(comment.end, end);
  }
  return result + command.slice(cursor, end);
}

function readHeredocDelimiter(
  command: string,
  start: number,
  stripTabs: boolean,
): { readonly heredoc: Heredoc; readonly end: number } | null {
  let index = start;
  while (command[index] === " " || command[index] === "\t") index += 1;

  let delimiter = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;
  for (; index < command.length; index += 1) {
    const character = command[index]!;
    if (escaping) {
      delimiter += character;
      escaping = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      else delimiter += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character) || ";&|<>()".includes(character)) break;
    delimiter += character;
  }

  if (!delimiter || quote !== null || escaping) return null;
  return { heredoc: { delimiter, stripTabs }, end: index };
}

function commandAfterHeredocs(
  command: string,
  start: number,
  heredocs: ReadonlyArray<Heredoc>,
): string | null {
  let cursor = start;
  for (const heredoc of heredocs) {
    let foundDelimiter = false;
    while (cursor <= command.length) {
      const newlineIndex = command.indexOf("\n", cursor);
      const lineEnd = newlineIndex === -1 ? command.length : newlineIndex;
      const line = command.slice(cursor, lineEnd).replace(/\r$/u, "");
      const comparableLine = heredoc.stripTabs ? line.replace(/^\t+/u, "") : line;
      cursor = newlineIndex === -1 ? command.length : newlineIndex + 1;
      if (comparableLine === heredoc.delimiter) {
        foundDelimiter = true;
        break;
      }
      if (newlineIndex === -1) break;
    }
    if (!foundDelimiter) return null;
  }

  return command.slice(cursor).trim() || null;
}

function splitFirstShellCommand(command: string): ShellCommandSplit {
  let quote: '"' | "'" | null = null;
  let powerShellHereStringQuote: '"' | "'" | null = null;
  let escaping = false;
  let inBackticks = false;
  let inComment = false;
  let substitutionDepth = 0;
  let parameterExpansionDepth = 0;
  const heredocs: Heredoc[] = [];
  const comments: ShellCommentRange[] = [];
  let commentStart = 0;
  let separatorBeforeHeredocs: ShellSeparator | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (powerShellHereStringQuote !== null) {
      if (
        character === powerShellHereStringQuote &&
        command[index + 1] === "@" &&
        (index === 0 || command[index - 1] === "\n")
      ) {
        powerShellHereStringQuote = null;
        index += 1;
      }
      continue;
    }
    if (inComment) {
      if (character !== "\n") continue;
      inComment = false;
      comments.push({ start: commentStart, end: index });
    }
    if (escaping) {
      escaping = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (inBackticks) {
      if (character === "`") inBackticks = false;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (
      character === "@" &&
      (command[index + 1] === '"' || command[index + 1] === "'") &&
      (command[index + 2] === "\n" || (command[index + 2] === "\r" && command[index + 3] === "\n"))
    ) {
      powerShellHereStringQuote = command[index + 1] as '"' | "'";
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "`") {
      inBackticks = true;
      continue;
    }
    if (
      character === "#" &&
      (index === 0 || /\s/u.test(command[index - 1]!) || ";&|(".includes(command[index - 1]!))
    ) {
      inComment = true;
      commentStart = index;
      continue;
    }
    if (character === "$" && command[index + 1] === "{") {
      parameterExpansionDepth += 1;
      index += 1;
      continue;
    }
    if (character === "{" && parameterExpansionDepth > 0) {
      parameterExpansionDepth += 1;
      continue;
    }
    if (character === "}" && parameterExpansionDepth > 0) {
      parameterExpansionDepth -= 1;
      continue;
    }
    if (character === "(") {
      substitutionDepth += 1;
      continue;
    }
    if (character === ")" && substitutionDepth > 0) {
      substitutionDepth -= 1;
      continue;
    }
    if (substitutionDepth > 0 || parameterExpansionDepth > 0) continue;

    if (character === "<" && command[index + 1] === "<" && command[index + 2] !== "<") {
      const stripTabs = command[index + 2] === "-";
      const delimiter = readHeredocDelimiter(command, index + (stripTabs ? 3 : 2), stripTabs);
      if (delimiter === null) {
        return { firstCommand: command.trim(), remainingCommand: null, separator: null };
      }
      heredocs.push(delimiter.heredoc);
      index = delimiter.end - 1;
      continue;
    }

    const isDoubleOperator =
      (character === "&" && command[index + 1] === "&") ||
      (character === "|" && (command[index + 1] === "|" || command[index + 1] === "&"));
    const isRedirectionAmpersand =
      character === "&" &&
      (command[index - 1] === ">" || command[index - 1] === "<" || command[index + 1] === ">");
    if ((!isDoubleOperator && !";&|\n".includes(character)) || isRedirectionAmpersand) continue;

    if (character === "\n" && heredocs.length > 0) {
      const separator = separatorBeforeHeredocs;
      const firstCommand = commandWithoutShellComments(
        command,
        separator?.index ?? index,
        comments,
      ).trimStart();
      const commandBeforeHeredocs = separator
        ? command.slice(separator.index + separator.length, index).trim()
        : "";
      const commandFollowingHeredocs = commandAfterHeredocs(command, index + 1, heredocs);
      const remainingCommand = [commandBeforeHeredocs, commandFollowingHeredocs]
        .filter((part): part is string => Boolean(part))
        .join("\n");
      return {
        firstCommand,
        remainingCommand: remainingCommand || null,
        separator: separator
          ? command.slice(separator.index, separator.index + separator.length)
          : "\n",
      };
    }
    if (heredocs.length > 0) {
      separatorBeforeHeredocs ??= {
        index,
        length: isDoubleOperator ? 2 : 1,
      };
      if (isDoubleOperator) index += 1;
      continue;
    }

    const firstCommand = commandWithoutShellComments(command, index, comments).trimStart();
    let nextCommandIndex = index + (isDoubleOperator ? 2 : 1);
    while (/\s/u.test(command[nextCommandIndex] ?? "")) nextCommandIndex += 1;
    const nextCommand = command.slice(nextCommandIndex).trim();
    return {
      firstCommand,
      remainingCommand: nextCommand || null,
      separator: isDoubleOperator ? command.slice(index, index + 2) : character,
    };
  }

  if (inComment) comments.push({ start: commentStart, end: command.length });
  return {
    firstCommand: commandWithoutShellComments(command, command.length, comments).trim(),
    remainingCommand: null,
    separator: null,
  };
}

// Escape bytes and other control characters render as invisible gaps; display
// shows them as Unicode control pictures (ESC becomes ␛) instead. Tab, newline
// and carriage return lay out as whitespace, so CRLF scripts stay unmarked.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;

/** Replaces each control character with its control picture; the length does not change. */
export function withVisibleControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS, (character) =>
    character === "\u007f" ? "␡" : String.fromCharCode(0x2400 + character.charCodeAt(0)),
  );
}

const POWERSHELL_PROGRAMS = new Set(["powershell", "pwsh"]);

// PowerShell's approved verbs (`Get-Verb`), plus the ForEach, Where, Sort and
// Tee of its built-in *-Object cmdlets. Cmdlets match only capitalized, as
// agents write them: lowercase `update-grub` or `install-info` are Linux tools.
const POWERSHELL_VERBS = new Set(
  `Add Approve Assert Backup Block Build Checkpoint Clear Close Compare Complete Compress Confirm Connect Convert ConvertFrom ConvertTo Copy Debug Deny Deploy Disable Disconnect Dismount Edit Enable Enter Exit Expand Export Find ForEach Format Get Grant Group Hide Import Initialize Install Invoke Join Limit Lock Measure Merge Mount Move New Open Optimize Out Ping Pop Protect Publish Push Read Receive Redo Register Remove Rename Repair Request Reset Resize Resolve Restart Restore Resume Revoke Save Search Select Send Set Show Skip Sort Split Start Step Stop Submit Suspend Switch Sync Tee Test Trace Unblock Undo Uninstall Unlock Unprotect Unpublish Unregister Update Use Wait Watch Where Write`.split(
    " ",
  ),
);

function isPowerShellCmdlet(word: string): boolean {
  const cmdlet = /^([A-Z][a-z]+(?:[A-Z][a-z]+)?)-[A-Z][A-Za-z]*$/u.exec(word);
  return cmdlet !== null && POWERSHELL_VERBS.has(cmdlet[1]!);
}

/**
 * The grammar to highlight a command with: PowerShell when pwsh or powershell
 * runs it, or when it is written in PowerShell, as Windows agents run it.
 */
export function commandHighlightLanguage(command: string): "powershell" | "shellscript" {
  const program = /^(?:&\s*)?(?:"([^"]*)"|'([^']*)'|(\S+))/u.exec(command.trim());
  const name = (program?.[1] ?? program?.[2] ?? program?.[3] ?? "")
    .split(/[\\/]/u)
    .at(-1)
    ?.toLowerCase()
    .replace(/\.exe$/u, "");
  if (name && POWERSHELL_PROGRAMS.has(name)) return "powershell";
  return isPowerShellScript(command) ? "powershell" : "shellscript";
}

/** Whether any statement starts like PowerShell and never like POSIX shell. */
function isPowerShellScript(command: string): boolean {
  let rest: string | null = command.trim();
  // A leading call operator; POSIX shell cannot start a command with `&`.
  if (/^&\s*\S/u.test(rest)) return true;
  for (let segment = 0; rest && segment < MAX_COMMAND_SEGMENTS; segment += 1) {
    const { firstCommand, remainingCommand } = splitFirstShellCommand(rest);
    const statement = firstCommand.trim();
    if (
      // `$env:NAME` or `$name = value`; neither parses as POSIX shell.
      /^\$(?:env|global|local|script):/iu.test(statement) ||
      /^\$[A-Za-z_]\w*\s+=/u.test(statement) ||
      isPowerShellCmdlet(statement.match(/^\S+/u)?.[0] ?? "")
    ) {
      return true;
    }
    rest = remainingCommand;
  }
  return false;
}

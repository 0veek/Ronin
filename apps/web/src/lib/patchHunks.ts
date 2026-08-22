/**
 * Slices the patch the diff panel is rendering back into patches git will accept.
 *
 * A hunk action has to hand git exactly the change that sat under the pointer, so the slice comes
 * out of the original patch text rather than out of the parsed render model: rebuilding a hunk from
 * the model would have to re-guess whitespace and end-of-file markers that git is strict about.
 *
 * Hunks are addressed by file line number, not by index, because the viewer reshapes hunks once a
 * file expands to its full contents while line numbers stay in the coordinates the headers use.
 */

export type PatchLineSide = "additions" | "deletions";

export interface PatchHunk {
  readonly text: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly additions: number;
  readonly deletions: number;
  /** The patch ended before the header's line counts were satisfied, so this slice cannot apply. */
  readonly truncated: boolean;
}

export interface PatchFileSection {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly headerText: string;
  readonly hunks: ReadonlyArray<PatchHunk>;
  /**
   * A `--no-index` diff against `/dev/null` for a file git is not tracking. It has no committed
   * side to fall back to, so reverting it would delete work outright.
   */
  readonly untracked: boolean;
  readonly binary: boolean;
}

export interface PatchHunkTarget {
  readonly section: PatchFileSection;
  readonly hunk: PatchHunk;
  readonly hunkIndex: number;
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Git C-quotes a path whenever it holds a control character, a quote, or a non-ASCII byte, and its
 * octal escapes are UTF-8 bytes rather than code points -- so the bytes are collected and decoded
 * once at the end instead of per escape.
 */
function unquoteGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  const body = value.slice(1, -1);
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] as string;
    if (char !== "\\") {
      bytes.push(...encoder.encode(char));
      continue;
    }
    const next = body[index + 1];
    if (next === undefined) break;
    index += 1;
    const octal = body.slice(index, index + 3);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      index += 2;
      continue;
    }
    switch (next) {
      case "n":
        bytes.push(0x0a);
        break;
      case "t":
        bytes.push(0x09);
        break;
      case "r":
        bytes.push(0x0d);
        break;
      default:
        bytes.push(...encoder.encode(next));
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** `--- a/src/x.ts` and `+++ b/src/x.ts` carry the only unambiguous copy of each side's path. */
function readSidePath(line: string, prefix: string): string | null {
  const raw = unquoteGitPath(line.slice(prefix.length).trim());
  if (raw === "/dev/null") return null;
  return raw.startsWith("a/") || raw.startsWith("b/") ? raw.slice(2) : raw;
}

interface HunkAccumulator {
  readonly headerLine: string;
  readonly bodyLines: string[];
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  remainingOld: number;
  remainingNew: number;
  additions: number;
  deletions: number;
}

function finalizeHunk(accumulator: HunkAccumulator): PatchHunk {
  return {
    text: [accumulator.headerLine, ...accumulator.bodyLines].join("\n"),
    oldStart: accumulator.oldStart,
    oldCount: accumulator.oldCount,
    newStart: accumulator.newStart,
    newCount: accumulator.newCount,
    additions: accumulator.additions,
    deletions: accumulator.deletions,
    truncated: accumulator.remainingOld > 0 || accumulator.remainingNew > 0,
  };
}

interface SectionAccumulator {
  readonly headerLines: string[];
  readonly hunks: PatchHunk[];
  oldPath: string | null;
  newPath: string | null;
  sawDevNullOldSide: boolean;
  declaredNewFile: boolean;
  binary: boolean;
  hunk: HunkAccumulator | null;
}

function newSection(): SectionAccumulator {
  return {
    headerLines: [],
    hunks: [],
    oldPath: null,
    newPath: null,
    sawDevNullOldSide: false,
    declaredNewFile: false,
    binary: false,
    hunk: null,
  };
}

function finalizeSection(accumulator: SectionAccumulator): PatchFileSection {
  if (accumulator.hunk) {
    accumulator.hunks.push(finalizeHunk(accumulator.hunk));
    accumulator.hunk = null;
  }
  return {
    oldPath: accumulator.oldPath,
    newPath: accumulator.newPath,
    headerText: accumulator.headerLines.join("\n"),
    hunks: accumulator.hunks,
    // A staged addition still says `new file mode`; the synthetic `--no-index` diff of an
    // untracked file never does, which is what separates the two here.
    untracked: accumulator.sawDevNullOldSide && !accumulator.declaredNewFile,
    binary: accumulator.binary,
  };
}

/** Splits a multi-file unified diff into per-file sections with their hunks kept verbatim. */
export function splitPatchSections(patch: string): ReadonlyArray<PatchFileSection> {
  if (patch.trim().length === 0) return [];

  const sections: PatchFileSection[] = [];
  let current: SectionAccumulator | null = null;

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ") || line.startsWith("diff --no-index ")) {
      if (current) sections.push(finalizeSection(current));
      current = newSection();
      current.headerLines.push(line);
      continue;
    }
    if (!current) continue;

    if (current.hunk) {
      const marker = line[0];
      if (marker === "\\") {
        current.hunk.bodyLines.push(line);
        continue;
      }
      const exhausted = current.hunk.remainingOld <= 0 && current.hunk.remainingNew <= 0;
      if (!exhausted && (marker === " " || marker === "+" || marker === "-" || line === "")) {
        current.hunk.bodyLines.push(line === "" ? " " : line);
        if (marker === "+") {
          current.hunk.remainingNew -= 1;
          current.hunk.additions += 1;
        } else if (marker === "-") {
          current.hunk.remainingOld -= 1;
          current.hunk.deletions += 1;
        } else {
          current.hunk.remainingOld -= 1;
          current.hunk.remainingNew -= 1;
        }
        continue;
      }
      current.hunks.push(finalizeHunk(current.hunk));
      current.hunk = null;
    }

    const hunkHeader = HUNK_HEADER_PATTERN.exec(line);
    if (hunkHeader) {
      const oldCount = hunkHeader[2] === undefined ? 1 : Number(hunkHeader[2]);
      const newCount = hunkHeader[4] === undefined ? 1 : Number(hunkHeader[4]);
      current.hunk = {
        headerLine: line,
        bodyLines: [],
        oldStart: Number(hunkHeader[1]),
        oldCount,
        newStart: Number(hunkHeader[3]),
        newCount,
        remainingOld: oldCount,
        remainingNew: newCount,
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    // Everything before the first hunk is file header: mode lines, rename lines, the blob index.
    if (current.hunks.length === 0) {
      current.headerLines.push(line);
      if (line.startsWith("--- ")) {
        current.oldPath = readSidePath(line, "--- ");
        if (current.oldPath === null) current.sawDevNullOldSide = true;
      } else if (line.startsWith("+++ ")) {
        current.newPath = readSidePath(line, "+++ ");
      } else if (line.startsWith("new file mode ")) {
        current.declaredNewFile = true;
      } else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
        current.binary = true;
      }
    }
  }

  if (current) sections.push(finalizeSection(current));
  return sections;
}

/** Matches on the post-change path first so a rename resolves to the name the panel shows. */
export function findPatchSection(
  sections: ReadonlyArray<PatchFileSection>,
  filePath: string,
): PatchFileSection | null {
  return (
    sections.find((section) => section.newPath === filePath) ??
    sections.find((section) => section.oldPath === filePath) ??
    null
  );
}

function hunkContainsLine(hunk: PatchHunk, lineNumber: number, side: PatchLineSide): boolean {
  const start = side === "deletions" ? hunk.oldStart : hunk.newStart;
  const count = side === "deletions" ? hunk.oldCount : hunk.newCount;
  // A hunk that only adds declares `-x,0`, whose header start sits on the line before the change.
  if (count === 0) return lineNumber === start || lineNumber === start + 1;
  return lineNumber >= start && lineNumber < start + count;
}

/** Resolves the hunk a hovered or selected line sits in, on either side of a split view. */
export function findPatchHunkAtLine(input: {
  readonly sections: ReadonlyArray<PatchFileSection>;
  readonly filePath: string;
  readonly lineNumber: number;
  readonly side: PatchLineSide;
}): PatchHunkTarget | null {
  const section = findPatchSection(input.sections, input.filePath);
  if (!section) return null;

  const sides: ReadonlyArray<PatchLineSide> =
    input.side === "deletions" ? ["deletions", "additions"] : ["additions", "deletions"];
  for (const side of sides) {
    const hunkIndex = section.hunks.findIndex((hunk) =>
      hunkContainsLine(hunk, input.lineNumber, side),
    );
    const hunk = hunkIndex < 0 ? undefined : section.hunks[hunkIndex];
    if (hunk) return { section, hunk, hunkIndex };
  }
  return null;
}

/** A one-hunk patch. Its headers stay in the old file's coordinates, which is what git applies to. */
export function buildHunkPatch(section: PatchFileSection, hunk: PatchHunk): string | null {
  if (hunk.truncated || section.binary || section.headerText.length === 0) return null;
  return `${section.headerText}\n${hunk.text}\n`;
}

/** Every hunk of one file, for the file-level action in the diff header. */
export function buildFilePatch(section: PatchFileSection): string | null {
  if (section.binary || section.hunks.length === 0 || section.headerText.length === 0) return null;
  if (section.hunks.some((hunk) => hunk.truncated)) return null;
  return `${section.headerText}\n${section.hunks.map((hunk) => hunk.text).join("\n")}\n`;
}

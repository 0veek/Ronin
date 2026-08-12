/**
 * How a build's stage becomes part of its name.
 *
 * Shared because two processes decide it independently: the desktop main
 * process stamps a display name into the branding it injects, and the renderer
 * formats its own when there is no desktop bridge. They have to agree, and
 * before this they agreed only by coincidence.
 *
 * @module appDisplayName
 */

/**
 * Stages that are simply the product, with nothing appended.
 *
 * A shipping build is called Ronin. Only the ones a user needs warning about
 * -- a dev build, a nightly -- earn a suffix.
 */
const UNSUFFIXED_STAGE_LABELS: ReadonlySet<string> = new Set(["stable", "latest"]);

export function formatAppDisplayName(input: {
  readonly baseName: string;
  readonly stageLabel: string;
}): string {
  return UNSUFFIXED_STAGE_LABELS.has(input.stageLabel.trim().toLowerCase())
    ? input.baseName
    : `${input.baseName} (${input.stageLabel})`;
}

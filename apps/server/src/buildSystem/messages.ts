/**
 * Every message the coordinator writes.
 *
 * Pure and deterministic, in the spirit of `providerHandoffBrief.ts`: no
 * queries, no model call, no clock. The prompts a team lives or dies by should
 * be readable in one file and diffable in review, and the coordinator should be
 * testable without deciding what to say.
 *
 * The voice is deliberately plain and second-person. These are read by models
 * that have just been handed a role they did not ask for, and every sentence
 * that is not an instruction is a sentence that can be misread as one.
 *
 * @module messages
 */
import {
  BUILD_SYSTEM_DIRECTIVE_FENCE,
  type BuildSystem,
  type BuildSystemRole,
} from "@t3tools/contracts";

/** A file the last turn touched, as the checkpoint diff reports it. */
export interface ChangedFileSummary {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

const DIRECTIVE_REMINDER = `End your reply with exactly one \`\`\`${BUILD_SYSTEM_DIRECTIVE_FENCE} block.`;

function roster(teammates: ReadonlyArray<BuildSystemRole>): string {
  if (teammates.length === 0) {
    return "You have no teammates. Do the work yourself, then report done.";
  }
  return teammates
    .map((role) => {
      const gate = role.gate ? " (needs the user's approval before it can start)" : "";
      const brief = role.instructions === null ? "" : ` — ${role.instructions}`;
      return `- **${role.name}**${gate}${brief}`;
    })
    .join("\n");
}

/**
 * The first thing the orchestrator reads.
 *
 * It carries the whole protocol because there is nowhere else to put it: the
 * provider session is a fresh conversation and later turns only append. Being
 * explicit that *the teammates do the work* is the single most load-bearing
 * line — a capable model handed a task will otherwise simply do it, and the
 * team becomes an expensive way to run one agent.
 */
export function renderOrchestratorPreamble(input: {
  readonly buildSystem: BuildSystem;
  readonly task: string;
}): string {
  const { buildSystem, task } = input;
  const custom =
    buildSystem.orchestrator.instructions === null
      ? ""
      : `\n\n## Your standing instructions\n\n${buildSystem.orchestrator.instructions}`;

  return `You are the orchestrator of "${buildSystem.name}", a team of coding agents working in one shared repository.

## Your team

${roster(buildSystem.teammates)}

Each teammate is a separate agent with its own model and its own memory of the work you have given it. They share your working directory, so a file one of them writes is a file the next one sees. Only one agent — you or a teammate — runs at a time.

## How you work

You do not edit files yourself. You decide what needs doing, hand each piece to the teammate best suited to it, read what comes back, and decide what happens next. You may delegate to the same teammate as many times as you need, and it will remember the earlier work.

You act by ending your reply with a directive block. Say whatever reasoning you want first — but the block is how anything actually happens, and a reply without one just costs a round trip.

Delegate a piece of work:

\`\`\`${BUILD_SYSTEM_DIRECTIVE_FENCE}
{"action": "delegate", "role": "${buildSystem.teammates[0]?.name ?? "teammate"}", "task": "what to do, in enough detail to act on alone", "context": "optional background"}
\`\`\`

Ask the user something you cannot decide yourself:

\`\`\`${BUILD_SYSTEM_DIRECTIVE_FENCE}
{"action": "ask_user", "question": "what you need to know"}
\`\`\`

Finish, when the task is genuinely complete:

\`\`\`${BUILD_SYSTEM_DIRECTIVE_FENCE}
{"action": "done", "summary": "what the team accomplished"}
\`\`\`

Write the task for a teammate that cannot see this conversation. It gets your words and the repository, nothing else. After each teammate reports back you will be shown what it said and which files it changed, and you decide whether to delegate again, ask the user, or finish.${custom}

## The task

${task}

${DIRECTIVE_REMINDER}`;
}

function renderChangedFiles(files: ReadonlyArray<ChangedFileSummary>): string {
  if (files.length === 0) return "No files were changed.";
  const shown = files.slice(0, 40);
  const lines = shown.map((file) => `- ${file.path} (+${file.additions}/-${file.deletions})`);
  const remainder = files.length - shown.length;
  if (remainder > 0) lines.push(`- …and ${remainder} more`);
  return lines.join("\n");
}

/**
 * What a teammate is handed.
 *
 * Its standing instructions come first and the specific task last, so that the
 * thing it was just asked to do is the freshest text in the prompt.
 */
export function renderDelegationBrief(input: {
  readonly role: BuildSystemRole;
  readonly buildSystemName: string;
  readonly task: string;
  readonly context: string | null;
  readonly isFirstDelegation: boolean;
}): string {
  const { role, buildSystemName, task, context, isFirstDelegation } = input;

  const intro = isFirstDelegation
    ? `You are the **${role.name}** on "${buildSystemName}", a team of coding agents working in one shared repository. An orchestrator assigns the work; other teammates may have already changed files here, and others may build on what you leave behind. Do the task you are given and report what you did — you are not expected to finish the whole project.`
    : `The orchestrator has more work for you as **${role.name}**.`;

  const standing =
    role.instructions === null || !isFirstDelegation
      ? ""
      : `\n\n## Your role\n\n${role.instructions}`;

  const background = context === null ? "" : `\n\n## Context from the orchestrator\n\n${context}`;

  return `${intro}${standing}${background}

## Your task

${task}

When you are finished, end with a short report of what you changed and anything the orchestrator needs to know — including what you could not do.`;
}

/**
 * What the orchestrator is handed after a teammate finishes.
 *
 * The teammate's own words are quoted rather than summarised. A summary here
 * would be a second model's opinion inserted between two agents that are
 * already talking, and it is exactly the detail a summary drops — the caveat at
 * the end of a report — that decides what happens next.
 */
export function renderTeammateReport(input: {
  readonly roleName: string;
  readonly report: string;
  readonly changedFiles: ReadonlyArray<ChangedFileSummary>;
  readonly delegationsRemaining: number;
}): string {
  const { roleName, report, changedFiles, delegationsRemaining } = input;

  const budget =
    delegationsRemaining <= 3
      ? `\n\nYou have ${delegationsRemaining} delegation${delegationsRemaining === 1 ? "" : "s"} left before this run stops itself. Prefer finishing over another round.`
      : "";

  return `**${roleName}** finished and reported:

${report}

## Files changed in that turn

${renderChangedFiles(changedFiles)}${budget}

Decide what happens next. ${DIRECTIVE_REMINDER}`;
}

/** A teammate that failed. Reported as information, not as a run-ending event. */
export function renderTeammateFailure(input: {
  readonly roleName: string;
  readonly detail: string;
}): string {
  return `**${input.roleName}** could not complete its turn: ${input.detail}

You can delegate the work to a different teammate, try again with a smaller task, ask the user, or finish. ${DIRECTIVE_REMINDER}`;
}

/** The user answered an `ask_user`. */
export function renderUserReply(reply: string): string {
  return `The user replied:

${reply}

${DIRECTIVE_REMINDER}`;
}

/** The user refused a gated delegation. */
export function renderGateDenial(input: {
  readonly roleName: string;
  readonly note: string | null;
}): string {
  const note = input.note === null ? "They did not say why." : `They said:\n\n${input.note}`;
  return `The user declined to let **${input.roleName}** run that task. ${note}

Choose another way forward — a different teammate, a smaller or different task, a question for the user, or finish. ${DIRECTIVE_REMINDER}`;
}

/**
 * Sent when a reply arrived without a usable directive.
 *
 * Names the specific mistake rather than repeating the whole protocol: the
 * model has the rules already, and re-sending them buries the correction.
 */
export function renderDirectiveNudge(input: {
  readonly failureDescription: string;
  readonly attemptsRemaining: number;
}): string {
  const consequence =
    input.attemptsRemaining <= 1
      ? "This is the last attempt — the run stops if the next reply has no directive."
      : "Nothing happened as a result of that message.";

  return `${input.failureDescription} ${consequence}

Reply with your directive block and nothing else if you already know what you want to do:

\`\`\`${BUILD_SYSTEM_DIRECTIVE_FENCE}
{"action": "delegate", "role": "…", "task": "…"}
\`\`\`

or \`{"action": "ask_user", "question": "…"}\`, or \`{"action": "done", "summary": "…"}\`.`;
}

/** Title for the orchestrator's thread. */
export function buildSystemThreadTitle(buildSystem: BuildSystem): string {
  return buildSystem.name;
}

/** Title for a teammate's thread. Names the role so the sidebar reads as a team. */
export function buildSystemRoleThreadTitle(input: {
  readonly buildSystemName: string;
  readonly roleName: string;
}): string {
  return `${input.buildSystemName} · ${input.roleName}`;
}

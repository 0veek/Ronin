import { describe, expect, it } from "vite-plus/test";
import {
  type BuildSystem,
  BuildSystemId,
  BuildSystemRoleId,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";

import {
  buildSystemRoleThreadTitle,
  buildSystemThreadTitle,
  renderDelegationBrief,
  renderDirectiveNudge,
  renderGateDenial,
  renderOrchestratorPreamble,
  renderTeammateFailure,
  renderTeammateReport,
  renderUserReply,
} from "./messages.ts";

const SYSTEM: BuildSystem = {
  id: BuildSystemId.make("bs-1"),
  projectId: ProjectId.make("p-1"),
  name: "Ship it",
  description: null,
  orchestrator: {
    modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "opus" },
    instructions: "Prefer small diffs.",
  },
  teammates: [
    {
      id: BuildSystemRoleId.make("r-1"),
      name: "implementer",
      instructions: "Write the code.",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.1-codex" },
      gate: false,
    },
    {
      id: BuildSystemRoleId.make("r-2"),
      name: "reviewer",
      instructions: null,
      modelSelection: { instanceId: ProviderInstanceId.make("grok"), model: "grok-4" },
      gate: true,
    },
  ],
  maxDelegations: 20,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

describe("build system messages", () => {
  it("teaches the orchestrator the protocol and names the gated role", () => {
    const text = renderOrchestratorPreamble({ buildSystem: SYSTEM, task: "Add the parser." });

    expect(text).toContain('You are the orchestrator of "Ship it"');
    expect(text).toContain("**implementer**");
    expect(text).toContain("**reviewer** (needs the user's approval before it can start)");
    expect(text).toContain("Prefer small diffs.");
    expect(text).toContain("Add the parser.");
    expect(text).toContain("```t3-directive");
    expect(text).toContain('"action": "delegate"');
  });

  it("puts standing instructions only on a teammate's first brief", () => {
    const first = renderDelegationBrief({
      role: SYSTEM.teammates[0]!,
      buildSystemName: SYSTEM.name,
      task: "Write parseDirective",
      context: "see src/",
      isFirstDelegation: true,
    });
    const next = renderDelegationBrief({
      role: SYSTEM.teammates[0]!,
      buildSystemName: SYSTEM.name,
      task: "Add tests",
      context: null,
      isFirstDelegation: false,
    });

    expect(first).toContain("Write the code.");
    expect(first).toContain("see src/");
    expect(first).toContain("Write parseDirective");
    expect(next).not.toContain("Write the code.");
    expect(next).toContain("Add tests");
  });

  it("quotes a teammate report and warns when delegations are almost gone", () => {
    const text = renderTeammateReport({
      roleName: "implementer",
      report: "Added the parser.",
      changedFiles: [{ path: "src/parse.ts", additions: 12, deletions: 1 }],
      delegationsRemaining: 1,
    });

    expect(text).toContain("Added the parser.");
    expect(text).toContain("src/parse.ts (+12/-1)");
    expect(text).toContain("1 delegation left");
    expect(text).toContain("```t3-directive");
  });

  it("renders the other coordinator messages the run loop sends", () => {
    expect(renderTeammateFailure({ roleName: "reviewer", detail: "quota" })).toContain("quota");
    expect(renderUserReply("use sqlite")).toContain("use sqlite");
    expect(renderGateDenial({ roleName: "reviewer", note: null })).toContain("did not say why");
    expect(
      renderDirectiveNudge({ failureDescription: "Missing block.", attemptsRemaining: 1 }),
    ).toContain("last attempt");
    expect(buildSystemThreadTitle(SYSTEM)).toBe("Ship it");
    expect(buildSystemRoleThreadTitle({ buildSystemName: "Ship it", roleName: "reviewer" })).toBe(
      "Ship it · reviewer",
    );
  });
});

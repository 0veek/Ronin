import { describe, expect, it } from "vite-plus/test";
import {
  type BuildSystem,
  BuildSystemId,
  BuildSystemRoleId,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";

import {
  draftFromBuildSystem,
  draftToCreateInput,
  emptyRoleDraft,
  isBuildSystemDraftComplete,
  nextRoleDraftKey,
  startBuildSystemDraft,
  startBuildSystemDraftFromSearch,
} from "./buildSystemDraft";

const MODEL = { instanceId: ProviderInstanceId.make("claude"), model: "opus" };

const SYSTEM: BuildSystem = {
  id: BuildSystemId.make("bs-1"),
  projectId: ProjectId.make("p-1"),
  name: "Ship it",
  description: "A team",
  orchestrator: { modelSelection: MODEL, instructions: "Lead." },
  teammates: [
    {
      id: BuildSystemRoleId.make("r-1"),
      name: "implementer",
      instructions: "Write.",
      modelSelection: MODEL,
      gate: false,
    },
  ],
  maxDelegations: 12,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
};

describe("buildSystemDraft", () => {
  it("opens a new draft from a settings search", () => {
    expect(startBuildSystemDraftFromSearch({}, ["p-1"])).toBeNull();
    expect(startBuildSystemDraftFromSearch({ create: true }, ["p-1"])?.projectId).toBe("p-1");
    expect(
      startBuildSystemDraftFromSearch({ create: true, projectId: "p-2" }, ["p-1"])?.projectId,
    ).toBe("p-2");
  });

  it("is incomplete until the orchestrator and every teammate have a model and a name", () => {
    const base = {
      ...startBuildSystemDraft("p-1"),
      name: "Ship it",
      orchestratorModelSelection: MODEL,
    };
    expect(isBuildSystemDraftComplete(base)).toBe(true);
    expect(
      isBuildSystemDraftComplete({
        ...base,
        teammates: [emptyRoleDraft("k1", MODEL)],
      }),
    ).toBe(false);
    expect(
      isBuildSystemDraftComplete({
        ...base,
        teammates: [{ ...emptyRoleDraft("k1", MODEL), name: "implementer" }],
      }),
    ).toBe(true);
    expect(
      isBuildSystemDraftComplete({
        ...base,
        teammates: [
          { ...emptyRoleDraft("k1", MODEL), name: "reviewer" },
          { ...emptyRoleDraft("k2", MODEL), name: "Reviewer" },
        ],
      }),
    ).toBe(false);
  });

  it("refuses a delegation cap the server would reject", () => {
    const base = {
      ...startBuildSystemDraft("p-1"),
      name: "Team",
      orchestratorModelSelection: MODEL,
    };
    expect(isBuildSystemDraftComplete({ ...base, maxDelegations: 200 })).toBe(true);
    expect(isBuildSystemDraftComplete({ ...base, maxDelegations: 201 })).toBe(false);
    expect(isBuildSystemDraftComplete({ ...base, maxDelegations: 0 })).toBe(false);
  });

  it("mints a role key that no surviving row is using", () => {
    const first = nextRoleDraftKey([]);
    const second = nextRoleDraftKey([emptyRoleDraft(first)]);
    // Removing the first row and adding another must not reuse the second key.
    const third = nextRoleDraftKey([emptyRoleDraft(second)]);
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("keeps saved role ids out of the way when minting a key", () => {
    expect(nextRoleDraftKey([emptyRoleDraft("role-abc"), emptyRoleDraft("new-4")])).toBe("new-5");
  });

  it("round-trips an existing build system into a create-shaped payload", () => {
    const draft = draftFromBuildSystem(SYSTEM);
    const input = draftToCreateInput(draft);
    expect(input).toMatchObject({
      projectId: "p-1",
      name: "Ship it",
      description: "A team",
      maxDelegations: 12,
    });
    expect(input?.teammates[0]).toMatchObject({ name: "implementer", gate: false });
  });
});

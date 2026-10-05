// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AutomationId,
  AuthOrchestrationOperateScope,
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type Automation,
  type AutomationCreateInput,
  type ServerProvider,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AutomationsSearch } from "../../automationDraft";
import { AutomationsSettingsPanel } from "./AutomationsSettingsPanel";

const io = vi.hoisted(() => ({
  create: vi.fn<(environmentId: EnvironmentId, input: AutomationCreateInput) => Promise<boolean>>(),
  update: vi.fn(),
  runNow: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
  readEnvironmentIds: [] as EnvironmentId[],
  automations: new Map<EnvironmentId, Automation[]>(),
  providers: new Map<EnvironmentId, ReadonlyArray<ServerProvider>>(),
  canOperate: true,
  onlyRemoteProjects: false,
}));

const primaryId = EnvironmentId.make("primary");
const remoteId = EnvironmentId.make("remote");
const projectId = ProjectId.make("shared-project-id");
const remoteSelection = {
  instanceId: ProviderInstanceId.make("codex_remote"),
  model: "remote-model",
};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => io.navigate,
  useLocation: () => ({ pathname: "/settings/automations", hash: "" }),
}));
vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => primaryId,
  useEnvironments: () => ({
    environments: [primaryId, remoteId].map((environmentId) => ({
      environmentId,
      label: environmentId === primaryId ? "My laptop" : "Remote workstation",
      connection: { phase: "connected", error: null },
    })),
  }),
}));
vi.mock("../../state/session", () => ({
  useEnvironmentSessionState: () => ({
    data: { authenticated: true, scopes: io.canOperate ? [AuthOrchestrationOperateScope] : [] },
    isPending: false,
    hasError: false,
  }),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () =>
    [
      {
        id: projectId,
        environmentId: primaryId,
        title: "Laptop project",
        defaultModelSelection: null,
      },
      {
        id: projectId,
        environmentId: remoteId,
        title: "Remote project",
        defaultModelSelection: remoteSelection,
      },
    ].filter((project) => !io.onlyRemoteProjects || project.environmentId === remoteId),
}));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: (selector: (settings: typeof DEFAULT_UNIFIED_SETTINGS) => unknown) =>
    selector(DEFAULT_UNIFIED_SETTINGS),
  useEnvironmentSettings: () => DEFAULT_UNIFIED_SETTINGS,
  usePrimarySettingsAvailable: () => true,
}));
vi.mock("../../state/server", () => ({
  EMPTY_SERVER_PROVIDERS: [],
  serverEnvironment: { providersValueAtom: (environmentId: EnvironmentId) => environmentId },
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (environmentId: EnvironmentId) => io.providers.get(environmentId),
}));
vi.mock("../chat/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("../chat/TraitsPicker", () => ({ TraitsPicker: () => null }));
vi.mock("../../state/automations", () => ({
  useAutomations: (environmentId: EnvironmentId) => {
    io.readEnvironmentIds.push(environmentId);
    return {
      environmentId,
      automations: io.automations.get(environmentId) ?? [],
      runs: [],
      isLoading: false,
      error: null,
      refresh: () => {},
      create: async (input: AutomationCreateInput) => {
        const saved = await io.create(environmentId, input);
        if (saved)
          io.automations.set(environmentId, [
            ...(io.automations.get(environmentId) ?? []),
            makeAutomation(input),
          ]);
        return saved;
      },
      update: io.update,
      remove: io.remove,
      runNow: io.runNow,
    };
  },
}));

function makeAutomation(input: AutomationCreateInput): Automation {
  return {
    ...input,
    id: AutomationId.make("automation-1"),
    enabled: true,
    modelSelection: input.modelSelection ?? null,
    stopAfterConsecutiveFailures: input.stopAfterConsecutiveFailures ?? 3,
    consecutiveFailureCount: 0,
    disabledReason: null,
    disabledAt: null,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: "2026-10-05T16:00:00.000Z",
  };
}

let root: Root;
let container: HTMLDivElement;

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === text || element.getAttribute("aria-label") === text,
  );
  if (!found) throw new Error(`No button: ${text}`);
  return found;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function render(search: AutomationsSearch = { environmentId: remoteId }) {
  await act(async () => root.render(<AutomationsSettingsPanel createIntent={search} />));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  io.readEnvironmentIds = [];
  io.automations.clear();
  io.canOperate = true;
  io.onlyRemoteProjects = false;
  io.create.mockResolvedValue(true);
  io.providers.clear();
  io.providers.set(remoteId, [
    {
      instanceId: remoteSelection.instanceId,
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      installed: true,
      status: "ready",
      version: "1.0.0",
      auth: { status: "authenticated" },
      checkedAt: "2026-10-05T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("automation workflows", () => {
  it("keeps a manually written primary draft after failure and saves it on retry", async () => {
    io.create.mockResolvedValueOnce(false);
    await render({});
    await click(button("New automation"));
    const name = container.querySelector<HTMLInputElement>(
      'input[placeholder="Triage new issues"]',
    )!;
    const prompt = container.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        name,
        "Important job",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        prompt,
        "Long prompt to keep",
      );
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Save automation"));
    expect(name.value).toBe("Important job");
    expect(prompt.value).toBe("Long prompt to keep");
    expect(io.create).toHaveBeenCalledExactlyOnceWith(
      primaryId,
      expect.objectContaining({ projectId, prompt: "Long prompt to keep" }),
    );
    await click(button("Save automation"));
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("does not offer a primary automation when only remote projects exist", async () => {
    io.onlyRemoteProjects = true;
    await render({});
    expect(container.textContent).toContain("No projects in this environment");
    expect(container.textContent).not.toContain("New automation");
    await render({ environmentId: remoteId });
    expect(container.textContent).toContain("Start from a recipe");
  });

  it("reviews a recipe in a draft, pins the remote model, and saves on that machine", async () => {
    await render();
    const recipeButton = [...container.querySelectorAll("button")].find((element) =>
      element.textContent?.startsWith("Regression patrol"),
    );
    expect(recipeButton).toBeDefined();
    await click(recipeButton!);
    expect(io.create).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")?.value).toContain("reproducible failure");
    expect(container.textContent).toContain("Remote project");
    expect(container.textContent).not.toContain("Laptop project");
    await click(button("Choose a model"));
    await click(button("Save automation"));
    expect(io.create).toHaveBeenCalledExactlyOnceWith(
      remoteId,
      expect.objectContaining({
        projectId,
        envMode: "worktree",
        modelSelection: remoteSelection,
        schedule: { _tag: "daily", timeOfDay: 960, weekdays: [1, 2, 3, 4, 5] },
      }),
    );
    expect(io.automations.get(primaryId)).toBeUndefined();
    expect(container.querySelector("textarea")).toBeNull();
    expect(button("Duplicate Regression patrol")).toBeDefined();
    expect(io.runNow).not.toHaveBeenCalled();
    expect(io.readEnvironmentIds.every((environmentId) => environmentId === remoteId)).toBe(true);
  });

  it("preserves a failed draft, prevents duplicate saves in flight, and permits retry", async () => {
    let finish = (_saved: boolean) => {};
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    io.create.mockReturnValueOnce(pending);
    await render();
    const recipeButton = [...container.querySelectorAll("button")].find((element) =>
      element.textContent?.startsWith("Morning brief"),
    );
    await click(recipeButton!);
    const save = button("Save automation");
    await act(async () => {
      save.click();
      save.click();
    });
    expect(io.create).toHaveBeenCalledTimes(1);
    expect(button("Saving…").disabled).toBe(true);
    await act(async () => finish(false));
    expect(container.querySelector("textarea")?.value).toContain("morning brief");
    expect(button("Save automation").disabled).toBe(false);
    await click(button("Save automation"));
    expect(io.create).toHaveBeenCalledTimes(2);
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("duplicates configuration as an unsaved draft and can cancel it", async () => {
    io.automations.set(remoteId, [
      makeAutomation({
        projectId,
        title: "My report",
        prompt: "Summarize changes.",
        schedule: { _tag: "interval", everyMinutes: 120 },
        envMode: "local",
        modelSelection: remoteSelection,
      }),
    ]);
    await render();
    await click(button("Duplicate My report"));
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="Triage new issues"]')?.value,
    ).toBe("My report (copy)");
    expect(container.querySelector("textarea")?.value).toBe("Summarize changes.");
    expect(io.create).not.toHaveBeenCalled();
    await click(button("Cancel"));
    expect(container.querySelector("textarea")).toBeNull();
    expect(io.automations.get(remoteId)).toHaveLength(1);
  });

  it("shows read-only schedules and restores creation after permissions change", async () => {
    io.canOperate = false;
    await render();
    expect(container.textContent).toContain("Read-only access");
    expect(container.textContent).not.toContain("Start from a recipe");
    io.canOperate = true;
    await render();
    expect(container.textContent).toContain("Start from a recipe");
    expect(io.create).not.toHaveBeenCalled();
  });

  it("never falls back to the primary for a missing remote creation intent", async () => {
    await render({ create: true, projectId, environmentId: EnvironmentId.make("removed-machine") });
    expect(container.textContent).toContain("Machine unavailable");
    expect(io.readEnvironmentIds).toEqual([]);
    expect(io.create).not.toHaveBeenCalled();
  });
});

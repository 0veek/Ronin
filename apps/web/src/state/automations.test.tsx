// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { AutomationId, EnvironmentId, ProjectId, type Automation } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useAutomations, type AutomationsController } from "./automations";

const server = vi.hoisted(() => ({
  rows: new Map<EnvironmentId, Automation[]>(),
  failures: new Set<EnvironmentId>(),
  command:
    vi.fn<
      (
        kind: string,
        target: { environmentId: EnvironmentId; input: unknown },
      ) => Promise<{ _tag: "Success" }>
    >(),
  latest: null as AutomationsController | null,
}));

vi.mock("./server", async () => {
  const { Atom, AsyncResult } = await import("effect/unstable/reactivity");
  const Cause = await import("effect/Cause");
  const automations = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(() => list(environmentId)),
  );
  const runs = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make(AsyncResult.success({ runs: [] })),
  );
  return {
    serverEnvironment: {
      automations: ({ environmentId }: { environmentId: EnvironmentId }) =>
        automations(environmentId),
      automationRuns: ({ environmentId }: { environmentId: EnvironmentId }) => runs(environmentId),
      createAutomation: "create",
      updateAutomation: "update",
      deleteAutomation: "delete",
      runAutomationNow: "run",
    },
  };

  function list(environmentId: EnvironmentId) {
    return server.failures.has(environmentId)
      ? AsyncResult.failure(Cause.fail(new Error("Machine unavailable")))
      : AsyncResult.success({ automations: server.rows.get(environmentId) ?? [] });
  }
});

vi.mock("./use-atom-command", () => ({
  useAtomCommand: (kind: string) => (target: { environmentId: EnvironmentId; input: unknown }) =>
    server.command(kind, target),
}));

const primary = EnvironmentId.make("primary");
const remote = EnvironmentId.make("remote");

function automation(title: string): Automation {
  return {
    id: AutomationId.make("same-job-id"),
    projectId: ProjectId.make("same-project-id"),
    title,
    prompt: "Write a report.",
    schedule: { _tag: "daily", timeOfDay: 540, weekdays: [] },
    envMode: "local",
    modelSelection: null,
    enabled: true,
    stopAfterConsecutiveFailures: 3,
    consecutiveFailureCount: 0,
    disabledReason: null,
    disabledAt: null,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    lastRunAt: null,
    nextRunAt: "2026-10-05T09:00:00.000Z",
  };
}

function Probe({ environmentId }: { environmentId: EnvironmentId }) {
  const controller = useAutomations(environmentId);
  useEffect(() => {
    server.latest = controller;
  }, [controller]);
  return <div>{controller.error ?? controller.automations.map((row) => row.title).join(", ")}</div>;
}

let root: Root;
let container: HTMLDivElement;
let registry: AtomRegistry.AtomRegistry;

async function render(environmentId: EnvironmentId) {
  await act(async () =>
    root.render(
      <RegistryContext value={registry}>
        <Probe environmentId={environmentId} />
      </RegistryContext>,
    ),
  );
  return server.latest!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  server.rows.clear();
  server.rows.set(primary, [automation("Laptop job")]);
  server.rows.set(remote, [automation("Remote job")]);
  server.failures.clear();
  server.command.mockReset().mockResolvedValue({ _tag: "Success" });
  registry = AtomRegistry.make();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  registry.dispose();
  container.remove();
  vi.unstubAllGlobals();
});

describe("automation environment queries", () => {
  it("keeps identically named project and automation IDs in separate machine caches", async () => {
    await render(primary);
    expect(container.textContent).toBe("Laptop job");
    const selected = await render(remote);
    expect(container.textContent).toBe("Remote job");
    server.rows.set(remote, [automation("Updated remote job")]);
    await act(async () => selected.refresh());
    expect(container.textContent).toBe("Updated remote job");
    await render(primary);
    expect(container.textContent).toBe("Laptop job");
  });

  it("finishes a pending write on its original machine after selection changes", async () => {
    let complete = () => {};
    server.command.mockImplementationOnce(async (_kind, { environmentId }) => {
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      server.rows.set(environmentId, [automation("Saved laptop job")]);
      return { _tag: "Success" };
    });
    const original = await render(primary);
    let save!: Promise<boolean>;
    await act(async () => {
      save = original.create({
        projectId: ProjectId.make("same-project-id"),
        title: "Saved laptop job",
        prompt: "Report",
        schedule: { _tag: "interval", everyMinutes: 60 },
        envMode: "local",
      });
    });
    await render(remote);
    await act(async () => {
      complete();
      expect(await save).toBe(true);
    });
    expect(container.textContent).toBe("Remote job");
    await render(primary);
    expect(container.textContent).toBe("Saved laptop job");
  });

  it("reports a failed query instead of representing it as a loaded empty schedule", async () => {
    server.failures.add(remote);
    const selected = await render(remote);
    expect(selected.error).toContain("Machine unavailable");
    expect(selected.isLoading).toBe(false);
    expect(container.textContent).toBe("Machine unavailable");
  });
});

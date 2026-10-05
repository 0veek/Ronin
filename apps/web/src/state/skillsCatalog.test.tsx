// @vitest-environment jsdom
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { type SkillsCatalogView, useEnvironmentSkillsCatalog } from "./skillsCatalog";

const harness = vi.hoisted(() => ({
  view: null as SkillsCatalogView | null,
  refresh: vi.fn(),
  query: vi.fn((input: unknown) => input),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => harness.view }));
vi.mock("../rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: harness.refresh } }));
vi.mock("./server", () => ({ serverEnvironment: { skillsCatalog: harness.query } }));
vi.mock("./environments", () => ({ usePrimaryEnvironmentId: () => "environment" }));
const environmentId = EnvironmentId.make("environment");
let container: HTMLDivElement;
let root: Root;
function Probe({ cwd }: { cwd: string }) {
  useEnvironmentSkillsCatalog(environmentId, cwd);
  return null;
}
async function render(cwd: string) {
  await act(async () => root.render(<Probe cwd={cwd} />));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  harness.view = {
    isPending: false,
    error: null,
    skills: [],
    roninSkillsDir: null,
    workspaceCommands: [
      {
        instanceId: ProviderInstanceId.make("claude"),
        slashCommands: [{ name: "compact" }],
        pending: true,
      },
    ],
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("workspace command retry", () => {
  it("retries a pending discovery after the delay with the current workspace", async () => {
    await render("/project-a");
    await act(() => vi.advanceTimersByTimeAsync(9_999));
    expect(harness.refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(harness.refresh).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { cwd: "/project-a" },
    });
  });
  it("cancels the old workspace retry when switching projects", async () => {
    await render("/project-a");
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    await render("/project-b");
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(harness.refresh).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(harness.refresh).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { cwd: "/project-b" },
    });
  });
  it("stops retrying when discovery completes or while a request is running", async () => {
    await render("/project-a");
    harness.view = {
      ...harness.view!,
      workspaceCommands: [{ ...harness.view!.workspaceCommands[0]!, pending: false }],
    };
    await render("/project-a");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(harness.refresh).not.toHaveBeenCalled();
    harness.view = {
      ...harness.view!,
      isPending: true,
      workspaceCommands: [{ ...harness.view!.workspaceCommands[0]!, pending: true }],
    };
    await render("/project-a");
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(harness.refresh).not.toHaveBeenCalled();
  });
  it("removes the scheduled retry on unmount", async () => {
    await render("/project-a");
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";

const harness = vi.hoisted(() => ({
  read: vi.fn(),
  command: vi.fn(),
  toast: vi.fn(),
  unsubscribe: vi.fn(),
  clones: [] as Array<{ projectId: string; phase: string }>,
  listener: null as ((clones: Array<{ projectId: string; phase: string }>) => void) | null,
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  executeAtomQuery: harness.read,
  runAtomCommand: harness.command,
  squashAtomCommandFailure: (result: { error: string }) => new Error(result.error),
}));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    subscribe: (_atom: unknown, listener: typeof harness.listener) => {
      harness.listener = listener;
      return harness.unsubscribe;
    },
    get: () => harness.clones,
  },
}));
vi.mock("../state/projectClones", () => ({ environmentProjectClonesAtom: () => "clones" }));
vi.mock("../state/projects", () => ({
  projectEnvironment: { readFile: (input: unknown) => input, writeFile: "write" },
}));
vi.mock("../state/sourceControl", () => ({
  sourceControlEnvironment: { startProjectClone: "clone" },
}));
vi.mock("../components/ui/toast", () => ({
  stackedThreadToast: (options: unknown) => options,
  toastManager: { add: harness.toast },
}));

import { addProjectToMachine, type AddProjectToMachineInput } from "./addProjectToMachine";

const input: AddProjectToMachineInput = {
  source: { environmentId: EnvironmentId.make("source"), cwd: "/source/web" },
  target: { environmentId: EnvironmentId.make("target"), label: "Remote" },
  subdirectory: "apps/web",
  projectId: ProjectId.make("new-project"),
  title: "Project",
  remoteUrl: "git@host:owner/repo.git",
  destinationPath: "/target/repo",
  files: [".env"],
};

beforeEach(() => {
  vi.resetAllMocks();
  harness.clones = [{ projectId: input.projectId, phase: "running" }];
  harness.listener = null;
  harness.read.mockResolvedValue({
    _tag: "Success",
    value: { contents: "TOKEN=value", truncated: false },
  });
  harness.command.mockResolvedValue({ _tag: "Success", value: { cwd: "/resolved/repo" } });
});

function publish(phase: string | null) {
  harness.clones = phase === null ? [] : [{ projectId: input.projectId, phase }];
  harness.listener?.(harness.clones);
}

function copyFinished() {
  return new Promise<void>((resolve) => {
    harness.toast.mockImplementation(() => resolve());
  });
}

describe("cross-machine project files", () => {
  it("waits for the clone receipt, including a retry, then copies the source snapshot into the repository subdirectory", async () => {
    const finished = copyFinished();
    await addProjectToMachine(input);
    expect(harness.command).toHaveBeenCalledTimes(1);
    expect(harness.read).toHaveBeenCalledWith(
      expect.anything(),
      {
        environmentId: input.source.environmentId,
        input: { cwd: "/source/web", relativePath: ".env" },
      },
      expect.objectContaining({ refresh: true }),
    );
    publish("failed");
    publish("running");
    expect(harness.command).toHaveBeenCalledTimes(1);
    publish("done");
    await finished;
    expect(harness.command).toHaveBeenLastCalledWith(
      expect.anything(),
      "write",
      {
        environmentId: input.target.environmentId,
        input: { cwd: "/resolved/repo", relativePath: "apps/web/.env", contents: "TOKEN=value" },
      },
      expect.anything(),
    );
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.toast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });

  it("does not write files after the clone is removed", async () => {
    await addProjectToMachine(input);
    publish(null);
    // Removal resolves the subscription promise; drain its continuation.
    await Promise.resolve();
    expect(harness.command).toHaveBeenCalledTimes(1);
    expect(harness.toast).not.toHaveBeenCalled();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it("reports unreadable, truncated, and failed writes while copying other files", async () => {
    const finished = copyFinished();
    harness.read
      .mockResolvedValueOnce({ _tag: "Failure", error: "Permission denied" })
      .mockResolvedValueOnce({ _tag: "Success", value: { contents: "partial", truncated: true } });
    harness.command
      .mockResolvedValueOnce({ _tag: "Success", value: { cwd: "/resolved/repo" } })
      .mockResolvedValueOnce({ _tag: "Failure", error: "Disk full" })
      .mockResolvedValueOnce({ _tag: "Success", value: {} });
    await addProjectToMachine({
      ...input,
      files: [".env", ".env.large", ".env.local", ".env.test"],
    });
    publish("done");
    await finished;
    expect(harness.command).toHaveBeenCalledTimes(3);
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        description:
          ".env: Permission denied\n.env.large: Too large to copy.\n.env.local: Disk full",
      }),
    );
  });

  it("leaves clone-start failures in the dialog without starting a copy subscription", async () => {
    harness.command.mockResolvedValueOnce({ _tag: "Failure", error: "Not authorized" });
    await expect(addProjectToMachine(input)).rejects.toThrow("Not authorized");
    expect(harness.listener).toBeNull();
  });
});

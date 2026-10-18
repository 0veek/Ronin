import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, type PullRequestRef } from "@t3tools/contracts";
import { useReviewGuideWriter } from "./useReviewGuideWriter";
import { guideRunKey, useGuideRunStore } from "./guideRunStore";

const state = vi.hoisted(() => ({
  enabled: true,
  permitted: true,
  generate: vi.fn(),
  toast: vi.fn(),
  query: vi.fn(),
}));
vi.mock("~/hooks/useSettings", () => ({ useEnvironmentSettings: () => state.enabled }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.permitted }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.generate }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (target: unknown) => {
    state.query(target);
    return { data: null, error: null, isPending: false, refresh: vi.fn() };
  },
}));
vi.mock("~/state/pullRequests", () => ({
  pullRequestEnvironment: {
    reviewGuide: (target: unknown) => target,
    generateReviewGuide: { permissionAtom: (id: unknown) => id },
  },
}));
vi.mock("../../ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("../pullRequestDetail.logic", () => ({
  readableFailure: (_error: unknown, fallback: string) => fallback,
}));

const reference: PullRequestRef = {
  projectId: ProjectId.make("project"),
  host: "github.com",
  repository: "acme/app",
  number: 7,
};
const first = EnvironmentId.make("first");
const second = EnvironmentId.make("second");
type Writer = ReturnType<typeof useReviewGuideWriter>;
let writer: Writer;
let renderer: ReactTestRenderer | undefined;
function Harness({ environmentId }: { environmentId: EnvironmentId }) {
  const current = useReviewGuideWriter({ environmentId, reference, title: "A change" });
  useLayoutEffect(() => {
    writer = current;
  });
  return null;
}
async function mount(environmentId = first) {
  await act(async () => {
    renderer = create(<Harness environmentId={environmentId} />);
  });
}
function deferred() {
  let resolve!: (value: { _tag: "Success" }) => void;
  const promise = new Promise<{ _tag: "Success" }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  state.enabled = true;
  state.permitted = true;
  state.generate.mockReset();
  state.toast.mockReset();
  state.query.mockClear();
  useGuideRunStore.setState({ watches: {}, shownKey: null, openRequestKey: null, progress: {} });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe("review guide generation", () => {
  it("keeps a disabled beta free of reads and model requests", async () => {
    state.enabled = false;
    await mount();
    expect(state.query).toHaveBeenLastCalledWith(null);
    await act(async () => {
      await writer.write();
    });
    expect(writer.canWrite).toBe(false);
    expect(state.generate).not.toHaveBeenCalled();
    expect(Object.keys(useGuideRunStore.getState().watches)).toEqual([]);
  });

  it("enforces operate permission before asking the server to generate", async () => {
    state.permitted = false;
    await mount();
    await act(async () => {
      await writer.write();
    });
    expect(state.generate).not.toHaveBeenCalled();
  });

  it("coalesces rapid presses and watches completion in the originating environment", async () => {
    const run = deferred();
    state.generate.mockReturnValue(run.promise);
    await mount();
    let pending!: Promise<void>;
    await act(async () => {
      pending = writer.write();
      void writer.write();
    });
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(writer.running).toBe(true);
    expect(useGuideRunStore.getState().watches[guideRunKey(first, reference)]?.environmentId).toBe(
      first,
    );
    await act(async () => {
      run.resolve({ _tag: "Success" });
      await pending;
    });
    expect(writer.running).toBe(false);
    expect(useGuideRunStore.getState().watches[guideRunKey(first, reference)]).toBeDefined();
  });

  it("does not let an older environment's response clear a new request", async () => {
    const oldRun = deferred();
    const newRun = deferred();
    state.generate.mockReturnValueOnce(oldRun.promise).mockReturnValueOnce(newRun.promise);
    await mount();
    let oldPending!: Promise<void>;
    await act(async () => {
      oldPending = writer.write();
    });
    await act(async () => {
      renderer!.update(<Harness environmentId={second} />);
    });
    expect(writer.running).toBe(false);
    let newPending!: Promise<void>;
    await act(async () => {
      newPending = writer.write();
    });
    await act(async () => {
      oldRun.resolve({ _tag: "Success" });
      await oldPending;
    });
    expect(writer.running).toBe(true);
    expect(state.generate.mock.calls.map(([target]) => target.environmentId)).toEqual([
      first,
      second,
    ]);
    await act(async () => {
      newRun.resolve({ _tag: "Success" });
      await newPending;
    });
    expect(writer.running).toBe(false);
  });

  it("clears a failed launch and allows a retry after an unexpected rejection", async () => {
    state.generate
      .mockRejectedValueOnce(new Error("disconnected"))
      .mockResolvedValueOnce({ _tag: "Success" });
    await mount();
    await act(async () => {
      await writer.write();
    });
    expect(writer.running).toBe(false);
    expect(useGuideRunStore.getState().watches[guideRunKey(first, reference)]).toBeUndefined();
    expect(state.toast).toHaveBeenCalledTimes(1);
    await act(async () => {
      await writer.write();
    });
    expect(state.generate).toHaveBeenCalledTimes(2);
  });
});

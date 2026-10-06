import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { pullRequestEntryKey, type EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import { usePullRequestCloseSweep } from "./usePullRequestCloseSweep";

class TestDocument extends EventTarget {
  hidden = false;
  getSelection = () => ({ removeAllRanges() {} });
}
const entry = (number: number, state = "open") =>
  ({
    environmentId: "local",
    projectId: "project",
    host: "github.com",
    repository: "acme/web",
    provider: "github",
    number,
    state,
  }) as EnvironmentPullRequestEntry;
const rows = [entry(1), entry(2, "closed"), entry(3), entry(4)];
const groups = [
  { key: "authored", entries: rows.slice(0, 3) },
  { key: "others", entries: rows.slice(3) },
];
const pending = new Set<string>();
const viewport = {
  getBoundingClientRect: () => ({ top: 0, bottom: 200 }),
  querySelectorAll: () =>
    rows.map((row, index) => ({
      dataset: { pullRequestKey: pullRequestEntryKey(row) },
      getBoundingClientRect: () => ({ top: index * 40 }),
    })),
  querySelector: (selector: string) =>
    [...pending].some((key) => selector.includes(key)) ? {} : null,
} as unknown as HTMLDivElement;
const scrollRef = { current: viewport };
const closingKeys = new Set<string>();
const closeBatch = vi.fn<(entries: ReadonlyArray<EnvironmentPullRequestEntry>) => Promise<void>>();
let renderer: ReactTestRenderer | undefined;
let document: TestDocument;

function Harness({ resetKey = "open" }: { resetKey?: string }) {
  const sweep = usePullRequestCloseSweep({ groups, closingKeys, closeBatch, scrollRef, resetKey });
  return (
    <button
      type="button"
      data-sweeping={sweep.sweepingKeys.size}
      onPointerDown={(event) => sweep.startSweep(rows[0]!, event.nativeEvent)}
    >
      Close
    </button>
  );
}
function pointer(type: string, y = 10) {
  return Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1,
    clientX: 10,
    clientY: y,
    buttons: type === "pointerup" ? 0 : 1,
  });
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document = new TestDocument();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout }));
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  pending.clear();
  closingKeys.clear();
  closeBatch.mockReset().mockResolvedValue(undefined);
  await act(() => {
    renderer = create(<Harness />);
  });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});
async function start() {
  await act(() =>
    renderer!.root
      .findByType("button")
      .props.onPointerDown({ nativeEvent: pointer("pointerdown") }),
  );
}

it("closes eligible rows in the starting group only after release", async () => {
  await start();
  await act(() => {
    document.dispatchEvent(pointer("pointermove", 145));
  });
  expect(renderer!.root.findByType("button").props["data-sweeping"]).toBe(2);
  expect(closeBatch).not.toHaveBeenCalled();
  // A row that became busy during the drag is rechecked before committing.
  pending.add(pullRequestEntryKey(rows[2]!));
  await act(() => {
    document.dispatchEvent(pointer("pointerup", 145));
  });
  expect(closeBatch).toHaveBeenCalledExactlyOnceWith([rows[0]]);
  expect(renderer!.root.findByType("button").props["data-sweeping"]).toBe(0);
});

it.each(["escape", "filters", "unmount"])("cancels a close sweep on %s", async (reason) => {
  await start();
  await act(() => {
    document.dispatchEvent(pointer("pointermove", 95));
  });
  await act(() => {
    if (reason === "escape")
      document.dispatchEvent(
        Object.assign(new Event("keydown"), { key: "Escape", code: "Escape" }),
      );
    else if (reason === "filters") renderer!.update(<Harness resetKey="closed" />);
    else renderer!.unmount();
  });
  await act(() => {
    document.dispatchEvent(pointer("pointerup", 95));
  });
  expect(closeBatch).not.toHaveBeenCalled();
});

it("leaves a click below the drag threshold to the existing single-row action", async () => {
  await start();
  await act(() => {
    document.dispatchEvent(pointer("pointermove", 15));
  });
  await act(() => {
    document.dispatchEvent(pointer("pointerup", 15));
  });
  expect(closeBatch).not.toHaveBeenCalled();
});

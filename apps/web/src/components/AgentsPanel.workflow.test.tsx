import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";

const state = vi.hoisted(() => ({
  queries: [] as unknown[],
  result: {
    _tag: "Success",
    value: {
      prompt: "Review checkout",
      answers: ["First answer", "Second answer"],
      partial: false,
      truncated: false,
    },
  },
  refresh: vi.fn(),
  stop: vi.fn().mockResolvedValue({ _tag: "Success" }),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => state.result,
  useAtomRefresh: () => state.refresh,
}));
vi.mock("../state/orchestration", () => ({
  orchestrationEnvironment: {
    workflowConversation: (input: unknown) => {
      state.queries.push(input);
      return input;
    },
    workflowScript: vi.fn(),
  },
}));
vi.mock("../state/threads", () => ({ threadEnvironment: { stopAgent: {} } }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => state.stop }));
vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => children,
}));
import { AgentsPanel } from "./AgentsPanel";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  state.queries = [];
  vi.clearAllMocks();
});
const activity = (payload: Record<string, unknown>, index: number) =>
  ({
    id: `a-${index}`,
    kind: "task.progress",
    payload: { agentKind: "agent", ...payload },
    createdAt: `2026-10-18T00:00:0${index}.000Z`,
    turnId: null,
    tone: "info",
    summary: "Workflow",
  }) as unknown as OrchestrationThreadActivity;
const model = (attempt = 1, status = "running") =>
  deriveAgentPanelModel({
    agents: foldSubagentActivities([
      activity(
        {
          taskId: "workflow",
          taskType: "local_workflow",
          workflowName: "Checkout",
          status,
          phases: [{ index: 0, title: "Review" }],
        },
        0,
      ),
      activity(
        {
          taskId: "workflow:wf:0",
          parentAgentId: "workflow",
          agentIndex: 0,
          phaseIndex: 0,
          title: "Reviewer",
          status,
          workflowAgentId: `member-${attempt}`,
          attempt,
        },
        1,
      ),
    ]),
  });
const panel = (attempt = 1, threadId = "parent", canStopAgents = true) => (
  <AgentsPanel
    model={model(attempt)}
    environmentId={EnvironmentId.make("remote")}
    threadId={ThreadId.make(threadId)}
    canStopAgents={canStopAgents}
  />
);

it("loads a member only after opening it, separates retries, and closes on thread changes", async () => {
  await act(async () => {
    renderer = create(panel());
  });
  expect(state.queries).toEqual([]);
  await act(async () =>
    renderer!.root.findByProps({ "aria-label": "Open Reviewer conversation" }).props.onClick(),
  );
  expect(state.queries.at(-1)).toEqual({
    environmentId: "remote",
    input: { threadId: "parent", taskId: "workflow:wf:0", workflowAgentId: "member-1", attempt: 1 },
  });
  const text = () =>
    renderer!.root
      .findAllByType("pre")
      .flatMap((node) => node.children)
      .join("\n");
  expect(text()).toContain("First answer");
  expect(text()).toContain("Second answer");
  await act(async () =>
    renderer!.root
      .findAllByType("button")
      .find((node) => node.children.includes("Refresh"))!
      .props.onClick(),
  );
  expect(state.refresh).toHaveBeenCalledOnce();
  await act(async () => renderer!.update(panel(2)));
  expect(state.queries.at(-1)).toMatchObject({
    input: { workflowAgentId: "member-2", attempt: 2 },
  });
  await act(async () =>
    renderer!.root.findByProps({ "aria-label": "Close Reviewer conversation" }).props.onClick(),
  );
  expect(renderer!.root.findAllByType("pre")).toHaveLength(0);
  await act(async () => renderer!.update(panel(2, "other-parent")));
  expect(renderer!.root.findByProps({ "aria-label": "Open Reviewer conversation" })).toBeDefined();
});

it("stops just the workflow coordinator and honors the permission gate", async () => {
  await act(async () => {
    renderer = create(panel());
  });
  expect(renderer!.root.findAllByProps({ "aria-label": "Stop Reviewer" })).toHaveLength(0);
  await act(async () =>
    renderer!.root.findByProps({ "aria-label": "Stop workflow Checkout" }).props.onClick(),
  );
  expect(state.stop).toHaveBeenCalledExactlyOnceWith({
    environmentId: "remote",
    input: { threadId: "parent", taskId: "workflow" },
  });
  expect(state.queries).toEqual([]);
  await act(async () => renderer!.update(panel(1, "parent", false)));
  expect(renderer!.root.findAllByProps({ "aria-label": "Stop workflow Checkout" })).toHaveLength(0);
});

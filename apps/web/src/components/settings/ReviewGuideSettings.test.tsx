import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { DEFAULT_UNIFIED_SETTINGS, EnvironmentId } from "@t3tools/contracts";
import { ReviewGuideSettings } from "./ReviewGuideSettings";

const state = vi.hoisted(() => ({
  environments: [] as Array<{
    environmentId: string;
    label: string;
    connection: { phase: string };
    serverConfig: object | null;
  }>,
  settings: new Map<string, { reviewGuidesEnabled: boolean }>(),
  reads: [] as string[],
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => [] }));
vi.mock("~/state/server", () => ({
  serverEnvironment: { providersValueAtom: (id: string) => id },
}));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("~/state/environments", () => ({
  usePrimaryEnvironmentId: () => "local",
  useEnvironments: () => ({ environments: state.environments }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentSettings: (id: string) => {
    state.reads.push(id);
    return { ...DEFAULT_UNIFIED_SETTINGS, ...state.settings.get(id) };
  },
  useUpdateEnvironmentSettings: (id: string) => (patch: { reviewGuidesEnabled: boolean }) => {
    state.settings.set(id, { ...state.settings.get(id), ...patch });
  },
}));
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({
    control,
    children,
  }: {
    control?: React.ReactNode;
    children?: React.ReactNode;
  }) => (
    <>
      {control}
      {children}
    </>
  ),
}));
vi.mock("../chat/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("../ui/switch", () => ({
  Switch: ({
    onCheckedChange,
    checked,
  }: {
    onCheckedChange: (value: boolean) => void;
    checked: boolean;
  }) => <button onClick={() => onCheckedChange(!checked)}>Toggle guides</button>,
}));
vi.mock("../ui/select", () => ({
  Select: ({
    onValueChange,
    children,
  }: {
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => <select onChange={(event) => onValueChange(event.target.value)}>{children}</select>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectPopup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  state.environments = ["local", "remote"].map((id) => ({
    environmentId: EnvironmentId.make(id),
    label: id,
    connection: { phase: "connected" },
    serverConfig: {},
  }));
  state.settings.clear();
  state.reads.length = 0;
  state.settings.set("local", { reviewGuidesEnabled: false });
  state.settings.set("remote", { reviewGuidesEnabled: false });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

it("keeps guide configuration on the selected environment when moving between connections", async () => {
  await act(async () => {
    renderer = create(<ReviewGuideSettings />);
  });
  await act(async () => {
    renderer!.root.findByType("select").props.onChange({ target: { value: "remote" } });
  });
  await act(async () => {
    renderer!.root.findByType("button").props.onClick();
    renderer!.update(<ReviewGuideSettings />);
  });
  expect(state.settings.get("remote")?.reviewGuidesEnabled).toBe(true);
  expect(state.settings.get("local")?.reviewGuidesEnabled).toBe(false);
  await act(async () => {
    renderer!.root.findByType("select").props.onChange({ target: { value: "local" } });
  });
  expect(state.reads.at(-1)).toBe("local");
  await act(async () => {
    renderer!.root.findByType("button").props.onClick();
  });
  expect(state.settings.get("local")?.reviewGuidesEnabled).toBe(true);
  expect(state.settings.get("remote")?.reviewGuidesEnabled).toBe(true);
});

it("does not read settings or offer edits on an offline selected environment", async () => {
  state.environments[1]!.connection.phase = "disconnected";
  state.environments[1]!.serverConfig = null;
  await act(async () => {
    renderer = create(<ReviewGuideSettings />);
  });
  state.reads.length = 0;
  await act(async () => {
    renderer!.root.findByType("select").props.onChange({ target: { value: "remote" } });
  });
  expect(state.reads).toEqual([]);
  expect(renderer!.root.findAllByType("button")).toHaveLength(0);
  expect(state.settings.get("remote")?.reviewGuidesEnabled).toBe(false);
});

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  projects: [
    {
      id: "remote-project",
      environmentId: "remote",
      title: "Remote project",
      defaultModelSelection: null,
    },
    {
      id: "primary-project",
      environmentId: "primary",
      title: "Primary project",
      defaultModelSelection: null,
    },
  ],
  createCommand: vi.fn(),
  navigate: vi.fn(),
  empty: [],
}));
vi.mock("~/state/entities", () => ({ useProjects: () => state.projects }));
vi.mock("~/state/environments", () => ({ usePrimaryEnvironmentId: () => "primary" }));
vi.mock("~/state/server", () => ({ serverEnvironment: {} }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.createCommand }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => state.empty,
  useAtomRefresh: () => () => {},
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("~/hooks/useSettings", () => ({ useClientSettings: () => "locale" }));
vi.mock("./AutomationModelField", () => ({ AutomationModelField: () => null }));
vi.mock("../ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/input", () => ({ Input: (props: ComponentProps<"input">) => <input {...props} /> }));
vi.mock("../ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));
vi.mock("../ui/switch", () => ({ Switch: () => null }));
type Wrapper = { children?: ReactNode };
vi.mock("../ui/select", () => ({
  Select: ({ children }: Wrapper) => <div>{children}</div>,
  SelectTrigger: ({ children }: Wrapper) => <div>{children}</div>,
  SelectValue: ({ children }: Wrapper) => <span>{children}</span>,
  SelectPopup: ({ children }: Wrapper) => <div>{children}</div>,
  SelectItem: ({ children }: Wrapper) => <option>{children}</option>,
}));
vi.mock("./settingsLayout", () => ({
  SettingsPageContainer: ({ children }: Wrapper) => <div>{children}</div>,
  SettingsSection: ({ children, headerAction }: Wrapper & { headerAction?: ReactNode }) => (
    <section>
      {headerAction}
      {children}
    </section>
  ),
  SettingsRow: ({ title }: { title: string }) => <div>{title}</div>,
}));

import { AutomationsSettingsPanel } from "./AutomationsSettingsPanel";

let renderer: ReactTestRenderer | null = null;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.projects = [
    {
      id: "remote-project",
      environmentId: "remote",
      title: "Remote project",
      defaultModelSelection: null,
    },
    {
      id: "primary-project",
      environmentId: "primary",
      title: "Primary project",
      defaultModelSelection: null,
    },
  ];
  state.createCommand.mockReset().mockResolvedValue({ _tag: "Failure", cause: "disconnected" });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

function button(label: string) {
  return renderer!.root.findAllByType("button").find((node) => node.children.includes(label))!;
}

describe("automation form", () => {
  it("retains a failed draft and saves it on retry in the primary project", async () => {
    await act(async () => {
      renderer = create(<AutomationsSettingsPanel />);
    });
    await act(async () => {
      button("New automation").props.onClick();
    });
    expect(
      renderer!.root
        .findAllByType("option")
        .some((node) => node.children.includes("Remote project")),
    ).toBe(false);
    await act(async () => {
      renderer!.root
        .findByProps({ placeholder: "Triage new issues" })
        .props.onChange({ currentTarget: { value: "Important job" } });
    });
    await act(async () => {
      renderer!.root
        .findByType("textarea")
        .props.onChange({ currentTarget: { value: "Long prompt to keep" } });
    });
    await act(async () => {
      button("Save automation").props.onClick();
    });
    expect(renderer!.root.findByProps({ placeholder: "Triage new issues" }).props.value).toBe(
      "Important job",
    );
    expect(renderer!.root.findByType("textarea").props.value).toBe("Long prompt to keep");
    expect(state.createCommand.mock.calls[0]?.[0]).toMatchObject({
      environmentId: "primary",
      input: { projectId: "primary-project", prompt: "Long prompt to keep" },
    });
    state.createCommand.mockResolvedValue({ _tag: "Success", value: {} });
    await act(async () => {
      button("Save automation").props.onClick();
    });
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
  });

  it("does not offer creation when only remote projects are available", async () => {
    state.projects = state.projects.filter((project) => project.environmentId === "remote");
    await act(async () => {
      renderer = create(<AutomationsSettingsPanel />);
    });
    expect(button("New automation")).toBeUndefined();
  });
});

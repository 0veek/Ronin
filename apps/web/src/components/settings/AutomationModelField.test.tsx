// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AutomationModelField } from "./AutomationModelField";

const fixture = vi.hoisted(() => ({ providers: [] as ServerProvider[] }));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => fixture.providers }));
vi.mock("../../state/server", () => ({
  EMPTY_SERVER_PROVIDERS: [],
  serverEnvironment: { providersValueAtom: () => null },
}));
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => ({
    ...DEFAULT_UNIFIED_SETTINGS,
    providerInstances: Object.fromEntries(
      fixture.providers.map((provider) => [
        provider.instanceId,
        { driver: provider.driver, enabled: true },
      ]),
    ),
  }),
}));
vi.mock("../chat/TraitsPicker", () => ({ TraitsPicker: () => null }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Harness({ instanceId }: { readonly instanceId: ProviderInstanceId }) {
  const [selection, setSelection] = useState<ModelSelection | null>({
    instanceId,
    model: "saved-missing-model",
  });
  return (
    <AutomationModelField
      environmentId={EnvironmentId.make("remote")}
      modelSelection={selection}
      projectDefaultModelSelection={{ instanceId, model: "known-model" }}
      onChange={setSelection}
    />
  );
}

describe("pinned automation models", () => {
  it.each([
    "codex",
    "claudeAgent",
    "cursor",
    "grok",
    "opencode",
    "antigravity",
    "droid",
    "kilo",
    "pi",
  ])("shows the saved %s model and changes it only after an explicit choice", async (driver) => {
    const instanceId = ProviderInstanceId.make(`${driver}_audit`);
    fixture.providers = [
      {
        instanceId,
        driver: ProviderDriverKind.make(driver),
        enabled: true,
        installed: true,
        status: "ready",
        version: null,
        auth: { status: "authenticated" },
        checkedAt: "2026-10-05T00:00:00.000Z",
        models: [
          {
            slug: "known-model",
            name: "Known model",
            isCustom: false,
            isDefault: true,
            capabilities: null,
          },
        ],
        slashCommands: [],
        skills: [],
      },
    ];
    await act(async () => root.render(<Harness instanceId={instanceId} />));
    expect(container.querySelector('[aria-label="Automation model"]')?.textContent).toContain(
      "saved-missing-model",
    );
    expect(container.querySelector('[aria-label="Automation model"]')?.textContent).not.toContain(
      "Known model",
    );

    const action = (text: string) =>
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === text,
      )!;
    await act(async () => action("Use project default").click());
    expect(container.querySelector('[aria-label="Automation model"]')).toBeNull();
    await act(async () => action("Choose a model").click());
    expect(container.querySelector('[aria-label="Automation model"]')?.textContent).toContain(
      "Known model",
    );
  });
});

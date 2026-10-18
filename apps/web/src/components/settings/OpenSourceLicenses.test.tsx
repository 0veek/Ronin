// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("./settingsLayout", () => ({
  SettingsPageContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingsSection: ({
    children,
    headerAction,
  }: {
    children: ReactNode;
    headerAction?: ReactNode;
  }) => (
    <section>
      {headerAction}
      {children}
    </section>
  ),
}));

const containers: HTMLDivElement[] = [];
const roots: Root[] = [];
async function mount(Panel: typeof import("./OpenSourceLicenses").OpenSourceLicensesPanel) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<Panel />));
  return { container, root };
}
afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  containers.splice(0).forEach((container) => container.remove());
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("shares an in-flight manifest across unmounts and reuses it after loading", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { OpenSourceLicensesPanel } = await import("./OpenSourceLicenses");
  let resolveResponse!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const fetch = vi.fn(() => response);
  vi.stubGlobal("fetch", fetch);
  const first = await mount(OpenSourceLicensesPanel);
  await act(async () => first.root.render(null));
  const second = await mount(OpenSourceLicensesPanel);
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveResponse(new Response(JSON.stringify({ schemaVersion: 1, entries: [] })));
    await response;
  });
  expect(second.container.textContent).toContain("No licenses match");
  const third = await mount(OpenSourceLicensesPanel);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(third.container.textContent).toContain("No licenses match");
});

it("retries a failed download instead of caching the rejection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { OpenSourceLicensesPanel } = await import("./OpenSourceLicenses");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, entries: [] })));
  vi.stubGlobal("fetch", fetch);
  const { container } = await mount(OpenSourceLicensesPanel);
  expect(container.textContent).toContain("503");
  const retry = Array.from(container.querySelectorAll("button")).find((button) =>
    /try again/i.test(button.textContent ?? ""),
  );
  expect(retry).toBeDefined();
  await act(async () => retry!.click());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("No licenses match");
});

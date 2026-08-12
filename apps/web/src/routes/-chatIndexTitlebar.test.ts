// @effect-diagnostics nodeBuiltinImport:off - Regression coverage compares the onboarding header with the shared titlebar contract.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

describe("hosted static onboarding header", () => {
  it("uses the shared workspace topbar geometry", () => {
    const routeSource = NodeFS.readFileSync(new URL("./_chat.index.tsx", import.meta.url), "utf8");
    const onboardingStart = routeSource.indexOf("function HostedStaticOnboardingState()");
    const onboardingEnd = routeSource.indexOf('<Empty className="flex-1">', onboardingStart);

    expect(onboardingStart).toBeGreaterThanOrEqual(0);
    expect(onboardingEnd).toBeGreaterThan(onboardingStart);

    const onboardingHeader = routeSource.slice(onboardingStart, onboardingEnd);

    // Upstream asserted the raw class. This fork routes the header through
    // WorkspaceTopbar, which is where that class and the height token now
    // live -- so the component is the contract, and hand-rolled padding here
    // would mean somebody had stopped using it.
    expect(onboardingHeader).toContain("<WorkspaceTopbar>");
    expect(onboardingHeader).not.toMatch(/(?:^|\s)(?:[\w-]+:)*py-/);
  });
});

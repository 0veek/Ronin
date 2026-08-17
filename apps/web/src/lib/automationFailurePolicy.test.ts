import { describe, expect, it } from "vite-plus/test";

import {
  AUTOMATION_FAILURE_POLICY_NEVER,
  automationFailurePolicyOptions,
  automationFailurePolicyValue,
  stopAfterConsecutiveFailuresFromPolicyValue,
} from "./automationFailurePolicy";

describe("automationFailurePolicy", () => {
  it("treats null as never-stop and a missing value as the default of three", () => {
    expect(automationFailurePolicyValue(null)).toBe(AUTOMATION_FAILURE_POLICY_NEVER);
    expect(automationFailurePolicyValue(undefined)).toBe("3");
    expect(automationFailurePolicyValue(5)).toBe("5");
  });

  it("round-trips picker values", () => {
    expect(stopAfterConsecutiveFailuresFromPolicyValue("never")).toBeNull();
    expect(stopAfterConsecutiveFailuresFromPolicyValue("1")).toBe(1);
    expect(stopAfterConsecutiveFailuresFromPolicyValue("3")).toBe(3);
    expect(stopAfterConsecutiveFailuresFromPolicyValue("nope")).toBe(3);
  });

  it("keeps a custom threshold visible in the option list", () => {
    const options = automationFailurePolicyOptions("7");
    expect(options[0]).toEqual({ value: "7", label: "Stop after 7 failures" });
  });
});

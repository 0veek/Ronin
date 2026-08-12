import { describe, expect, it } from "vite-plus/test";

import { formatAppDisplayName } from "./appDisplayName.ts";

describe("formatAppDisplayName", () => {
  it("leaves a shipping build unadorned", () => {
    // The rename this exists for: a released build is called Ronin, not
    // Ronin (Alpha). "latest" is the hosted channel's word for the same thing.
    expect(formatAppDisplayName({ baseName: "Ronin", stageLabel: "Stable" })).toBe("Ronin");
    expect(formatAppDisplayName({ baseName: "Ronin", stageLabel: "latest" })).toBe("Ronin");
  });

  it("suffixes the stages a user needs warning about", () => {
    expect(formatAppDisplayName({ baseName: "Ronin", stageLabel: "Dev" })).toBe("Ronin (Dev)");
    expect(formatAppDisplayName({ baseName: "Ronin", stageLabel: "Nightly" })).toBe(
      "Ronin (Nightly)",
    );
  });

  it("matches regardless of case or surrounding space", () => {
    // The label reaches this from a hosted env var, an injected bridge value
    // and a literal, so it cannot be assumed to arrive normalized.
    expect(formatAppDisplayName({ baseName: "Ronin", stageLabel: " stable " })).toBe("Ronin");
    expect(formatAppDisplayName({ baseName: "Ronin", stageLabel: "LATEST" })).toBe("Ronin");
  });
});

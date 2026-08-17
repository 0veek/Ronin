import { describe, expect, it } from "vite-plus/test";

import * as Cause from "effect/Cause";

import {
  causeToErrorMessage,
  isMissingUpdateConfig,
  normalizeBytesPerSecond,
  normalizePercent,
  resolveUpdateSupport,
  toErrorMessage,
} from "./DesktopAutoUpdate.ts";

describe("resolveUpdateSupport", () => {
  it("refuses to self-update a development build", () => {
    const support = resolveUpdateSupport({
      isPackaged: false,
      platform: "darwin",
      appImagePath: undefined,
    });
    expect(support.supported).toBe(false);
    expect(support.reason).toContain("Development builds");
  });

  it("supports packaged macOS and Windows builds", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(
        resolveUpdateSupport({ isPackaged: true, platform, appImagePath: undefined }).supported,
      ).toBe(true);
    }
  });

  it("supports a packaged Linux AppImage", () => {
    expect(
      resolveUpdateSupport({
        isPackaged: true,
        platform: "linux",
        appImagePath: "/tmp/Ronin.AppImage",
      }).supported,
    ).toBe(true);
  });

  it("leaves a package-manager-installed Linux build alone", () => {
    // Replacing binaries a distro package owns would break that package.
    const support = resolveUpdateSupport({
      isPackaged: true,
      platform: "linux",
      appImagePath: undefined,
    });
    expect(support.supported).toBe(false);
    expect(support.reason).toContain("package manager");
  });
});

describe("normalizePercent", () => {
  it("rounds and clamps into 0-100", () => {
    expect(normalizePercent(42.4)).toBe(42);
    expect(normalizePercent(-5)).toBe(0);
    expect(normalizePercent(180)).toBe(100);
  });

  it("drops values that cannot drive a progress bar", () => {
    for (const value of [undefined, null, "80", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizePercent(value)).toBeUndefined();
    }
  });
});

describe("normalizeBytesPerSecond", () => {
  it("keeps a finite non-negative rate", () => {
    expect(normalizeBytesPerSecond(1024.6)).toBe(1025);
    expect(normalizeBytesPerSecond(0)).toBe(0);
  });

  it("drops negative or non-finite rates", () => {
    for (const value of [-1, Number.NaN, "fast", undefined]) {
      expect(normalizeBytesPerSecond(value)).toBeUndefined();
    }
  });
});

describe("toErrorMessage", () => {
  it("prefers a real Error message", () => {
    expect(toErrorMessage(new Error("net::ERR_CONNECTION_REFUSED"))).toBe(
      "net::ERR_CONNECTION_REFUSED",
    );
  });

  it("falls back for empty or non-Error causes", () => {
    expect(toErrorMessage(new Error("   "))).toBe("The update failed for an unknown reason.");
    expect(toErrorMessage("")).toBe("The update failed for an unknown reason.");
    expect(toErrorMessage("release not found")).toBe("release not found");
  });

  it("unwraps the error Effect.tryPromise wrapped", () => {
    const wrapper = new Error("An error occurred in Effect.tryPromise");
    (wrapper as { cause?: unknown }).cause = new Error("ENOENT: no such file or directory");
    expect(toErrorMessage(wrapper)).toBe("ENOENT: no such file or directory");
  });
});

describe("causeToErrorMessage", () => {
  it("reports the underlying error rather than the Cause dump", () => {
    const message = causeToErrorMessage(Cause.fail(new Error("release not found")));
    expect(message).toBe("release not found");
    // The raw Cause stringifies to "Cause([Fail(...", which must never reach a toast.
    expect(message).not.toContain("Cause(");
    expect(message).not.toContain("Fail(");
  });
});

describe("isMissingUpdateConfig", () => {
  it("recognises a package built without publish config", () => {
    // Verbatim shape of the AppImage failure this replaced.
    expect(
      isMissingUpdateConfig(
        "ENOENT: no such file or directory, open '/tmp/.mount_Ronin-zolfgh/resources/app-update.yml'",
      ),
    ).toBe(true);
  });

  it("leaves real update failures alone", () => {
    expect(isMissingUpdateConfig("net::ERR_CONNECTION_REFUSED")).toBe(false);
    expect(isMissingUpdateConfig("Could not get code signature for running application")).toBe(
      false,
    );
    // A different missing file is still a genuine error.
    expect(
      isMissingUpdateConfig("ENOENT: no such file or directory, open 'latest-linux.yml'"),
    ).toBe(false);
  });
});

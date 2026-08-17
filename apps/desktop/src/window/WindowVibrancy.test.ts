import { describe, expect, it } from "vite-plus/test";

import {
  getWindowVibrancyOptions,
  resolveWindowBackgroundColor,
  resolveWindowVibrancy,
  TRANSPARENT_WINDOW_BACKGROUND_COLOR,
} from "./WindowVibrancy.ts";

const OPAQUE = "#0a0a0a";

describe("resolveWindowVibrancy", () => {
  it("names the material each platform draws", () => {
    expect(resolveWindowVibrancy("darwin")).toBe("vibrancy");
    expect(resolveWindowVibrancy("win32")).toBe("acrylic");
  });

  it("draws nothing on Linux, where blur belongs to the compositor", () => {
    expect(resolveWindowVibrancy("linux")).toBeNull();
    expect(resolveWindowVibrancy("freebsd")).toBeNull();
  });
});

describe("getWindowVibrancyOptions", () => {
  it("asks AppKit for the sidebar material on macOS", () => {
    expect(getWindowVibrancyOptions("darwin")).toStrictEqual({ vibrancy: "sidebar" });
  });

  it("asks for acrylic on Windows", () => {
    expect(getWindowVibrancyOptions("win32")).toStrictEqual({ backgroundMaterial: "acrylic" });
  });

  it("adds nothing on a platform with no material", () => {
    expect(getWindowVibrancyOptions("linux")).toStrictEqual({});
  });

  // `transparent: true` combined with a hidden titlebar is the frameless
  // -transparent bug class; Electron already makes the WebContents transparent
  // for either material, so requesting it again buys nothing and risks that.
  it("never requests window transparency directly", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      expect(getWindowVibrancyOptions(platform)).not.toHaveProperty("transparent");
    }
  });
});

describe("resolveWindowBackgroundColor", () => {
  it("keeps the opaque fill where no material is drawn", () => {
    expect(resolveWindowBackgroundColor({ opaqueColor: OPAQUE, platform: "linux" })).toBe(OPAQUE);
  });

  // An opaque fill here would paint over the material the window just asked
  // for, which is the whole effect gone for a single property.
  it("drops to alpha zero so the material shows through", () => {
    expect(resolveWindowBackgroundColor({ opaqueColor: OPAQUE, platform: "darwin" })).toBe(
      TRANSPARENT_WINDOW_BACKGROUND_COLOR,
    );
    expect(resolveWindowBackgroundColor({ opaqueColor: OPAQUE, platform: "win32" })).toBe(
      TRANSPARENT_WINDOW_BACKGROUND_COLOR,
    );
  });
});

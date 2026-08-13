import { describe, expect, it } from "vite-plus/test";

import { isLocalImageSource, localImagePathFromSource } from "./ChatMarkdown";

describe("markdown image sources", () => {
  it("treats remote sources as loadable by the browser", () => {
    expect(isLocalImageSource("https://example.com/a.png")).toBe(false);
    expect(isLocalImageSource("http://example.com/a.png")).toBe(false);
    expect(isLocalImageSource("//example.com/a.png")).toBe(false);
    expect(isLocalImageSource("data:image/png;base64,AAAA")).toBe(false);
  });

  it("treats disk paths as local", () => {
    // The shape agents actually emit: a screenshot they just wrote.
    expect(isLocalImageSource("/tmp/ronin-divider-audit/final/contact-sheet.png")).toBe(true);
    expect(isLocalImageSource("./docs/diagram.png")).toBe(true);
    expect(isLocalImageSource("docs/diagram.png")).toBe(true);
    expect(isLocalImageSource("file:///tmp/shot.png")).toBe(true);
  });

  it("unwraps file: URLs to a filesystem path", () => {
    expect(localImagePathFromSource("file:///tmp/shot.png")).toBe("/tmp/shot.png");
    expect(localImagePathFromSource("file:///tmp/my%20shot.png")).toBe("/tmp/my shot.png");
  });

  it("passes plain paths through untouched", () => {
    expect(localImagePathFromSource("/tmp/a/contact-sheet.png")).toBe("/tmp/a/contact-sheet.png");
    expect(localImagePathFromSource("docs/diagram.png")).toBe("docs/diagram.png");
  });

  it("reports nothing for an unparseable file URL", () => {
    expect(localImagePathFromSource("file://")).toBeNull();
    expect(localImagePathFromSource("")).toBeNull();
  });
});

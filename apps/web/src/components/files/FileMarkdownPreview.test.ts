import { describe, expect, it } from "vite-plus/test";

import { resolvePathLinkTarget } from "~/terminal-links";

import { fileMarkdownImageBaseDir } from "./FileMarkdownPreview";

describe("fileMarkdownImageBaseDir", () => {
  it.each([
    ["/workspace/project", "docs/README.md", "/workspace/project/docs"],
    ["C:\\Users\\shawn\\project", "docs\\README.md", "C:\\Users\\shawn\\project\\docs"],
    ["/workspace/project", "README.md", "/workspace/project"],
  ])("anchors images beside the previewed file in %s", (cwd, relativePath, expectedDir) => {
    expect(fileMarkdownImageBaseDir(cwd, relativePath)).toBe(expectedDir);
  });

  it("resolves a relative image source through the previewed file's directory", () => {
    const baseDir = fileMarkdownImageBaseDir("/workspace/project", "docs/README.md");
    expect(resolvePathLinkTarget("images/diagram.png", baseDir)).toBe(
      "/workspace/project/docs/images/diagram.png",
    );
  });
});

import { describe, expect, it } from "vite-plus/test";

import { projectFileCacheKey } from "./fileContentRevision";

describe("projectFileCacheKey", () => {
  it("keeps identical contents stable", () => {
    expect(projectFileCacheKey("/repo", "file.json", "contents")).toBe(
      projectFileCacheKey("/repo", "file.json", "contents"),
    );
  });
});

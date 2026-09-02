import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveViewedImageAsset, workEntryViewedImagePath } from "./workLogViewedImage";

const threadId = ThreadId.make("thread-1");

describe("workEntryViewedImagePath", () => {
  it("takes the detail of a read whose target is a previewable image", () => {
    expect(workEntryViewedImagePath({ requestKind: "file-read", detail: "docs/hero.png" })).toBe(
      "docs/hero.png",
    );
    expect(workEntryViewedImagePath({ itemType: "image_view", detail: "shot.webp" })).toBe(
      "shot.webp",
    );
  });

  it("ignores non-reads, prose details, and unsupported files", () => {
    expect(
      workEntryViewedImagePath({ requestKind: "command", detail: "docs/hero.png" }),
    ).toBeNull();
    expect(
      workEntryViewedImagePath({ requestKind: "file-read", detail: "read 2 files\nhero.png" }),
    ).toBeNull();
    expect(workEntryViewedImagePath({ requestKind: "file-read", detail: "notes.md" })).toBeNull();
    expect(workEntryViewedImagePath({ requestKind: "file-read" })).toBeNull();
  });
});

describe("resolveViewedImageAsset", () => {
  it("resolves a relative path against the workspace root", () => {
    expect(resolveViewedImageAsset("docs/hero.png", { threadId, workspaceRoot: "/repo" })).toEqual({
      resource: { _tag: "workspace-file", threadId, path: "/repo/docs/hero.png" },
      alt: "hero.png",
    });
  });

  it("signs an attachment the agent read back off disk as an attachment", () => {
    expect(
      resolveViewedImageAsset("/home/dev/.ronin/userdata/attachments/abc123.png", {
        threadId,
        workspaceRoot: "/repo",
      }),
    ).toEqual({
      resource: { _tag: "attachment", attachmentId: "abc123" },
      alt: "abc123.png",
    });
  });

  it("declines a remote source", () => {
    expect(
      resolveViewedImageAsset("https://example.com/hero.png", { threadId, workspaceRoot: "/repo" }),
    ).toBeNull();
  });
});

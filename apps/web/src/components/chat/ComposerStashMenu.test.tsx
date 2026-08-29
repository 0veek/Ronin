import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { ComposerStashMenu } from "./ComposerStashMenu";

describe("ComposerStashMenu", () => {
  it("advertises the configured stash shortcut when the stash is empty", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[]}
        stashShortcutLabel="Ctrl+S"
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("Nothing stashed yet.");
    expect(markup).toContain("Press Ctrl+S with a prompt in the composer to stash it.");
  });

  // The old copy hardcoded ⌘S, which was wrong on every rebind and on Windows
  // and Linux. With no binding at all there is nothing honest to advertise.
  it("does not advertise a shortcut when stash is unbound", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[]}
        stashShortcutLabel={null}
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("Nothing stashed yet.");
    expect(markup).not.toContain("Press");
  });

  it("labels mixed file and image stashes without treating images as files", () => {
    const markup = renderToStaticMarkup(
      <ComposerStashMenu
        entries={[
          {
            id: "mixed-attachments",
            createdAt: new Date(0).toISOString(),
            prompt: "",
            attachments: [
              {
                id: "image-one",
                name: "before.png",
                mimeType: "image/png",
                sizeBytes: 128,
                dataUrl: "data:image/png;base64,AA==",
              },
            ],
            files: [
              {
                id: "file-one",
                name: "report.pdf",
                mimeType: "application/pdf",
                sizeBytes: 42,
                attachmentId: "pending-report-pdf",
                environmentId: EnvironmentId.make("environment-1"),
              },
            ],
            droppedImageNames: [],
          },
        ]}
        stashShortcutLabel="Ctrl+S"
        onRestore={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />,
    );

    expect(markup).toContain("(2 attachments)");
    expect(markup).toContain("size-3.5 text-secondary-label");
    expect(markup).not.toContain("(2 files)");
  });
});

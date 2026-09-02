import type { AssetResource, ThreadId } from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";

import { isLocalImageSource, localImagePathFromSource } from "./components/ChatMarkdown";
import type { WorkLogEntry } from "./session-logic";
import { resolvePathLinkTarget } from "./terminal-links";

/**
 * The image an agent just looked at, when the row is a read of one.
 *
 * Only reads carry an image worth showing: an edit row's detail is a diff
 * target, not something the user asked to see. A multi-line detail is prose
 * about the read, not a path.
 */
export function workEntryViewedImagePath(
  entry: Pick<WorkLogEntry, "detail" | "itemType" | "requestKind" | "toolTitle">,
): string | null {
  const isRead =
    entry.requestKind === "file-read" ||
    entry.itemType === "image_view" ||
    (entry.itemType === "dynamic_tool_call" &&
      entry.toolTitle?.trim().toLowerCase() === "read file");
  const detail = entry.detail?.trim();
  return isRead &&
    detail !== undefined &&
    !/[\r\n]/.test(detail) &&
    isWorkspaceImagePreviewPath(detail)
    ? detail
    : null;
}

export interface ViewedImageAsset {
  readonly resource: Extract<AssetResource, { readonly _tag: "attachment" | "workspace-file" }>;
  readonly alt: string;
}

const ABSOLUTE_IMAGE_SOURCE_PATTERN = /^(?:file:|[\\/]|[a-z]:[\\/])/i;
// An image the user attached and the agent then read back off disk. Signing it
// as a workspace file would fail: it lives under the T3 home, not the project.
const ATTACHMENT_IMAGE_PATH_PATTERN =
  /(?:^|[\\/])(?:dev|userdata)[\\/]attachments[\\/]([a-z0-9_-]{1,128})\.[a-z0-9]{1,10}$/i;

export function resolveViewedImageAsset(
  source: string,
  input: {
    readonly threadId: ThreadId;
    readonly workspaceRoot?: string | null | undefined;
  },
): ViewedImageAsset | null {
  if (!isLocalImageSource(source)) return null;
  const localPath = localImagePathFromSource(source);
  if (localPath === null) return null;

  const path =
    input.workspaceRoot == null ? localPath : resolvePathLinkTarget(localPath, input.workspaceRoot);
  const attachmentId = ABSOLUTE_IMAGE_SOURCE_PATTERN.test(source)
    ? (ATTACHMENT_IMAGE_PATH_PATTERN.exec(path)?.[1] ?? null)
    : null;

  return {
    resource: attachmentId
      ? { _tag: "attachment", attachmentId }
      : { _tag: "workspace-file", threadId: input.threadId, path },
    alt: path.split(/[\\/]/).at(-1) ?? "image",
  };
}

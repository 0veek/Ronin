import type { ScopedThreadRef } from "@t3tools/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolvePathLinkTarget } from "~/terminal-links";

/** The previewed file's own directory, absolute, in the workspace root's path style. */
export function fileMarkdownImageBaseDir(cwd: string, relativePath: string): string {
  const lastSeparator = Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\"));
  return lastSeparator >= 0
    ? resolvePathLinkTarget(relativePath.slice(0, lastSeparator), cwd)
    : cwd;
}

/**
 * Rendered markdown for a previewed workspace file. Relative image sources
 * resolve against the file's own directory, not the workspace root, so a
 * nested `docs/README.md` finds the `images/` folder sitting beside it.
 */
export function FileMarkdownPreview(props: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly text: string;
  readonly threadRef: ScopedThreadRef;
  readonly onTaskListChange?:
    | ((input: { readonly markerOffset: number; readonly checked: boolean }) => void)
    | undefined;
}) {
  const imageBaseDir = fileMarkdownImageBaseDir(props.cwd, props.relativePath);

  return (
    <ChatMarkdown
      text={props.text}
      cwd={props.cwd}
      imageBaseDir={imageBaseDir}
      threadRef={props.threadRef}
      className="mx-auto max-w-4xl px-6 py-5"
      onTaskListChange={props.onTaskListChange}
    />
  );
}

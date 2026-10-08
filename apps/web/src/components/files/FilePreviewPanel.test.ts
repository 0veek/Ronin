import { ProjectReadFileError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { filePreviewReadErrorMessage } from "./filePreviewMode";

const decodeReadError = Schema.decodeSync(ProjectReadFileError);

describe("file preview read errors", () => {
  it.each([
    ["path_not_file", "The path is a directory or special file, not a regular file."],
    ["binary_file", "The file is binary and cannot be displayed as text."],
    ["workspace_path_outside_root", "The requested path is outside the workspace."],
    ["resolved_path_outside_root", "The path resolves to a location outside the workspace."],
    [
      "operation_failed",
      "The file could not be accessed or read. It may be missing or inaccessible.",
    ],
  ] as const)("describes %s without revealing the platform cause", (failure, message) => {
    const error = new ProjectReadFileError({
      cwd: "/workspace",
      relativePath: "workspace/outline.md",
      failure,
      operation: "realpath-target",
      resolvedPath: "/workspace/workspace/outline.md",
      cause: new Error("EACCES: sensitive platform detail"),
    });
    expect(filePreviewReadErrorMessage(error)).toBe(message);
  });

  it("distinguishes an inaccessible workspace from an inaccessible file", () => {
    const error = new ProjectReadFileError({
      cwd: "/workspace",
      relativePath: "outline.md",
      failure: "operation_failed",
      operation: "realpath-workspace-root",
      operationPath: "/workspace",
    });
    expect(filePreviewReadErrorMessage(error)).toBe("The workspace folder could not be accessed.");
  });

  it("preserves the public message from older servers", () => {
    const error = decodeReadError({
      _tag: "ProjectReadFileError",
      message: "Legacy file read failure.",
    });
    expect(filePreviewReadErrorMessage(error)).toBe("Legacy file read failure.");
  });
});

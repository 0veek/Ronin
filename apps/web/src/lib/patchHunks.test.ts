import { describe, expect, it } from "vite-plus/test";
import {
  buildFilePatch,
  buildHunkPatch,
  findPatchHunkAtLine,
  findPatchSection,
  splitPatchSections,
} from "./patchHunks";

const TWO_FILE_PATCH = [
  "diff --git a/src/one.ts b/src/one.ts",
  "index 1111111..2222222 100644",
  "--- a/src/one.ts",
  "+++ b/src/one.ts",
  "@@ -1,4 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 20;",
  " const c = 3;",
  " const d = 4;",
  "@@ -20,3 +20,4 @@ function tail() {",
  " return a;",
  "+  log(a);",
  " }",
  " ",
  "diff --git a/src/two.ts b/src/two.ts",
  "index 3333333..4444444 100644",
  "--- a/src/two.ts",
  "+++ b/src/two.ts",
  "@@ -7,2 +7,2 @@",
  "-old",
  "+new",
  " tail",
  "",
].join("\n");

describe("splitPatchSections", () => {
  it("splits a multi-file patch into sections with their hunks", () => {
    const sections = splitPatchSections(TWO_FILE_PATCH);

    expect(sections).toHaveLength(2);
    expect(sections[0]?.newPath).toBe("src/one.ts");
    expect(sections[0]?.oldPath).toBe("src/one.ts");
    expect(sections[0]?.hunks).toHaveLength(2);
    expect(sections[1]?.newPath).toBe("src/two.ts");
    expect(sections[1]?.hunks).toHaveLength(1);
  });

  it("keeps hunk text verbatim and counts its changed lines", () => {
    const [first] = splitPatchSections(TWO_FILE_PATCH);
    const hunk = first?.hunks[0];

    expect(hunk?.text).toBe(
      [
        "@@ -1,4 +1,4 @@",
        " const a = 1;",
        "-const b = 2;",
        "+const b = 20;",
        " const c = 3;",
        " const d = 4;",
      ].join("\n"),
    );
    expect(hunk?.additions).toBe(1);
    expect(hunk?.deletions).toBe(1);
    expect(hunk?.truncated).toBe(false);
  });

  it("stops a hunk once its declared line counts are satisfied", () => {
    const [first] = splitPatchSections(TWO_FILE_PATCH);

    expect(first?.hunks[1]?.text.endsWith(" ")).toBe(true);
    expect(first?.hunks[1]?.oldStart).toBe(20);
    expect(first?.hunks[1]?.newCount).toBe(4);
  });

  it("returns nothing for an empty patch", () => {
    expect(splitPatchSections("   \n ")).toEqual([]);
  });

  it("treats a bare empty body line as context", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,3 +1,3 @@",
      " one",
      "",
      "-two",
      "+three",
      "",
    ].join("\n");

    const hunk = splitPatchSections(patch)[0]?.hunks[0];

    expect(hunk?.truncated).toBe(false);
    expect(hunk?.text.split("\n")[2]).toBe(" ");
  });

  it("carries a no-newline marker without counting it as content", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-one",
      "\\ No newline at end of file",
      "+two",
      "\\ No newline at end of file",
      "",
    ].join("\n");

    const hunk = splitPatchSections(patch)[0]?.hunks[0];

    expect(hunk?.truncated).toBe(false);
    expect(hunk?.text).toContain("\\ No newline at end of file");
  });

  it("marks a hunk cut off by output truncation", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,8 +1,8 @@",
      " one",
      "-two",
      "",
      "[truncated]",
    ].join("\n");

    const hunk = splitPatchSections(patch)[0]?.hunks[0];

    expect(hunk?.truncated).toBe(true);
    expect(buildHunkPatch(splitPatchSections(patch)[0]!, hunk!)).toBeNull();
  });

  it("separates an untracked --no-index diff from a staged addition", () => {
    const untracked = [
      "diff --git a/dev/null b/notes.md",
      "--- /dev/null",
      "+++ b/notes.md",
      "@@ -0,0 +1 @@",
      "+hello",
      "",
    ].join("\n");
    const staged = [
      "diff --git a/notes.md b/notes.md",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/notes.md",
      "@@ -0,0 +1 @@",
      "+hello",
      "",
    ].join("\n");

    expect(splitPatchSections(untracked)[0]?.untracked).toBe(true);
    expect(splitPatchSections(staged)[0]?.untracked).toBe(false);
  });

  it("flags a binary file so no slice is offered", () => {
    const patch = [
      "diff --git a/logo.png b/logo.png",
      "index 1111111..2222222 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "",
    ].join("\n");

    const section = splitPatchSections(patch)[0];

    expect(section?.binary).toBe(true);
    expect(buildFilePatch(section!)).toBeNull();
  });

  it("unquotes a C-quoted path", () => {
    const patch = [
      'diff --git "a/src/caf\\303\\251.ts" "b/src/caf\\303\\251.ts"',
      '--- "a/src/caf\\303\\251.ts"',
      '+++ "b/src/caf\\303\\251.ts"',
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n");

    expect(splitPatchSections(patch)[0]?.newPath).toBe("src/café.ts");
  });
});

describe("findPatchSection", () => {
  it("resolves a rename by its post-change path", () => {
    const patch = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n");
    const sections = splitPatchSections(patch);

    expect(findPatchSection(sections, "new.ts")?.oldPath).toBe("old.ts");
    expect(findPatchSection(sections, "old.ts")?.newPath).toBe("new.ts");
    expect(findPatchSection(sections, "missing.ts")).toBeNull();
  });
});

describe("findPatchHunkAtLine", () => {
  const sections = splitPatchSections(TWO_FILE_PATCH);

  it("finds the hunk holding an added line", () => {
    const target = findPatchHunkAtLine({
      sections,
      filePath: "src/one.ts",
      lineNumber: 21,
      side: "additions",
    });

    expect(target?.hunkIndex).toBe(1);
  });

  it("finds the hunk holding a deleted line", () => {
    const target = findPatchHunkAtLine({
      sections,
      filePath: "src/one.ts",
      lineNumber: 2,
      side: "deletions",
    });

    expect(target?.hunkIndex).toBe(0);
  });

  it("falls back to the other side when the line only exists there", () => {
    const target = findPatchHunkAtLine({
      sections,
      filePath: "src/two.ts",
      lineNumber: 8,
      side: "deletions",
    });

    expect(target?.hunkIndex).toBe(0);
  });

  it("returns nothing for a line outside every hunk", () => {
    expect(
      findPatchHunkAtLine({
        sections,
        filePath: "src/one.ts",
        lineNumber: 900,
        side: "additions",
      }),
    ).toBeNull();
  });

  it("returns nothing for a file the patch does not carry", () => {
    expect(
      findPatchHunkAtLine({
        sections,
        filePath: "src/absent.ts",
        lineNumber: 1,
        side: "additions",
      }),
    ).toBeNull();
  });

  it("resolves a pure addition whose old side declares a zero count", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -4,0 +5,2 @@",
      "+added one",
      "+added two",
      "",
    ].join("\n");

    const target = findPatchHunkAtLine({
      sections: splitPatchSections(patch),
      filePath: "a.txt",
      lineNumber: 4,
      side: "deletions",
    });

    expect(target?.hunkIndex).toBe(0);
  });
});

describe("buildHunkPatch", () => {
  it("emits one hunk under the file's own headers", () => {
    const section = splitPatchSections(TWO_FILE_PATCH)[0]!;

    expect(buildHunkPatch(section, section.hunks[1]!)).toBe(
      [
        "diff --git a/src/one.ts b/src/one.ts",
        "index 1111111..2222222 100644",
        "--- a/src/one.ts",
        "+++ b/src/one.ts",
        "@@ -20,3 +20,4 @@ function tail() {",
        " return a;",
        "+  log(a);",
        " }",
        " ",
        "",
      ].join("\n"),
    );
  });

  it("ends with a newline so git accepts the last line", () => {
    const section = splitPatchSections(TWO_FILE_PATCH)[1]!;

    expect(buildHunkPatch(section, section.hunks[0]!)?.endsWith("\n")).toBe(true);
  });
});

describe("buildFilePatch", () => {
  it("keeps every hunk of one file in order", () => {
    const section = splitPatchSections(TWO_FILE_PATCH)[0]!;
    const patch = buildFilePatch(section);

    expect(patch).toContain("@@ -1,4 +1,4 @@");
    expect(patch).toContain("@@ -20,3 +20,4 @@");
    expect(patch?.startsWith("diff --git a/src/one.ts")).toBe(true);
  });

  it("returns nothing when the file has no hunks", () => {
    const patch = ["diff --git a/a.txt b/a.txt", "old mode 100644", "new mode 100755", ""].join(
      "\n",
    );

    expect(buildFilePatch(splitPatchSections(patch)[0]!)).toBeNull();
  });
});

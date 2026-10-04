import { describe, expect, it } from "vite-plus/test";
import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { remarkKeepWindowsPathDestinations } from "./markdown-windows-paths";

function destinations(markdown: string): string[] {
  const tree = unified().use(remarkParse).use(remarkKeepWindowsPathDestinations).parse(markdown);
  const urls: string[] = [];
  const visit = (node: Nodes) => {
    if ("url" in node) urls.push(node.url);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
  return urls;
}

describe("Windows markdown destinations", () => {
  it("preserves path separators in inline images, links, and reference definitions", () => {
    expect(
      destinations(
        [
          String.raw`![shot](C:\Users\me\.ronin\_build\shot.png)`,
          String.raw`[settings](C:\Users\me\.claude\settings.json)`,
          String.raw`[shot]: \\server\share\.ronin\shot.png`,
        ].join("\n\n"),
      ),
    ).toEqual([
      String.raw`C:\Users\me\.ronin\_build\shot.png`,
      String.raw`C:\Users\me\.claude\settings.json`,
      String.raw`\\server\share\.ronin\shot.png`,
    ]);
  });

  it("still decodes entities and normal CommonMark URL escapes", () => {
    expect(
      destinations(String.raw`![amp](C:/Users/me/a&amp;b.svg) [site](https://example.com/a\.b)`),
    ).toEqual(["C:/Users/me/a&b.svg", "https://example.com/a.b"]);
  });
});

import DOMPurify from "dompurify";

const REMOTE_CSS_URL = /url\(\s*(?!['"]?#)[^)]*\)/gi;
let purifier: ReturnType<typeof DOMPurify> | null = null;

// Diagrams can come from untrusted PR descriptions, so strip anything that can
// navigate, run script, or fetch remote content on top of Mermaid's own strict
// sanitization. CSS keeps only local url(#id) references; label text is untouched.
export function sanitizeMermaidSvg(svg: string): string {
  if (!purifier) {
    purifier = DOMPurify(window);
    purifier.addHook("uponSanitizeElement", (node, data) => {
      if (data.tagName === "style" && node.textContent) {
        node.textContent = node.textContent.replace(REMOTE_CSS_URL, "none");
      }
    });
    purifier.addHook("uponSanitizeAttribute", (_node, data) => {
      if (data.attrName === "style")
        data.attrValue = data.attrValue.replace(REMOTE_CSS_URL, "none");
    });
  }
  return purifier.sanitize(svg, {
    ADD_TAGS: ["foreignObject"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "img", "image", "script"],
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
  });
}

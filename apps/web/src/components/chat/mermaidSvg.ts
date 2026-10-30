import DOMPurify from "dompurify";

// MathML element types KaTeX emits, without annotation (the resolver removes it),
// semantics (only a wrapper, so its content is kept), and mglyph (an image).
const KATEX_MATHML_TAGS = new Set([
  "math",
  "menclose",
  "mfrac",
  "mi",
  "mlabeledtr",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mroot",
  "mrow",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
]);
// Presentation attributes KaTeX sets on those elements. The profiles already
// cover class, style, width, height, display, and xmlns.
const KATEX_MATHML_ATTRIBUTES = new Set([
  "accent",
  "accentunder",
  "columnalign",
  "columnlines",
  "columnspacing",
  "depth",
  "displaystyle",
  "fence",
  "largeop",
  "linebreak",
  "linethickness",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "notation",
  "rowlines",
  "rowspacing",
  "rspace",
  "scriptlevel",
  "separator",
  "stretchy",
  "voffset",
]);

let purifier: ReturnType<typeof DOMPurify> | null = null;
const REMOTE_CSS_URL = /url\(\s*(?!['"]?#)[^)]*\)/gi;

function diagramPurifier() {
  if (!purifier) {
    purifier = DOMPurify(window);
    purifier.addHook("uponSanitizeAttribute", (_node, data) => {
      if (data.attrName === "style")
        data.attrValue = data.attrValue.replace(REMOTE_CSS_URL, "none");
    });
  }
  return purifier;
}

// Diagrams can come from untrusted PR descriptions. Pele escapes labels and
// links and images are off, so this is defense in depth against anything that
// could navigate, run script, or fetch remote content.
export function sanitizeDiagramSvg(svg: string): DocumentFragment {
  return diagramPurifier().sanitize(svg, {
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "image", "foreignObject", "style"],
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_DOM_FRAGMENT: true,
  });
}

// Pele puts MathML labels in a <foreignObject> with an HTML <div> around them.
export function sanitizeMathDiagramSvg(svg: string): DocumentFragment {
  return diagramPurifier().sanitize(svg, {
    // DOMPurify still only accepts <math> under an HTML parent and checks every
    // MathML child's namespace.
    ADD_TAGS: ["foreignObject", ...KATEX_MATHML_TAGS],
    ADD_ATTR: (attribute, tagName) =>
      KATEX_MATHML_TAGS.has(tagName) && KATEX_MATHML_ATTRIBUTES.has(attribute),
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    FORBID_TAGS: ["a", "img", "image", "script", "style"],
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    RETURN_DOM_FRAGMENT: true,
  });
}

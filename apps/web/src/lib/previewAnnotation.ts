import type { PreviewAnnotationPayload } from "@t3tools/contracts";
import { buildElementContextBlock, normalizeElementContextSelection } from "./elementContext";
import { dataUrlToFile } from "./imageCompression";

const TRAILING_PREVIEW_ANNOTATION_BLOCK_PATTERN =
  /\n*<preview_annotation>\n((?:(?!<preview_annotation>)[\s\S])*)\n<\/preview_annotation>\s*$/;

export interface ParsedPreviewAnnotation {
  id: string;
  title: string;
  comment: string;
  targetSummary: string;
  styleChanges: string[];
  hasScreenshot: boolean;
}

export interface ExtractedPreviewAnnotation {
  promptText: string;
  annotation: ParsedPreviewAnnotation | null;
}

export function buildPreviewAnnotationPrompt(annotation: PreviewAnnotationPayload): string {
  const lines = ["Preview annotation:", `Id: ${annotation.id}`];
  lines.push(`Page: ${annotation.pageTitle?.trim() || annotation.pageUrl.trim() || "Preview"}`);
  if (annotation.comment.trim()) lines.push(`Comment: ${annotation.comment.trim()}`);
  const targets: string[] = [];
  if (annotation.elements.length > 0)
    targets.push(`${annotation.elements.length} selected elements`);
  if (annotation.regions.length > 0) targets.push(`${annotation.regions.length} marked regions`);
  if (annotation.strokes.length > 0) targets.push(`${annotation.strokes.length} drawings`);
  if (targets.length > 0) lines.push(`Targets: ${targets.join(", ")}.`);
  if (annotation.styleChanges.length > 0) {
    lines.push("Requested visual changes:");
    for (const change of annotation.styleChanges) {
      lines.push(`- ${change.property}: ${change.previousValue || "(unset)"} → ${change.value}`);
    }
  }
  if (annotation.screenshot) lines.push("The attached screenshot is the annotated preview crop.");
  const elementContexts = annotation.elements
    .map((target) => normalizeElementContextSelection(target.element))
    .filter((context) => context !== null);
  const elementBlock = buildElementContextBlock(elementContexts);
  if (elementBlock) lines.push(elementBlock);
  return ["<preview_annotation>", ...lines, "</preview_annotation>"].join("\n");
}

export function appendPreviewAnnotationPrompt(
  prompt: string,
  annotation: PreviewAnnotationPayload,
): string {
  const annotationText = buildPreviewAnnotationPrompt(annotation);
  const trimmed = prompt.trim();
  return trimmed ? `${trimmed}\n\n${annotationText}` : annotationText;
}

export function extractTrailingPreviewAnnotation(prompt: string): ExtractedPreviewAnnotation {
  const match = TRAILING_PREVIEW_ANNOTATION_BLOCK_PATTERN.exec(prompt);
  if (!match) return { promptText: prompt, annotation: null };
  const body = match[1] ?? "";
  const lines = body.split("\n");
  const pageLine = lines.find((line) => line.startsWith("Page: "));
  const idLine = lines.find((line) => line.startsWith("Id: "));
  const commentLine = lines.find((line) => line.startsWith("Comment: "));
  const targetsLine = lines.find((line) => line.startsWith("Targets: "));
  const styleHeadingIndex = lines.indexOf("Requested visual changes:");
  const linesAfterStyleHeading = lines.slice(styleHeadingIndex + 1);
  const elementContextIndex = linesAfterStyleHeading.indexOf("<element_context>");
  const styleChanges =
    styleHeadingIndex < 0
      ? []
      : linesAfterStyleHeading
          .slice(0, elementContextIndex < 0 ? undefined : elementContextIndex)
          .filter((line) => line.startsWith("- "))
          .map((line) => line.slice(2));
  return {
    promptText: prompt.slice(0, match.index).replace(/\n+$/, ""),
    annotation: {
      id: idLine?.slice(4).trim() || `${match.index}`,
      title: pageLine?.slice(6).trim() || "Preview annotation",
      comment: commentLine?.slice(9).trim() || "",
      targetSummary: targetsLine?.slice(9).trim() || "",
      styleChanges,
      hasScreenshot: body.includes("The attached screenshot is the annotated preview crop."),
    },
  };
}

export type PreviewAnnotationCapture =
  /** The crop is ready to attach. */
  | { readonly status: "captured"; readonly file: File }
  /** The pick carried no crop, which is normal for comment-only annotations. */
  | { readonly status: "none" }
  /** The crop could not be decoded. Send the annotation without it. */
  | { readonly status: "failed" };

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

/** Decode Electron's PNG crop locally; fetching a data URL violates desktop connect-src. */
export function capturePreviewAnnotationScreenshot(
  annotation: PreviewAnnotationPayload,
): PreviewAnnotationCapture {
  if (!annotation.screenshot) return { status: "none" };
  try {
    const { dataUrl } = annotation.screenshot;
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) return { status: "failed" };
    const file = dataUrlToFile(dataUrl, `preview-annotation-${annotation.id}.png`, "image/png");
    return file.size > 0 ? { status: "captured", file } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

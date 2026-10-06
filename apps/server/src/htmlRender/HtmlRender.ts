import {
  PreviewAutomationSnapshot,
  PreviewAutomationStatus,
  type ThreadId,
} from "@t3tools/contracts";
import {
  clampHtmlRenderHeight,
  HTML_RENDER_COLUMN_WIDTH,
  HTML_RENDER_MAX_TITLE_LENGTH,
  htmlRenderTheme,
  htmlRenderThemeFragment,
  injectHtmlRenderBootstrap,
  type HtmlRenderReference,
} from "@t3tools/shared/htmlRender";
import {
  HTML_RENDER_DARK_COLORS,
  HTML_RENDER_LIGHT_COLORS,
  type ThemeAppearance,
} from "@t3tools/shared/htmlRender";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as HttpServer from "effect/unstable/http/HttpServer";
import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createAttachmentId } from "../attachmentStore.ts";
import * as AssetAccess from "../assets/AssetAccess.ts";
import * as ServerConfig from "../config.ts";
import { PreviewAutomationBroker } from "../mcp/PreviewAutomationBroker.ts";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import { PreviewManager } from "../preview/Manager.ts";

const MIB = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * MIB;
const MAX_PAGE_BYTES = 25 * MIB;
const formatMib = (bytes: number) => `${(bytes / MIB).toFixed(1)} MiB`;

export class HtmlRenderImagesNotFoundError extends Schema.TaggedErrorClass<HtmlRenderImagesNotFoundError>()(
  "HtmlRenderImagesNotFoundError",
  { paths: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `These local images could not be read: ${this.paths.join(", ")}. Use absolute paths to existing image files, or remove them.`;
  }
}

export class HtmlRenderImageTooLargeError extends Schema.TaggedErrorClass<HtmlRenderImageTooLargeError>()(
  "HtmlRenderImageTooLargeError",
  { path: Schema.String, sizeBytes: Schema.Number },
) {
  override get message(): string {
    return `${this.path} is ${formatMib(this.sizeBytes)}; each local image must be at most ${formatMib(MAX_IMAGE_BYTES)}.`;
  }
}

export class HtmlRenderPageTooLargeError extends Schema.TaggedErrorClass<HtmlRenderPageTooLargeError>()(
  "HtmlRenderPageTooLargeError",
  { sizeBytes: Schema.Number },
) {
  override get message(): string {
    return `With its images inlined the page is ${formatMib(this.sizeBytes)}; the limit is ${formatMib(MAX_PAGE_BYTES)}. Use smaller images.`;
  }
}

export class HtmlRenderStoreError extends Schema.TaggedErrorClass<HtmlRenderStoreError>()(
  "HtmlRenderStoreError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The HTML render could not be saved.";
  }
}

export type HtmlRenderPrepareError =
  | HtmlRenderImagesNotFoundError
  | HtmlRenderImageTooLargeError
  | HtmlRenderPageTooLargeError;

export class HtmlRenderPreviewError extends Schema.TaggedErrorClass<HtmlRenderPreviewError>()(
  "HtmlRenderPreviewError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "The HTML preview could not be captured. Connect a Ronin desktop client with browser automation and retry.";
  }
}
export interface HtmlPreview {
  readonly png: string;
  readonly width: number;
  readonly contentHeight: number;
  readonly capturedHeight: number;
  readonly capturedWidth?: number;
  readonly consoleMessages: ReadonlyArray<{
    readonly level: "log" | "info" | "warning" | "error";
    readonly text: string;
  }>;
  readonly missingImages?: ReadonlyArray<string>;
}
export class HtmlRender extends Context.Service<
  HtmlRender,
  {
    readonly prepare: (html: string) => Effect.Effect<string, HtmlRenderPrepareError>;
    readonly publish: (input: {
      readonly threadId: ThreadId;
      readonly html: string;
      readonly title: string;
      readonly height?: number | undefined;
    }) => Effect.Effect<HtmlRenderReference, HtmlRenderPrepareError | HtmlRenderStoreError>;
    readonly remove: (attachmentId: string) => Effect.Effect<void>;
    readonly preview: (input: {
      readonly scope: McpInvocationScope;
      readonly html: string;
      readonly width?: number | undefined;
      readonly appearance?: ThemeAppearance | undefined;
    }) => Effect.Effect<
      HtmlPreview,
      HtmlRenderPrepareError | HtmlRenderStoreError | HtmlRenderPreviewError
    >;
  }
>()("t3/htmlRender/HtmlRender") {}

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};
const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME_TYPES).join("|");
// POSIX `/…` (not protocol-relative `//…`) or Windows `C:\…` / `C:/…`.
const ABSOLUTE_PATH = String.raw`(?:/(?!/)|[a-z]:[\\/])`;
// An absolute image path that is a whole quoted string ("…", '…', `…`) or an
// unquoted CSS url(…). URLs, data:, blob:, and relative paths never match.
const LOCAL_IMAGE_PATTERN = new RegExp(
  String.raw`(["'\x60])(${ABSOLUTE_PATH}(?:(?!\1)[^\r\n]){0,2048}?\.(?:${IMAGE_EXTENSIONS}))\1` +
    String.raw`|url\(\s*(${ABSOLUTE_PATH}[^\s"'\x60()]{0,2048}?\.(?:${IMAGE_EXTENSIONS}))\s*\)`,
  "gid",
);

const findLocalImages = (html: string) =>
  Array.from(html.matchAll(LOCAL_IMAGE_PATTERN)).flatMap((match) => {
    const span = match.indices?.[2] ?? match.indices?.[3];
    return span ? [{ start: span[0], end: span[1], path: html.slice(span[0], span[1]) }] : [];
  });

// Inside a JS string literal a Windows path's backslashes are escaped.
const filePathFor = (reference: string) =>
  /^[a-z]:/i.test(reference) ? reference.replaceAll("\\\\", "\\") : reference;

const dataUriPrefix = (path: string) =>
  `data:${IMAGE_MIME_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream"};base64,`;

const latin1 = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

/**
 * Whether file bytes are an image, whatever the file is named, so a symlink or
 * renamed file cannot carry other data, such as a secret, into a page.
 */
const isImageBytes = (bytes: Uint8Array) => {
  const head = latin1(bytes, 0, 12);
  if (
    head.startsWith("\x89PNG") ||
    head.startsWith("\xff\xd8\xff") ||
    head.startsWith("GIF8") ||
    head.startsWith("\0\0\x01\0") ||
    (head.startsWith("BM") && head.slice(6, 10) === "\0\0\0\0") ||
    (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") ||
    /^ftyp(?:avif|avis|mif1)$/.test(head.slice(4, 12))
  ) {
    return true;
  }
  return hasSvgRoot(new TextDecoder().decode(bytes.subarray(0, 4096)));
};

/** The index just past `token` at or after `from`, or -1 when it never appears. */
const after = (text: string, token: string, from: number) => {
  const at = text.indexOf(token, from);
  return at === -1 ? -1 : at + token.length;
};

/**
 * Whether an XML document's root element is <svg>, after any processing
 * instructions, comments, and a doctype. One forward pass, so no input can
 * make it slow, and quoted text never counts as markup.
 */
const hasSvgRoot = (text: string) => {
  let at = 0;
  while (at !== -1) {
    while (/\s/.test(text.charAt(at))) at += 1;
    if (text.startsWith("<?", at)) at = after(text, "?>", at + 2);
    else if (text.startsWith("<!--", at)) at = after(text, "-->", at + 4);
    else if (text.slice(at, at + 9).toLowerCase() === "<!doctype") at = afterDoctype(text, at + 9);
    // XML names are case-sensitive, and only these characters can end one here.
    else return /^<svg[ \t\r\n/>]/.test(text.slice(at, at + 5));
  }
  return false;
};

/** The index just past a doctype whose body starts at `from`, honoring quotes and its internal subset. */
const afterDoctype = (text: string, from: number) => {
  let inSubset = false;
  let at = from;
  while (at !== -1 && at < text.length) {
    const char = text[at];
    if (char === '"' || char === "'") at = after(text, char, at + 1);
    else if (inSubset && text.startsWith("<!--", at)) at = after(text, "-->", at + 4);
    else if (inSubset && text.startsWith("<?", at)) at = after(text, "?>", at + 2);
    else if (char === ">" && !inSubset) return at + 1;
    else {
      if (char === "[") inSubset = true;
      else if (char === "]") inSubset = false;
      at += 1;
    }
  }
  return -1;
};

/** Replaces every local image reference with a data URI; unreadable paths stay as written. */
const inlineLocalImages = Effect.fn("HtmlRender.inlineLocalImages")(function* (html: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const references = findLocalImages(html);
  const files = yield* Effect.forEach(
    [...new Set(references.map((reference) => reference.path))],
    (path) =>
      fileSystem.stat(filePathFor(path)).pipe(
        Effect.map((info) => ({
          path,
          size: info.type === "File" ? Number(info.size) : undefined,
        })),
        Effect.orElseSucceed(() => ({ path, size: undefined })),
      ),
    { concurrency: 8 },
  );
  const oversized = files.find((file) => file.size !== undefined && file.size > MAX_IMAGE_BYTES);
  if (oversized?.size !== undefined) {
    return yield* new HtmlRenderImageTooLargeError({
      path: oversized.path,
      sizeBytes: oversized.size,
    });
  }
  const sizes = new Map(files.map((file) => [file.path, file.size]));
  const pageBytes = references.reduce((total, reference) => {
    const size = sizes.get(reference.path);
    return size === undefined
      ? total
      : total +
          dataUriPrefix(reference.path).length +
          Math.ceil(size / 3) * 4 -
          Buffer.byteLength(reference.path);
  }, Buffer.byteLength(html));
  if (pageBytes > MAX_PAGE_BYTES) {
    return yield* new HtmlRenderPageTooLargeError({ sizeBytes: pageBytes });
  }
  // Files can grow after `stat`. Each read stops one byte past the image
  // limit, and reading stops once the images read so far cannot fit the page.
  let readBytes = 0;
  const images = yield* Effect.forEach(
    files.filter((file) => file.size !== undefined),
    (file) =>
      Effect.gen(function* () {
        const read = yield* fileSystem
          .stream(filePathFor(file.path), { bytesToRead: MAX_IMAGE_BYTES + 1 })
          .pipe(Stream.mkUint8Array, Effect.option);
        if (Option.isNone(read) || !isImageBytes(read.value)) return [];
        const bytes = read.value;
        if (bytes.byteLength > MAX_IMAGE_BYTES) {
          return yield* new HtmlRenderImageTooLargeError({
            path: file.path,
            sizeBytes: bytes.byteLength,
          });
        }
        readBytes += Math.ceil(bytes.byteLength / 3) * 4;
        if (readBytes > MAX_PAGE_BYTES) {
          return yield* new HtmlRenderPageTooLargeError({ sizeBytes: readBytes });
        }
        return [{ path: file.path, bytes }];
      }),
    { concurrency: 4 },
  ).pipe(Effect.map((entries) => entries.flat()));
  const dataUris = new Map(
    images.map(
      (image) =>
        // Node's encoder: images run to 10 MiB.
        [
          image.path,
          dataUriPrefix(image.path) + Buffer.from(image.bytes).toString("base64"),
        ] as const,
    ),
  );
  const parts: Array<string> = [];
  let cursor = 0;
  for (const reference of references) {
    const dataUri = dataUris.get(reference.path);
    if (dataUri === undefined) continue;
    parts.push(html.slice(cursor, reference.start), dataUri);
    cursor = reference.end;
  }
  parts.push(html.slice(cursor));
  const inlined = parts.join("");
  const inlinedBytes = Buffer.byteLength(inlined);
  if (inlinedBytes > MAX_PAGE_BYTES) {
    return yield* new HtmlRenderPageTooLargeError({ sizeBytes: inlinedBytes });
  }
  return {
    html: inlined,
    missing: files.filter((file) => !dataUris.has(file.path)).map((file) => file.path),
  };
});

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const httpServer = yield* HttpServer.HttpServer;
  const broker = yield* PreviewAutomationBroker;
  const previews = yield* PreviewManager;
  const permits = yield* Semaphore.make(2);
  const assetServices =
    yield* Effect.context<Effect.Services<ReturnType<typeof AssetAccess.issueAssetUrl>>>();
  const inline = (html: string) =>
    inlineLocalImages(injectHtmlRenderBootstrap(html)).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );
  const prepare = Effect.fn("HtmlRender.prepare")(function* (html: string) {
    const inlined = yield* inline(html);
    if (inlined.missing.length > 0)
      return yield* new HtmlRenderImagesNotFoundError({ paths: inlined.missing });
    return inlined.html;
  });
  const attachmentPath = (id: string) =>
    resolveAttachmentRelativePath({
      attachmentsDir: config.attachmentsDir,
      relativePath: `${id}.html`,
    });
  const remove = Effect.fn("HtmlRender.remove")(function* (attachmentId: string) {
    const filePath = attachmentPath(attachmentId);
    if (filePath !== null) yield* fileSystem.remove(filePath, { force: true }).pipe(Effect.ignore);
  });
  const store = Effect.fn("HtmlRender.store")(function* (threadId: ThreadId, html: string) {
    const attachmentId = createAttachmentId(threadId, "html");
    const filePath = attachmentId === null ? null : attachmentPath(attachmentId);
    if (attachmentId === null || filePath === null)
      return yield* new HtmlRenderStoreError({ cause: "Invalid thread id" });
    yield* fileSystem.writeFileString(filePath, html).pipe(
      Effect.mapError((cause) => new HtmlRenderStoreError({ cause })),
      Effect.onError(() => remove(attachmentId)),
    );
    return attachmentId;
  });
  const publish = Effect.fn("HtmlRender.publish")(function* (input: {
    readonly threadId: ThreadId;
    readonly html: string;
    readonly title: string;
    readonly height?: number | undefined;
  }) {
    const html = yield* prepare(input.html);
    const attachmentId = yield* store(input.threadId, html);
    return {
      attachmentId,
      title: input.title.trim().slice(0, HTML_RENDER_MAX_TITLE_LENGTH) || "HTML",
      height: clampHtmlRenderHeight(input.height ?? 240),
      ...(input.height === undefined ? { fitContent: true } : {}),
    } satisfies HtmlRenderReference;
  });
  const preview = Effect.fn("HtmlRender.preview")(function* (input: {
    readonly scope: McpInvocationScope;
    readonly html: string;
    readonly width?: number | undefined;
    readonly appearance?: ThemeAppearance | undefined;
  }) {
    if (httpServer.address._tag !== "TcpAddress")
      return yield* new HtmlRenderPreviewError({
        cause: "HTML preview requires a TCP environment endpoint.",
      });
    const port = httpServer.address.port;
    const inlined = yield* inline(input.html);
    const width = Math.min(
      1600,
      Math.max(240, Math.round(input.width ?? HTML_RENDER_COLUMN_WIDTH)),
    );
    const appearance = input.appearance ?? "dark";
    const theme = htmlRenderTheme(
      appearance === "light" ? HTML_RENDER_LIGHT_COLORS : HTML_RENDER_DARK_COLORS,
      appearance,
    );
    return yield* permits.withPermits(1)(
      Effect.scoped(
        Effect.gen(function* () {
          const attachmentId = yield* Effect.acquireRelease(
            store(input.scope.threadId, inlined.html),
            remove,
          );
          const url = yield* AssetAccess.issueAssetUrl({
            resource: {
              _tag: "attachment",
              attachmentId,
              fileName: "page.html",
              mimeType: "text/html",
              disposition: "inline",
            },
          }).pipe(
            Effect.provideContext(assetServices),
            Effect.mapError((cause) => new HtmlRenderPreviewError({ cause })),
          );
          // Every operation is pinned to this temporary tab; none changes the provider's current tab.
          const opened = yield* Effect.acquireRelease(
            broker
              .invoke({
                scope: input.scope,
                operation: "open",
                input: { open: false, reuseExistingTab: false },
                updateCurrentTab: false,
              })
              .pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(PreviewAutomationStatus)),
                Effect.mapError((cause) => new HtmlRenderPreviewError({ cause })),
              ),
            (status) =>
              status.tabId === null
                ? Effect.void
                : previews
                    .close({ threadId: input.scope.threadId, tabId: status.tabId })
                    .pipe(Effect.ignore),
          );
          const tabId = opened.tabId;
          if (tabId === null)
            return yield* new HtmlRenderPreviewError({ cause: "Preview did not create a tab" });
          const invoke = <A>(
            operation: Parameters<typeof broker.invoke>[0]["operation"],
            value: unknown,
          ) =>
            broker
              .invoke<A>({
                scope: input.scope,
                operation,
                input: value,
                tabId,
                updateCurrentTab: false,
              })
              .pipe(Effect.mapError((cause) => new HtmlRenderPreviewError({ cause })));
          yield* invoke("resize", { mode: "freeform", width, height: 240 });
          yield* invoke("setColorScheme", { colorScheme: appearance });
          // The renderer resolves this environment port through its local, remote or SSH proxy.
          yield* invoke("navigate", {
            target: {
              kind: "environment-port",
              port,
              path: `${url.relativeUrl}${htmlRenderThemeFragment(theme)}`,
            },
          });
          const contentHeight = yield* invoke("evaluate", {
            expression:
              "(async () => { if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve, {once:true})); await document.fonts.ready; const root = document.documentElement; return Math.ceil(root.scrollHeight > root.clientHeight ? root.scrollHeight : root.getBoundingClientRect().height); })()",
            awaitPromise: true,
            returnByValue: true,
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Int.check(Schema.isGreaterThan(0)))),
            Effect.mapError((cause) => new HtmlRenderPreviewError({ cause })),
          );
          yield* invoke("resize", {
            mode: "freeform",
            width,
            height: Math.max(240, Math.min(2000, contentHeight)),
          });
          const snapshot = yield* invoke("snapshot", {}).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(PreviewAutomationSnapshot)),
            Effect.mapError((cause) => new HtmlRenderPreviewError({ cause })),
          );
          return {
            png: snapshot.screenshot.data,
            width,
            capturedWidth: snapshot.screenshot.width,
            contentHeight,
            capturedHeight: snapshot.screenshot.height,
            consoleMessages: snapshot.consoleEntries.slice(-20).map((entry) => ({
              level:
                entry.level === "error"
                  ? ("error" as const)
                  : entry.level === "warning" || entry.level === "warn"
                    ? ("warning" as const)
                    : entry.level === "info"
                      ? ("info" as const)
                      : ("log" as const),
              text: entry.text.slice(0, 500),
            })),
            ...(inlined.missing.length === 0 ? {} : { missingImages: inlined.missing }),
          } satisfies HtmlPreview;
        }),
      ),
    );
  });
  return HtmlRender.of({ prepare, publish, remove, preview });
});
export const layer = Layer.effect(HtmlRender, make);

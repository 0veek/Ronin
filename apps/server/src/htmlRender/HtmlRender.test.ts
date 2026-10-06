import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  PreviewAutomationNavigateInput,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Encoding from "effect/Encoding";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HtmlRender from "./HtmlRender.ts";
import { PreviewAutomationBroker } from "../mcp/PreviewAutomationBroker.ts";
import type { PreviewAutomationInvokeInput } from "../mcp/PreviewAutomationBroker.ts";
import { PreviewManager } from "../preview/Manager.ts";
import { ProjectionThreadActivityRepository } from "../persistence/Services/ProjectionThreadActivities.ts";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { resolveAttachmentPathById } from "../attachmentStore.ts";
import { ASSET_ROUTE_PREFIX, resolveAsset } from "../assets/AssetAccess.ts";
import { ProjectFaviconResolver } from "../project/ProjectFaviconResolver.ts";

const configLayer = ServerConfig.layerTest(process.cwd(), { prefix: "ronin-html-render-" });
const dependencies = Layer.mergeAll(
  Layer.mock(HttpServer.HttpServer)({
    address: { _tag: "TcpAddress", hostname: "127.0.0.1", port: 7788 },
  }),
  Layer.mock(ProjectionThreadActivityRepository)({}),
  Layer.mock(ProjectFaviconResolver)({}),
  WorkspacePaths.layer,
  ServerSecretStore.layer.pipe(Layer.provide(configLayer)),
  configLayer,
).pipe(Layer.provideMerge(NodeServices.layer));
const testLayer = HtmlRender.layer.pipe(
  Layer.provide(Layer.mock(PreviewAutomationBroker)({})),
  Layer.provide(Layer.mock(PreviewManager)({})),
  Layer.provideMerge(dependencies),
);
const decodeNavigateInput = Schema.decodeUnknownEffect(PreviewAutomationNavigateInput);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("HtmlRender", () => {
  for (const malformed of [false, true]) {
    it.effect(
      `uses a signed environment asset and cleans the temporary tab on ${malformed ? "failure" : "success"}`,
      () =>
        Effect.gen(function* () {
          const requests: PreviewAutomationInvokeInput[] = [];
          const closed: string[] = [];
          const tabId = PreviewTabId.make("html-temporary");
          const scope = {
            environmentId: EnvironmentId.make("remote"),
            threadId: ThreadId.make("html-preview"),
            providerInstanceId: ProviderInstanceId.make("codex"),
            providerSessionId: "session",
            capabilities: new Set(["html"] as const),
            issuedAt: 0,
          };
          const brokerLayer = Layer.effect(
            PreviewAutomationBroker,
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const assetServices =
                yield* Effect.context<Effect.Services<ReturnType<typeof resolveAsset>>>();
              return PreviewAutomationBroker.of({
                connect: () => Effect.succeed(Stream.empty),
                focusHost: () => Effect.void,
                respond: () => Effect.void,
                invoke: <A>(request: PreviewAutomationInvokeInput) =>
                  Effect.gen(function* () {
                    requests.push(request);
                    if (request.operation === "open")
                      return {
                        available: true,
                        visible: false,
                        tabId,
                        url: null,
                        title: null,
                        loading: false,
                      } as A;
                    if (request.operation === "navigate") {
                      const { target } = yield* decodeNavigateInput(request.input);
                      expect(target?.kind).toBe("environment-port");
                      if (target?.kind !== "environment-port")
                        throw new Error("Missing environment target");
                      expect(target.port).toBe(7788);
                      const [token, fileName] = target
                        .path!.split("#", 1)[0]!
                        .slice(ASSET_ROUTE_PREFIX.length + 1)
                        .split("/");
                      const asset = yield* resolveAsset(token!, fileName!).pipe(
                        Effect.provideContext(assetServices),
                      );
                      expect(asset?.kind).toBe("file");
                      if (asset?.kind !== "file") throw new Error("Signed page was unavailable");
                      expect(yield* fs.readFileString(asset.path)).toContain("<p>Preview</p>");
                    }
                    if (request.operation === "evaluate") return 420 as A;
                    if (request.operation === "snapshot")
                      return (
                        malformed
                          ? {}
                          : {
                              url: "about:blank",
                              title: "Preview",
                              loading: false,
                              visibleText: "Preview",
                              interactiveElements: [],
                              accessibilityTree: {},
                              networkEntries: [],
                              actionTimeline: [],
                              consoleEntries: [
                                { level: "warn", text: "Chart ready", timestamp: "now" },
                              ],
                              screenshot: {
                                mimeType: "image/png",
                                data: "cG5n",
                                width: 1280,
                                height: 420,
                              },
                            }
                      ) as A;
                    return {} as A;
                  }).pipe(Effect.orDie),
              });
            }),
          );
          const layer = HtmlRender.layer.pipe(
            Layer.provide(brokerLayer),
            Layer.provide(
              Layer.mock(PreviewManager)({
                close: ({ tabId }) =>
                  Effect.sync(() => {
                    if (tabId) closed.push(tabId);
                  }),
              }),
            ),
            Layer.provideMerge(dependencies),
          );
          yield* Effect.gen(function* () {
            const render = yield* HtmlRender.HtmlRender;
            const fs = yield* FileSystem.FileSystem;
            const config = yield* ServerConfig.ServerConfig;
            const result = yield* render
              .preview({
                scope,
                html: '<p>Preview</p><img src="/missing/shot.png">',
                appearance: "light",
                width: 1600,
              })
              .pipe(Effect.result);
            if (malformed) expect(result._tag).toBe("Failure");
            else {
              expect(result._tag).toBe("Success");
              if (result._tag === "Success")
                expect(result.success).toMatchObject({
                  width: 1600,
                  capturedWidth: 1280,
                  contentHeight: 420,
                  capturedHeight: 420,
                  png: "cG5n",
                  missingImages: ["/missing/shot.png"],
                  consoleMessages: [{ level: "warning", text: "Chart ready" }],
                });
            }
            expect(closed).toEqual([tabId]);
            expect(yield* fs.readDirectory(config.attachmentsDir)).toEqual([]);
            expect(requests[0]?.input).toEqual({ open: false, reuseExistingTab: false });
            expect(requests.every((request) => request.updateCurrentTab === false)).toBe(true);
            expect(requests.slice(1).every((request) => request.tabId === tabId)).toBe(true);
          }).pipe(Effect.provide(layer));
        }),
    );
  }
  it.effect("inlines local images by absolute path and leaves URLs and relative paths alone", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const htmlRender = yield* HtmlRender.HtmlRender;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-html-images-" });
      const png = path.join(directory, "shot.png");
      const svg = path.join(directory, "logo.svg");
      yield* fileSystem.writeFile(png, PNG_BYTES);
      yield* fileSystem.writeFileString(svg, "<svg/>");
      const kept = [
        "https://example.com/a.png",
        "//cdn.example.com/b.png",
        "./c.png",
        "data:image/png;base64,AAAA",
      ];

      const prepared = yield* htmlRender.prepare(
        [
          "<!doctype html><html><head><title>Shots</title></head><body>",
          `<img src="${png}"><div style="background:url(${svg})"></div>`,
          `<script>const shots = ['${png}', \`${svg}\`];</script>`,
          ...kept.map((src) => `<img src="${src}">`),
          "</body></html>",
        ].join(""),
      );

      const pngUri = `data:image/png;base64,${Encoding.encodeBase64(PNG_BYTES)}`;
      const svgUri = `data:image/svg+xml;base64,${Encoding.encodeBase64("<svg/>")}`;
      expect(prepared).toContain(`<img src="${pngUri}">`);
      expect(prepared).toContain(`url(${svgUri})`);
      expect(prepared).toContain(`['${pngUri}', \`${svgUri}\`]`);
      expect(prepared).not.toContain(directory);
      for (const src of kept) expect(prepared).toContain(`<img src="${src}">`);
      // The theme bootstrap opens the head, ahead of the page's own markup.
      expect(prepared.indexOf("<head>")).toBeLessThan(prepared.indexOf('<style id="t3-theme">'));
      expect(prepared.indexOf('<style id="t3-theme">')).toBeLessThan(prepared.indexOf("<title>"));
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("inlines an SVG behind processing instructions and a doctype subset", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const htmlRender = yield* HtmlRender.HtmlRender;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-html-images-" });
      const svg = path.join(directory, "styled.svg");
      const source = [
        '<?xml version="1.0"?>',
        '<?xml-stylesheet href="theme.css"?>',
        '<!DOCTYPE svg [ <!ENTITY fill "red"> ]>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>',
      ].join("\n");
      yield* fileSystem.writeFileString(svg, source);

      const prepared = yield* htmlRender.prepare(`<img src="${svg}">`);

      expect(prepared).toContain(`data:image/svg+xml;base64,${Encoding.encodeBase64(source)}`);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("lists every local image it cannot read", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const htmlRender = yield* HtmlRender.HtmlRender;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-html-images-" });
      const folder = path.join(directory, "folder.png");
      yield* fileSystem.makeDirectory(folder);
      const missing = path.join(directory, "missing.jpg");
      // Named like an image, but a symlink or renamed file must not carry other data.
      const secret = path.join(directory, "secret.png");
      yield* fileSystem.writeFileString(secret, "API_KEY=abc123");
      const report = path.join(directory, "report.svg");
      yield* fileSystem.writeFileString(report, "<!doctype html><body><svg></svg>API_KEY=abc123");
      // An <svg> inside a quoted entity, and a prolog shaped to stall a backtracking matcher.
      const config = path.join(directory, "config.svg");
      yield* fileSystem.writeFileString(
        config,
        '<!DOCTYPE config [<!ENTITY a "a"><!ENTITY b "]><svg/>">]><config>API_KEY=abc123</config>',
      );
      const stalling = path.join(directory, "stalling.svg");
      yield* fileSystem.writeFileString(stalling, `${"<?p?>".repeat(40)}<config><svg/></config>`);
      const unclosed = path.join(directory, "unclosed.svg");
      yield* fileSystem.writeFileString(unclosed, '<!DOCTYPE svg [<!ENTITY a "x><svg/>');
      // Roots named SVG or svgé are other elements.
      const upper = path.join(directory, "upper.svg");
      yield* fileSystem.writeFileString(upper, "<SVG/>API_KEY=abc123");
      const longer = path.join(directory, "longer.svg");
      yield* fileSystem.writeFileString(longer, "<svg\u00e9/>API_KEY=abc123");

      const error = yield* htmlRender
        .prepare(
          `<img src="${missing}"><img src='${folder}'><img src="C:\\nope\\shot.webp"><img src="${secret}"><img src="${report}"><img src="${config}"><img src="${stalling}"><img src="${unclosed}"><img src="${upper}"><img src="${longer}">`,
        )
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(HtmlRender.HtmlRenderImagesNotFoundError);
      expect(error._tag === "HtmlRenderImagesNotFoundError" && error.paths).toEqual([
        missing,
        folder,
        "C:\\nope\\shot.webp",
        secret,
        report,
        config,
        stalling,
        unclosed,
        upper,
        longer,
      ]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("publishes an automatically fitted page without a preview host", () =>
    Effect.gen(function* () {
      const htmlRender = yield* HtmlRender.HtmlRender;
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const reference = yield* htmlRender.publish({
        threadId: ThreadId.make("thread-html-auto-fit"),
        html: "<p>Growing chart</p>",
        title: "Chart",
      });
      expect(reference.fitContent).toBe(true);
      const stored = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: reference.attachmentId,
      });
      expect(yield* fileSystem.readFileString(stored ?? "")).toContain("<p>Growing chart</p>");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("publishes the prepared page as an html thread attachment", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const htmlRender = yield* HtmlRender.HtmlRender;

      const reference = yield* htmlRender.publish({
        threadId: ThreadId.make("thread-html-render"),
        html: "<p>Quarterly revenue</p>",
        title: "  Revenue  ",
        height: 9_000,
      });

      // Without an installed preview browser the page publishes unmeasured.
      expect(reference).toEqual({
        attachmentId: expect.any(String),
        title: "Revenue",
        height: 2_000,
      });
      const stored = resolveAttachmentPathById({
        attachmentsDir: config.attachmentsDir,
        attachmentId: reference.attachmentId,
      });
      expect(stored?.endsWith(".html")).toBe(true);
      const html = yield* fileSystem.readFileString(stored ?? "");
      expect(html).toContain('<style id="t3-theme">');
      expect(html).toContain("<p>Quarterly revenue</p>");
    }).pipe(Effect.provide(testLayer)),
  );
});

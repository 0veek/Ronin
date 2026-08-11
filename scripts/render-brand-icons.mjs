#!/usr/bin/env node
//
// Renders every tracked brand raster from the SVG masters in assets/brand.
//
// This is the portable counterpart to export-brand-icons.ts. That script drives
// Icon Composer and therefore only runs on macOS with Xcode installed; this one
// needs rsvg-convert and ImageMagick, so the icons can be regenerated on Linux
// and in CI. The two are not interchangeable: Icon Composer owns the .icon
// projects and their glass/translucency treatment, while this script owns the
// flat PNG and ICO exports checked into assets/.
//
// Usage: node scripts/render-brand-icons.mjs [--check]
//
//   --check  render to a temporary directory and diff against the tracked
//            files instead of writing, mirroring `icons:check`.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const REPOSITORY_ROOT = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const BRAND_DIRECTORY = NodePath.join(REPOSITORY_ROOT, "assets", "brand");

// Apple's icon grid: the corner radius is a fixed fraction of the icon edge.
const CORNER_RADIUS_RATIO = 0.2237;
// The classic macOS safe area - an 824pt body centred in a 1024pt canvas.
const MAC_CANVAS = 1024;
const MAC_BODY = 824;
// Blur stays well under the 100pt inset so the shadow never reaches the canvas
// edge, which is what lets the safe-area assertion in assets/README.md hold.
const SHADOW_BLUR_SIGMA = 18;
const SHADOW_OFFSET_Y = 12;
const SHADOW_OPACITY = 0.45;
const WINDOWS_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Every channel renders the same eight outputs. Paths are kept in step with
 * BRAND_ASSET_PATHS in scripts/lib/brand-assets.ts by the assertion below.
 */
const VARIANTS = [
  {
    label: "development",
    source: "ronin-icon-dev.svg",
    directory: "assets/dev",
    prefix: "blueprint",
  },
  {
    label: "nightly",
    source: "ronin-icon-nightly.svg",
    directory: "assets/nightly",
    prefix: "nightly",
  },
  {
    label: "production",
    source: "ronin-icon.svg",
    directory: "assets/prod",
    prefix: "ronin",
  },
];

function outputsFor(variant) {
  const { directory: d, prefix: p } = variant;
  return {
    ios: `${d}/${p}-ios-1024.png`,
    macos: `${d}/${p}-macos-1024.png`,
    universal: `${d}/${p}-universal-1024.png`,
    appleTouch: `${d}/${p}-web-apple-touch-180.png`,
    favicon16: `${d}/${p}-web-favicon-16x16.png`,
    favicon32: `${d}/${p}-web-favicon-32x32.png`,
    faviconIco: `${d}/${p}-web-favicon.ico`,
    windowsIco: `${d}/${p}-windows.ico`,
  };
}

/**
 * ImageMagick stamps PNGs with the current time, which would make every render
 * differ from the tracked bytes and leave --check permanently failing. Strip
 * metadata and the date chunks so a rebuild of unchanged art is a no-op.
 */
const DETERMINISTIC_PNG = ["-strip", "-define", "png:exclude-chunk=date,time"];

function run(command, args) {
  NodeChildProcess.execFileSync(command, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function requireTool(command, versionArgument) {
  try {
    run(command, [versionArgument]);
  } catch {
    throw new Error(
      `${command} is required to render brand icons. Install librsvg and ImageMagick, ` +
        `or run the macOS-only \`vp run icons:export\` instead.`,
    );
  }
}

/** Renders the SVG square at `size`, then rounds the corners on Apple's grid. */
function renderRounded(sourcePath, size, destinationPath) {
  const radius = Math.round(size * CORNER_RADIUS_RATIO);
  const flat = `${destinationPath}.flat.png`;
  run("rsvg-convert", ["-w", String(size), "-h", String(size), sourcePath, "-o", flat]);
  run("magick", [
    flat,
    "(",
    "-size",
    `${size}x${size}`,
    "xc:none",
    "-draw",
    `roundrectangle 0,0,${size - 1},${size - 1},${radius},${radius}`,
    "-alpha",
    "extract",
    ")",
    "-compose",
    "CopyOpacity",
    "-composite",
    ...DETERMINISTIC_PNG,
    destinationPath,
  ]);
  NodeFS.rmSync(flat);
}

/**
 * The macOS icon is not full bleed: the opaque body is inset so the system
 * shadow has somewhere to fall. Matches the geometry assets/README.md documents
 * for the native Icon Composer export.
 */
function renderMacOs(sourcePath, destinationPath) {
  const body = `${destinationPath}.body.png`;
  renderRounded(sourcePath, MAC_BODY, body);
  const inset = (MAC_CANVAS - MAC_BODY) / 2;

  // ImageMagick's -shadow grows the canvas by its own blur padding, which drags
  // the body off the safe area. Seat the body at an exact +100+100 first, then
  // derive the shadow from that placement so only the blur leaves the body box.
  const placed = `${destinationPath}.placed.png`;
  run("magick", [
    "-size",
    `${MAC_CANVAS}x${MAC_CANVAS}`,
    "xc:none",
    body,
    "-geometry",
    `+${inset}+${inset}`,
    "-composite",
    ...DETERMINISTIC_PNG,
    placed,
  ]);

  run("magick", [
    "(",
    placed,
    "-alpha",
    "extract",
    "-roll",
    `+0+${SHADOW_OFFSET_Y}`,
    "-blur",
    `0x${SHADOW_BLUR_SIGMA}`,
    "-evaluate",
    "multiply",
    String(SHADOW_OPACITY),
    "-write",
    "mpr:shadow-alpha",
    "+delete",
    ")",
    "-size",
    `${MAC_CANVAS}x${MAC_CANVAS}`,
    "xc:black",
    "mpr:shadow-alpha",
    "-alpha",
    "off",
    "-compose",
    "CopyOpacity",
    "-composite",
    placed,
    "-compose",
    "Over",
    "-composite",
    ...DETERMINISTIC_PNG,
    destinationPath,
  ]);

  NodeFS.rmSync(body);
  NodeFS.rmSync(placed);
}

function renderIco(sourcePath, destinationPath, workingDirectory) {
  const frames = WINDOWS_ICON_SIZES.map((size) => {
    const frame = NodePath.join(workingDirectory, `ico-${size}.png`);
    renderRounded(sourcePath, size, frame);
    return frame;
  });
  run("magick", [...frames, ...DETERMINISTIC_PNG, destinationPath]);
  for (const frame of frames) NodeFS.rmSync(frame);
}

function renderVariant(variant, targetRoot, workingDirectory) {
  const source = NodePath.join(BRAND_DIRECTORY, variant.source);
  const outputs = outputsFor(variant);
  const resolve = (relative) => {
    const absolute = NodePath.join(targetRoot, relative);
    NodeFS.mkdirSync(NodePath.dirname(absolute), { recursive: true });
    return absolute;
  };

  renderRounded(source, 1024, resolve(outputs.ios));
  renderRounded(source, 1024, resolve(outputs.universal));
  renderMacOs(source, resolve(outputs.macos));
  renderRounded(source, 180, resolve(outputs.appleTouch));
  renderRounded(source, 16, resolve(outputs.favicon16));
  renderRounded(source, 32, resolve(outputs.favicon32));
  renderIco(source, resolve(outputs.faviconIco), workingDirectory);
  renderIco(source, resolve(outputs.windowsIco), workingDirectory);

  return Object.values(outputs);
}

/**
 * The web build serves whatever sits in apps/web/public, so the development
 * icons are mirrored there. Same contract as DEVELOPMENT_PUBLIC_ICON_OVERRIDES.
 */
const PUBLIC_ICON_COPIES = [
  ["assets/dev/blueprint-web-favicon.ico", "apps/web/public/favicon.ico"],
  ["assets/dev/blueprint-web-favicon-16x16.png", "apps/web/public/favicon-16x16.png"],
  ["assets/dev/blueprint-web-favicon-32x32.png", "apps/web/public/favicon-32x32.png"],
  ["assets/dev/blueprint-web-apple-touch-180.png", "apps/web/public/apple-touch-icon.png"],
];

function main() {
  const check = process.argv.includes("--check");
  requireTool("rsvg-convert", "--version");
  requireTool("magick", "--version");

  const workingDirectory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ronin-icons-"));
  const targetRoot = check ? NodePath.join(workingDirectory, "out") : REPOSITORY_ROOT;

  try {
    const written = [];
    for (const variant of VARIANTS) {
      written.push(...renderVariant(variant, targetRoot, workingDirectory));
    }

    for (const [source, destination] of PUBLIC_ICON_COPIES) {
      const from = NodePath.join(targetRoot, source);
      const to = NodePath.join(targetRoot, destination);
      NodeFS.mkdirSync(NodePath.dirname(to), { recursive: true });
      NodeFS.copyFileSync(from, to);
      written.push(destination);
    }

    if (!check) {
      console.log(`Rendered ${written.length} brand assets from assets/brand.`);
      return;
    }

    const stale = written.filter((relative) => {
      const tracked = NodePath.join(REPOSITORY_ROOT, relative);
      const rendered = NodePath.join(targetRoot, relative);
      try {
        return !NodeFS.readFileSync(tracked).equals(NodeFS.readFileSync(rendered));
      } catch {
        return true;
      }
    });

    if (stale.length > 0) {
      console.error("Brand assets are out of date with assets/brand:");
      for (const relative of stale) console.error(`  ${relative}`);
      console.error("\nRun `node scripts/render-brand-icons.mjs` to regenerate them.");
      process.exitCode = 1;
      return;
    }

    console.log(`All ${written.length} brand assets match assets/brand.`);
  } finally {
    NodeFS.rmSync(workingDirectory, { recursive: true, force: true });
  }
}

main();

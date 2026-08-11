# Brand icons

## The Ronin mark

`brand/` holds the SVG masters every other asset is derived from:

- `ronin-mark.svg` — the mark on its own, in colour, transparent background
- `ronin-mark-mono.svg` — single colour via `currentColor`, for glass layers, tray icons, and print
- `ronin-icon.svg` — the full-bleed production app icon
- `ronin-icon-dev.svg` / `ronin-icon-nightly.svg` — the same mark on the channel backgrounds

The mark is a kasa cut by a katana laid behind it. The hat is drawn last and is never broken by the blade: that is what keeps it legible at 16px, so keep the hat a single unbroken shape when editing. The blade is a lens built from one centreline with its control points offset 9 units, because a cubic only carries three quarters of a control-point offset to its midpoint.

Brand colours are ink `#0B0B10`, bone `#FFFDF8` → `#DCD2C0`, and crimson `#C6303A`.

## Rendering the tracked assets

There are two exporters and they own different outputs.

`node scripts/render-brand-icons.mjs` renders every tracked PNG and ICO straight from `brand/`, and mirrors the development web exports into `apps/web/public` for the browser favicon and splash screen. It needs `rsvg-convert` and ImageMagick, runs anywhere, and is what produced the assets currently checked in. Pass `--check` to diff against the tracked files without writing.

`vp run icons:export` drives Icon Composer instead, and only runs on macOS with Icon Composer 2 or newer. It owns the three `app-icon.icon` projects and their glass and translucency treatment. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery. `vp run icons:check` verifies those outputs without changing files.

The Icon Composer projects are the source of truth for full application icons:

- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

Each project uses `mark.svg` for the Ronin mark and `background.svg` when the background is a vector layer. Additional layers use semantic names that describe their role and placement. `mark.svg` is a copy of `brand/ronin-mark-mono.svg` scaled to the layer footprint — edit the master and mirror it into all three projects.

## macOS exports

Icon Composer's command-line exporter does not expose the `macOS pre-Tahoe` preset. A plain command-line `macOS` export is full bleed and is not suitable for the desktop app, so `icons:export` intentionally leaves the tracked macOS PNGs unchanged and prints a reminder after every run. `render-brand-icons.mjs` does produce them, building the safe area itself.

After changing an Icon Composer project, open it in Icon Composer and export the macOS PNG with exactly these settings:

- Platform: `macOS pre-Tahoe`
- Appearance: `Default`
- Size: `1024pt`
- Scale: `1×`

Save the three exports to:

- `dev/app-icon.icon` -> `dev/blueprint-macos-1024.png`
- `nightly/app-icon.icon` -> `nightly/nightly-macos-1024.png`
- `prod/app-icon.icon` -> `prod/ronin-macos-1024.png`

The result must be a 1024×1024 PNG with the classic macOS safe area: the opaque icon body is 824×824, inset 100 pixels on every side, with only the native shadow extending into the surrounding transparent canvas.

To have an agent perform the native exports, paste this prompt into a task opened at the repository root:

```text
Use the Icon Composer app to export the three macOS app icons in this repository.

For each project below, use Platform: macOS pre-Tahoe, Appearance: Default, Size: 1024pt, and Scale: 1×, then save the PNG to the exact destination:

- assets/dev/app-icon.icon -> assets/dev/blueprint-macos-1024.png
- assets/nightly/app-icon.icon -> assets/nightly/nightly-macos-1024.png
- assets/prod/app-icon.icon -> assets/prod/ronin-macos-1024.png

Do not resize, composite, or otherwise post-process the exported PNGs.

Verify every result is 1024×1024 and has the classic macOS safe area: an 824×824 opaque body inset 100px on every side, with only Icon Composer's native shadow extending beyond it.
```

Do not edit the generated PNG or ICO files directly.

import { type ImgHTMLAttributes, useState } from "react";

import { BrokenFileIcon, BrokenImageIcon } from "./Icons";
import { cn } from "~/lib/utils";

/**
 * What the UI shows in place of media it could not load.
 *
 * The browser's own broken-image glyph is the thing this replaces: it renders
 * at the intrinsic size of a missing file (a few stray pixels), carries no
 * explanation, and looks like a rendering bug rather than a missing file. Every
 * `<img>` whose source can fail — markdown embeds, attachments, favicons,
 * workspace previews — should fall back here instead.
 */

export type MissingMediaKind = "image" | "file";

function MissingMediaIcon({ kind, className }: { kind: MissingMediaKind; className?: string }) {
  const Icon = kind === "file" ? BrokenFileIcon : BrokenImageIcon;
  return <Icon className={className} aria-hidden />;
}

/**
 * Inline variant, sized to sit in a line of prose. Used for markdown image
 * embeds, where the alt text is usually the only description of what is
 * missing and so is worth keeping visible.
 */
export function MissingMediaChip({
  label,
  kind = "image",
  title,
  className,
}: {
  readonly label?: string | undefined;
  readonly kind?: MissingMediaKind;
  /** Full source, surfaced on hover so the path stays recoverable. */
  readonly title?: string | undefined;
  readonly className?: string;
}) {
  const text = label?.trim();
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 border-dashed",
        "bg-muted/30 px-2 py-1 align-middle text-muted-foreground text-xs",
        className,
      )}
      {...(title ? { title } : {})}
    >
      <MissingMediaIcon kind={kind} className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">{text && text.length > 0 ? text : "Image unavailable"}</span>
    </span>
  );
}

/**
 * Block variant for panels that had reserved space for the media, so the
 * placeholder fills that space rather than collapsing the layout around it.
 */
export function MissingMediaBlock({
  label,
  kind = "image",
  className,
}: {
  readonly label?: string | undefined;
  readonly kind?: MissingMediaKind;
  readonly className?: string;
}) {
  const text = label?.trim();
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center",
        "text-muted-foreground",
        className,
      )}
    >
      <MissingMediaIcon kind={kind} className="size-6 opacity-60" />
      <span className="text-xs leading-relaxed">
        {text && text.length > 0 ? text : "Image unavailable"}
      </span>
    </div>
  );
}

/**
 * An `<img>` that degrades to a placeholder instead of the browser's broken
 * glyph. Drop-in for any source that can 404 — expired asset URLs, revoked
 * object URLs, attachments whose blob has been swept.
 *
 * `fallback` covers the cases where the surrounding layout wants something
 * other than the default chip (a fixed-size tile, a block panel).
 */
export function FallbackImage({
  src,
  alt,
  kind = "image",
  fallback,
  fallbackLabel,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
  readonly src: string | undefined;
  readonly alt: string;
  readonly kind?: MissingMediaKind;
  readonly fallback?: React.ReactNode;
  /** Defaults to `alt`; pass "" to show only the icon. */
  readonly fallbackLabel?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      fallback ?? (
        <MissingMediaChip
          label={fallbackLabel ?? alt}
          kind={kind}
          {...(src ? { title: src } : {})}
        />
      )
    );
  }

  return <img {...props} src={src} alt={alt} onError={() => setFailedSrc(src)} />;
}

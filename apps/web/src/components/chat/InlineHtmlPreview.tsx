/**
 * An HTML file the agent just wrote, shown where it was mentioned.
 *
 * Rendered in place of a paragraph that is nothing but a link to a local HTML
 * file (see `markdown-html-preview.ts`). The frame is sandboxed without
 * `allow-same-origin`, which gives the page an opaque origin: its scripts run,
 * its own stylesheets and images load, and it can still reach nothing of
 * Ronin's — not the DOM around it, not its storage, not its cookies. That is
 * the whole reason this can be safe to show automatically.
 *
 * @module InlineHtmlPreview
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ChevronDownIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Frame height.
 *
 * Tall enough for a chart or a summary table to arrive whole, short enough
 * that it cannot swallow the conversation around it. A same-origin frame could
 * measure its own content and grow to fit; an opaque one cannot, and the
 * isolation is worth more than the perfect fit.
 */
const PREVIEW_HEIGHT_PX = 320;

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export const InlineHtmlPreview = memo(function InlineHtmlPreview({
  path,
  threadRef,
  label,
  onOpenInPanel,
}: {
  readonly path: string;
  readonly threadRef: ScopedThreadRef;
  /** The link text the agent wrote, when it said something other than the filename. */
  readonly label?: string | undefined;
  readonly onOpenInPanel?: ((path: string) => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(true);
  // Bumped to force the frame to remount. An `src` that has not changed will
  // not reload on its own, and re-running the agent is the common reason to
  // want a second look at the same path.
  const [reloadKey, setReloadKey] = useState(0);
  const assetUrl = useAssetUrlState(threadRef.environmentId, {
    _tag: "workspace-file",
    threadId: threadRef.threadId,
    path,
  });

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const name = basename(path);
  const title = label && label !== path && label !== name ? label : name;

  return (
    <div className="my-2 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
      <div className="flex items-center gap-2 border-border border-b bg-muted/30 px-3 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast)",
              expanded ? null : "-rotate-90",
            )}
          />
          <Tooltip>
            <TooltipTrigger
              render={<span className="min-w-0 truncate font-medium text-sm">{title}</span>}
            />
            <TooltipPopup side="top" className="max-w-96 break-all">
              {path}
            </TooltipPopup>
          </Tooltip>
        </button>
        {expanded && assetUrl._tag === "Success" ? (
          <Button size="icon-xs" variant="ghost" aria-label="Reload preview" onClick={reload}>
            <RefreshCwIcon className="size-3.5" />
          </Button>
        ) : null}
        {onOpenInPanel ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Open ${name} in panel`}
            onClick={() => onOpenInPanel(path)}
          >
            <ExternalLinkIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {expanded ? (
        <div style={{ height: PREVIEW_HEIGHT_PX }} className="bg-white">
          {assetUrl._tag === "Success" ? (
            <iframe
              key={reloadKey}
              src={assetUrl.url}
              title={`Preview of ${name}`}
              className="size-full border-0"
              // No `allow-same-origin`: the frame keeps an opaque origin and
              // cannot reach Ronin's DOM, storage, or cookies. Scripts and
              // forms are allowed so a real page behaves like one.
              sandbox="allow-scripts allow-forms allow-popups"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-card text-muted-foreground text-sm">
              {assetUrl._tag === "Failure" ? "This file could not be read." : "Loading preview…"}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});

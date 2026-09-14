import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ImageIcon,
  TextIcon,
  XIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { downloadVideoPreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import { MissingMediaBlock } from "../MissingMedia";
import {
  SnapShotAccessibilityData,
  SnapShotContentsButton,
  snapShotAccessibilityDetails,
} from "./SnapShotAttachmentDetails";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ZoomableImage, type ZoomableImageHandle } from "./ZoomableImage";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
}

export const ExpandedImageDialog = memo(function ExpandedImageDialog({
  preview,
  onClose,
}: ExpandedImageDialogProps) {
  const [imageOffset, setImageOffset] = useState(0);
  const zoomableImageRef = useRef<ZoomableImageHandle>(null);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const [failedVideoSrc, setFailedVideoSrc] = useState<string | null>(null);
  const [downloadingVideoSrc, setDownloadingVideoSrc] = useState<string | null>(null);
  const [downloadFailedVideoSrc, setDownloadFailedVideoSrc] = useState<string | null>(null);
  const [accessibilityDetailsSrc, setAccessibilityDetailsSrc] = useState<string | null>(null);
  const count = preview.images.length;
  // imageOffset is unbounded, so normalize any integer offset back into range.
  const index = count > 0 ? (((preview.index + imageOffset) % count) + count) % count : 0;

  const navigateImage = useCallback((direction: -1 | 1) => {
    setImageOffset((current) => current + direction);
  }, []);

  const downloadVideo = async (src: string, name: string) => {
    setDownloadFailedVideoSrc(null);
    setDownloadingVideoSrc(src);
    try {
      await downloadVideoPreview(src, name);
    } catch {
      setDownloadFailedVideoSrc(src);
    } finally {
      setDownloadingVideoSrc((current) => (current === src ? null : current));
    }
  };

  // The element that opened the preview gets focus back on close. Without
  // this a close button click leaves focus on the unmounted dialog, and the
  // composer that owned the opener reads that as a blur and rests.
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.target instanceof HTMLVideoElement) return;
    if (zoomableImageRef.current?.pan(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (preview.images.length <= 1) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      navigateImage(-1);
      return;
    }
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    navigateImage(1);
  };

  const item = preview.images[index];
  if (!item) return null;
  const mediaLabel = item.type === "video" ? "video" : "image";
  const accessibilityDetails = item.source ? snapShotAccessibilityDetails(item.source) : undefined;
  const showingAccessibilityDetails =
    Boolean(accessibilityDetails) && accessibilityDetailsSrc === item.src;
  const contentsLabel = showingAccessibilityDetails
    ? "Show screenshot"
    : accessibilityDetails?.format === "json"
      ? "Show accessibility JSON"
      : "Show extracted text";
  const ContentsIcon = showingAccessibilityDetails ? ImageIcon : TextIcon;

  const isDownloadingVideo = downloadingVideoSrc === item.src;
  const videoDownloadFailed = downloadFailedVideoSrc === item.src;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="max-h-[92vh] w-[92vw] max-w-[92vw] translate-y-0 scale-100 items-center border-0 bg-transparent p-0 shadow-none [--media-width:92vw] [--media-height:min(86vh,calc(100vh-160px))] [-webkit-app-region:no-drag] sm:[--media-width:calc(92vw-96px)]"
        aria-label={`Expanded ${mediaLabel} preview`}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <DialogTitle className="sr-only">{item.name}</DialogTitle>
        {preview.images.length > 1 && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute left-0 -bottom-12 z-20 translate-y-0 rounded-full bg-white/10 text-white/90 hover:bg-white/10 hover:text-white sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
            aria-label="Previous image"
            onClick={() => navigateImage(-1)}
          >
            <ChevronLeftIcon className="size-5" />
          </Button>
        )}
        <div className="relative isolate max-h-[92vh] max-w-[var(--media-width)]">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="absolute right-0 -top-10 z-20"
            onClick={onClose}
            aria-label={`Close ${mediaLabel} preview`}
          >
            <XIcon />
          </Button>
          {item.type === "video" && failedVideoSrc === item.src ? (
            <div className="flex h-48 w-[min(var(--media-width),32rem)] flex-col items-center justify-center gap-3 rounded-(--radius) border border-border bg-black px-6 text-center text-white">
              <p className="text-sm">
                {videoDownloadFailed
                  ? "Could not download this video."
                  : "This video format cannot be played here."}
              </p>
              <Button
                size="sm"
                variant="secondary"
                aria-busy={isDownloadingVideo || undefined}
                aria-disabled={isDownloadingVideo || undefined}
                onClick={() => {
                  if (isDownloadingVideo) return;
                  void downloadVideo(item.src, item.name);
                }}
              >
                <DownloadIcon />
                {isDownloadingVideo ? "Downloading…" : "Download video"}
              </Button>
            </div>
          ) : item.type === "video" ? (
            <video
              src={item.src}
              aria-label={item.name}
              autoPlay
              controls
              playsInline
              onError={() => setFailedVideoSrc(item.src)}
              className="max-h-[var(--media-height)] max-w-[var(--media-width)] rounded-(--radius) border border-border bg-black object-contain"
            />
          ) : showingAccessibilityDetails && accessibilityDetails ? (
            <SnapShotAccessibilityData
              details={accessibilityDetails}
              className="h-[min(var(--media-height),40rem)] w-[min(var(--media-width),42rem)] animate-[snap-shot-contents-enter_140ms_ease-out] rounded-(--radius) border border-border bg-background p-4 text-xs leading-5 shadow-2xl motion-reduce:animate-none"
            />
          ) : failedImageSrc === item.src ? (
            <MissingMediaBlock
              label={item.name}
              className="size-72 rounded-(--radius) border border-border border-dashed bg-background"
            />
          ) : (
            <ZoomableImage
              ref={zoomableImageRef}
              key={`${index}:${item.src}`}
              src={item.src}
              name={item.name}
              onError={() => setFailedImageSrc(item.src)}
            />
          )}
          <div className="mt-2 flex max-w-[var(--media-width)] items-center justify-center gap-1.5 text-xs text-muted-foreground/80">
            <span className="truncate" aria-live="polite" aria-atomic="true">
              {item.name}
              {preview.images.length > 1 ? ` (${index + 1}/${preview.images.length})` : ""}
            </span>
            {accessibilityDetails && item.source ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={contentsLabel}
                      aria-pressed={showingAccessibilityDetails}
                      className="[--control-icon-color:currentColor] hover:bg-white/10 hover:text-white"
                      onClick={() =>
                        setAccessibilityDetailsSrc(showingAccessibilityDetails ? null : item.src)
                      }
                      size="icon-xs"
                      variant="ghost"
                    />
                  }
                >
                  <ContentsIcon className="size-3" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipPopup side="top">{contentsLabel}</TooltipPopup>
              </Tooltip>
            ) : item.source ? (
              <SnapShotContentsButton
                source={item.source}
                side="top"
                className="hover:bg-white/10 hover:text-white"
              />
            ) : null}
          </div>
        </div>
        {preview.images.length > 1 && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-0 -bottom-12 z-20 translate-y-0 rounded-full bg-white/10 text-white/90 hover:bg-white/10 hover:text-white sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
            aria-label="Next image"
            onClick={() => navigateImage(1)}
          >
            <ChevronRightIcon className="size-5" />
          </Button>
        )}
      </DialogPopup>
    </Dialog>
  );
});

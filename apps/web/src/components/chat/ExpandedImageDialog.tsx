import { memo, useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { downloadVideoPreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import { FallbackImage, MissingMediaBlock } from "../MissingMedia";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
}

export const ExpandedImageDialog = memo(function ExpandedImageDialog({
  preview,
  onClose,
}: ExpandedImageDialogProps) {
  const [imageOffset, setImageOffset] = useState(0);
  const [failedVideoSrc, setFailedVideoSrc] = useState<string | null>(null);
  const [downloadingVideoSrc, setDownloadingVideoSrc] = useState<string | null>(null);
  const [downloadFailedVideoSrc, setDownloadFailedVideoSrc] = useState<string | null>(null);
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

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateImage, preview.images.length]);

  const item = preview.images[index];
  if (!item) return null;
  const mediaLabel = item.type === "video" ? "video" : "image";

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
        className="max-h-[92vh] max-w-[92vw] translate-y-0 scale-100 border-0 bg-transparent p-0 shadow-none [-webkit-app-region:no-drag]"
        aria-label={`Expanded ${mediaLabel} preview`}
      >
        <DialogTitle className="sr-only">{item.name}</DialogTitle>
        {preview.images.length > 1 && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute left-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:left-6"
            aria-label="Previous image"
            onClick={() => navigateImage(-1)}
          >
            <ChevronLeftIcon className="size-5" />
          </Button>
        )}
        <div className="relative isolate">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="absolute right-2 top-2 z-20"
            onClick={onClose}
            aria-label={`Close ${mediaLabel} preview`}
          >
            <XIcon />
          </Button>
          {item.type === "video" && failedVideoSrc === item.src ? (
            <div className="flex h-48 w-[min(92vw,32rem)] flex-col items-center justify-center gap-3 rounded-(--radius) border border-border bg-black px-6 text-center text-white">
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
              className="max-h-[86vh] max-w-[92vw] rounded-(--radius) border border-border bg-black object-contain"
            />
          ) : (
            <FallbackImage
              src={item.src}
              alt={item.name}
              className="max-h-[86vh] max-w-[92vw] select-none rounded-(--radius) border border-border bg-background object-contain"
              draggable={false}
              fallback={
                <MissingMediaBlock
                  label={item.name}
                  className="size-72 rounded-(--radius) border border-border border-dashed bg-background"
                />
              }
            />
          )}
          <p className="mt-2 max-w-[92vw] truncate text-center text-xs text-muted-foreground/80">
            {item.name}
            {preview.images.length > 1 ? ` (${index + 1}/${preview.images.length})` : ""}
          </p>
        </div>
        {preview.images.length > 1 && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-2 top-1/2 z-20 -translate-y-1/2 text-white/90 hover:bg-white/10 hover:text-white sm:right-6"
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

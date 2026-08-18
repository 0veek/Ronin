import { memo, useCallback, useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";
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
  const count = preview.images.length;
  // imageOffset is unbounded, so normalize any integer offset back into range.
  const index = count > 0 ? (((preview.index + imageOffset) % count) + count) % count : 0;

  const navigateImage = useCallback((direction: -1 | 1) => {
    setImageOffset((current) => current + direction);
  }, []);

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
        aria-label="Expanded image preview"
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
            aria-label="Close image preview"
          >
            <XIcon />
          </Button>
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

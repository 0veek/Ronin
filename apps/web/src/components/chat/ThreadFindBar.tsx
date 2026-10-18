import { useEffect, useRef, type KeyboardEvent } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "~/lib/utils";
import { formatThreadFindCount } from "./threadFind";

interface ThreadFindBarProps {
  readonly open: boolean;
  readonly query: string;
  readonly matchCount: number;
  readonly counting?: boolean;
  readonly status: "loading" | "error" | null;
  readonly onRetry: () => void;
  readonly activeIndex: number;
  readonly focusRequestId: number;
  readonly onQueryChange: (query: string) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onClose: () => void;
}

/**
 * Room the open bar takes at the top of the chat canvas: its `h-9` height plus
 * the shared 12px gap below it, so the details card starts on the same rhythm.
 */
export const THREAD_FIND_BAR_RESERVED_HEIGHT = 48;

export function ThreadFindBar(props: ThreadFindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!props.open || props.focusRequestId === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [props.focusRequestId, props.open]);

  if (!props.open) return null;

  const hasQuery = props.query.trim().length > 0;
  const noResults = hasQuery && !props.status && props.matchCount === 0;
  let label = "";
  if (hasQuery) {
    label = props.counting ? "1/…" : formatThreadFindCount(props.activeIndex, props.matchCount);
  }
  if (props.status === "loading") label = "Searching…";
  if (props.status === "error") label = "Search failed";
  const navigationDisabled =
    props.matchCount === 0 || props.status === "loading" || props.counting === true;
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) props.onPrevious();
      else props.onNext();
    }
  };

  return (
    <search
      onContextMenu={(event) => event.stopPropagation()}
      aria-label="Find in thread"
      aria-busy={props.status === "loading" || props.counting === true}
      className="absolute top-3 right-3 z-40 flex h-9 w-[min(24rem,calc(100%-1.5rem))] items-center gap-1 rounded-lg border bg-popover px-1 shadow-md"
    >
      <Input
        ref={inputRef}
        type="search"
        className="min-w-0 flex-1 border-0 bg-transparent shadow-none"
        value={props.query}
        aria-label="Find in thread"
        placeholder="Find in thread"
        maxLength={200}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => props.onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="flex shrink-0 items-center gap-0.5">
        <span
          aria-live="polite"
          className={cn(
            "min-w-10 text-center text-xs tabular-nums",
            noResults ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {props.status === "error" ? (
          <Button size="xs" variant="ghost" onClick={props.onRetry}>
            Retry
          </Button>
        ) : null}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Previous match"
          disabled={navigationDisabled}
          onClick={props.onPrevious}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Next match"
          disabled={navigationDisabled}
          onClick={props.onNext}
        >
          <ChevronDownIcon />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Close find" onClick={props.onClose}>
          <XIcon />
        </Button>
      </div>
    </search>
  );
}

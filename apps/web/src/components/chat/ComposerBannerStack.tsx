import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

const DISMISS_TRANSITION_MS = 220;
const frontExitStyle = {
  opacity: 0,
  transform: "translate3d(0, 4rem, 0)",
} satisfies CSSProperties;
const stackedExitStyle = {
  opacity: 0,
  transform: "translate3d(0, 7rem, 0)",
} satisfies CSSProperties;
const restingStyle = {
  opacity: 1,
  transform: "none",
} satisfies CSSProperties;
const exitTransitionStyle = {
  transition: `transform ${DISMISS_TRANSITION_MS}ms ease-in, opacity ${DISMISS_TRANSITION_MS}ms ease-in`,
} satisfies CSSProperties;

// The collapsed peek above the front banner is the only hint that more banners
// are stacked behind it, so its border must match the severity of the first
// hidden banner — a neutral banner must not masquerade as a warning.
const stackCapBorderClass: Record<ComposerBannerStackItem["variant"], string> = {
  default: "border-border",
  error: "border-destructive/24",
  info: "border-info/24",
  success: "border-success/24",
  warning: "border-warning/24",
};

export interface ComposerBannerStackItem {
  readonly id: string;
  readonly variant: "default" | "error" | "info" | "success" | "warning";
  // Ordering hint for stack assemblers: front this banner even though its
  // variant is calm (e.g. live update progress). The stack itself ignores it.
  readonly urgent?: boolean;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly actionClassName?: string;
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
}

interface ComposerBannerStackProps {
  readonly className?: string;
  readonly items: ReadonlyArray<ComposerBannerStackItem>;
}

export function ComposerBannerStack({ className, items }: ComposerBannerStackProps) {
  const [stackExpanded, setStackExpanded] = useState(false);
  const noticesRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLButtonElement>(null);
  const expandedItemsRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<"peek" | "notice" | null>(null);
  const expandedItemsId = useId();
  const [requestedExitingItemId, setExitingItemId] = useState<string | null>(null);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitingItemId =
    requestedExitingItemId !== null && items.some((item) => item.id === requestedExitingItemId)
      ? requestedExitingItemId
      : null;

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (items.length < 2) setStackExpanded(false);
  }, [items.length]);

  useLayoutEffect(() => {
    if (stackExpanded && pendingFocusRef.current === "notice") {
      pendingFocusRef.current = null;
      const firstControl = expandedItemsRef.current?.querySelector<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
      );
      (firstControl ?? expandedItemsRef.current)?.focus({ preventScroll: true });
    } else if (!stackExpanded && pendingFocusRef.current === "peek") {
      pendingFocusRef.current = null;
      peekRef.current?.focus({ preventScroll: true });
    }
  }, [stackExpanded]);

  if (items.length === 0) {
    return null;
  }

  const frontItem = items[0];
  if (!frontItem) {
    return null;
  }
  const stackedItems = items.slice(1);
  const hasStack = stackedItems.length > 0;
  const showCollapsedStackCap = hasStack && exitingItemId !== frontItem.id;
  const firstStackedItem = stackedItems[0];

  const requestDismiss = (item: ComposerBannerStackItem) => {
    if (!item.onDismiss || exitingItemId) {
      return;
    }
    setExitingItemId(item.id);
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
    }
    dismissTimeoutRef.current = setTimeout(() => {
      dismissTimeoutRef.current = null;
      item.onDismiss?.();
    }, DISMISS_TRANSITION_MS);
  };

  return (
    <div
      className={cn(
        "group/banner-stack mx-auto mb-2 max-w-[var(--app-chat-max-width,48rem)]",
        className,
      )}
    >
      <div className={cn("relative flex flex-col-reverse", hasStack && stackExpanded && "z-50")}>
        <div
          className={cn(
            "relative z-10",
            exitingItemId === frontItem.id ? "pointer-events-none" : null,
          )}
          style={{
            ...exitTransitionStyle,
            ...(exitingItemId === frontItem.id ? frontExitStyle : restingStyle),
          }}
          onPointerDownCapture={() => {
            setStackExpanded(false);
            const activeElement = document.activeElement;
            if (
              activeElement instanceof HTMLElement &&
              noticesRef.current?.contains(activeElement)
            ) {
              activeElement.blur();
            }
          }}
        >
          <ComposerBannerStackAlert
            item={frontItem}
            exiting={exitingItemId === frontItem.id}
            onDismissRequest={() => requestDismiss(frontItem)}
          />
        </div>
        {hasStack ? (
          <div
            ref={noticesRef}
            className={cn("relative z-20", stackExpanded && "min-h-3")}
            onPointerEnter={(event) => {
              if (event.pointerType === "touch") return;
              if (document.activeElement === peekRef.current) {
                pendingFocusRef.current = "notice";
              }
              setStackExpanded(true);
            }}
            onPointerLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) setStackExpanded(false);
            }}
            onBlurCapture={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !event.currentTarget.matches(":hover")
              ) {
                setStackExpanded(false);
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || !stackExpanded) return;
              event.preventDefault();
              event.stopPropagation();
              pendingFocusRef.current = "peek";
              setStackExpanded(false);
            }}
          >
            {showCollapsedStackCap && firstStackedItem ? (
              <button
                ref={peekRef}
                type="button"
                aria-label="Show other notices"
                aria-expanded={stackExpanded}
                aria-controls={expandedItemsId}
                aria-hidden={stackExpanded || undefined}
                tabIndex={stackExpanded ? -1 : 0}
                onClick={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  pendingFocusRef.current = "notice";
                  setStackExpanded(true);
                }}
                className={cn(
                  "absolute inset-x-0 bottom-0 z-0 mx-auto h-3 w-[96%] cursor-pointer rounded-t-[22px]",
                  "border border-b-0 bg-background/96 shadow-[var(--shadow-raised)]",
                  stackCapBorderClass[firstStackedItem.variant],
                  "transition-opacity duration-(--duration-fast) ease-out",
                  "focus-visible:outline-2 focus-visible:outline-ring",
                  stackExpanded && "pointer-events-none invisible opacity-0",
                )}
              />
            ) : null}
            <div
              id={expandedItemsId}
              ref={expandedItemsRef}
              role="group"
              aria-label="Other notices"
              tabIndex={-1}
              data-composer-banner-stack-expanded-items="true"
              className={cn(
                "grid transition-[grid-template-rows] duration-(--duration-fast) ease-out",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                stackExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  className={cn(
                    "transform-gpu space-y-2 pb-2 transition-[opacity,transform] duration-(--duration-fast) ease-out will-change-[opacity,transform]",
                    stackExpanded
                      ? "pointer-events-auto visible translate-y-0 opacity-100"
                      : "invisible pointer-events-none translate-y-1 opacity-0",
                  )}
                >
                  {stackedItems.map((item) => (
                    <div
                      key={item.id}
                      className={cn(exitingItemId === item.id ? "pointer-events-none" : null)}
                      style={{
                        ...exitTransitionStyle,
                        ...(exitingItemId === item.id ? stackedExitStyle : restingStyle),
                      }}
                    >
                      <ComposerBannerStackAlert
                        item={item}
                        exiting={exitingItemId === item.id}
                        onDismissRequest={() => requestDismiss(item)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ComposerBannerStackAlert({
  item,
  exiting,
  onDismissRequest,
}: {
  readonly item: ComposerBannerStackItem;
  readonly exiting: boolean;
  readonly onDismissRequest: () => void;
}) {
  const dismissOnly = item.onDismiss && !item.actions;

  return (
    <Alert
      variant={item.variant}
      className={cn(
        "surface-alert rounded-[var(--radius-lg)] border border-border",
        item.className,
      )}
      data-variant={item.variant}
    >
      {item.icon}
      <AlertTitle>{item.title}</AlertTitle>
      {item.description ? <AlertDescription>{item.description}</AlertDescription> : null}
      {item.actions || item.onDismiss ? (
        <AlertAction
          className={cn(
            item.actionClassName,
            dismissOnly
              ? "max-sm:col-start-3 max-sm:row-start-1 max-sm:mt-0 max-sm:self-start"
              : undefined,
          )}
        >
          {item.actions}
          {item.onDismiss ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={item.dismissLabel ?? "Dismiss warning"}
              disabled={exiting}
              onClick={onDismissRequest}
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}

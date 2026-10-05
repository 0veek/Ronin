import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";

const TooltipCreateHandle = TooltipPrimitive.createHandle;

const TooltipProvider = TooltipPrimitive.Provider;

type TooltipActionsRef = RefObject<TooltipPrimitive.Root.Actions | null>;
const TooltipHoverContext = createContext<TooltipActionsRef | null>(null);
const TooltipScrollContext = createContext<{
  track: (trigger: HTMLElement, actionsRef: TooltipActionsRef) => void;
  clear: (actionsRef: TooltipActionsRef) => void;
} | null>(null);

/** Dismisses hovered descendants on real scroll events without rerendering the timeline. */
function TooltipScrollDismissArea({ onScrollCapture, ...props }: ComponentProps<"div">) {
  const hovered = useRef<{ trigger: HTMLElement; actionsRef: TooltipActionsRef } | null>(null);
  const controls = useMemo(
    () => ({
      track: (trigger: HTMLElement, actionsRef: TooltipActionsRef) => {
        hovered.current = { trigger, actionsRef };
      },
      clear: (actionsRef: TooltipActionsRef) => {
        if (hovered.current?.actionsRef === actionsRef) hovered.current = null;
      },
    }),
    [],
  );
  return (
    <TooltipScrollContext value={controls}>
      <div
        {...props}
        onScrollCapture={(event) => {
          onScrollCapture?.(event);
          const tooltip = hovered.current;
          if (!tooltip || tooltip.trigger.contains(tooltip.trigger.ownerDocument.activeElement)) {
            return;
          }
          hovered.current = null;
          // Base UI also cancels delayed hover opens through this action.
          tooltip.actionsRef.current?.close();
        }}
      />
    </TooltipScrollContext>
  );
}

function Tooltip<Payload>(props: TooltipPrimitive.Root.Props<Payload>) {
  const hovered = use(TooltipScrollContext);
  const localActionsRef = useRef<TooltipPrimitive.Root.Actions | null>(null);
  const actionsRef = props.actionsRef ?? localActionsRef;
  useEffect(
    () => () => {
      hovered?.clear(actionsRef);
    },
    [actionsRef, hovered],
  );

  if (!hovered) return <TooltipPrimitive.Root {...props} />;
  return (
    <TooltipHoverContext value={actionsRef}>
      <TooltipPrimitive.Root
        {...props}
        actionsRef={actionsRef}
        onOpenChange={(open, details) => {
          props.onOpenChange?.(open, details);
          if (!open && !details.isCanceled) hovered.clear(actionsRef);
        }}
      />
    </TooltipHoverContext>
  );
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  const hovered = use(TooltipScrollContext);
  const actionsRef = use(TooltipHoverContext);
  if (!hovered || !actionsRef) {
    return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
  }
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      onMouseEnter={(event) => {
        props.onMouseEnter?.(event);
        hovered.track(event.currentTarget, actionsRef);
      }}
    />
  );
}

function TooltipPopup({
  className,
  align = "center",
  sideOffset = 4,
  side = "top",
  anchor,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & {
  align?: TooltipPrimitive.Positioner.Props["align"];
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
  anchor?: TooltipPrimitive.Positioner.Props["anchor"];
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        anchor={anchor}
        className="pointer-events-none z-[140] h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            // `surface-menu` carries the fill, the hairline and the one
            // popover shadow, so nothing here paints a surface of its own.
            "surface-menu relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) text-balance rounded-(--radius) text-popover-foreground text-xs transition-[width,height,scale,opacity] duration-(--duration-fast) ease-out data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0",
            className,
          )}
          data-slot="tooltip-popup"
          {...props}
        >
          <TooltipPrimitive.Viewport
            className="relative size-full overflow-clip px-(--viewport-inline-padding) py-1 [--viewport-inline-padding:--spacing(2)] data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:truncate **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity"
            data-slot="tooltip-viewport"
          >
            {children}
          </TooltipPrimitive.Viewport>
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export {
  TooltipCreateHandle,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
  TooltipScrollDismissArea,
};

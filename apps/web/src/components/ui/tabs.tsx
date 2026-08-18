"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

/**
 * Tab bars. Two variants, because macOS uses two and they are not
 * interchangeable:
 *
 * - `underline` marks the active view inside a surface the user is already
 *   looking at — panel headers, detail views. It is the recipe the right panel
 *   and the PR detail header had each grown their own copy of.
 * - `segment` is the segmented control: a small closed set of peer modes shown
 *   in a track, where the choice itself is the point (list density, diff mode).
 *
 * Both drive the indicator off Base UI's `TabsIndicator`, which measures the
 * active tab and exposes its geometry as custom properties, so the marker
 * slides between tabs rather than cross-fading in place.
 */

const tabsListVariants = cva("relative isolate flex items-center", {
  variants: {
    variant: {
      underline: "gap-1 border-border border-b",
      segment: "gap-0.5 rounded-[var(--control-radius)] bg-secondary p-0.5",
    },
  },
  defaultVariants: { variant: "underline" },
});

const tabsTriggerVariants = cva(
  "relative z-10 inline-flex cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap font-medium outline-none transition-colors duration-(--duration-fast) ease-out focus-visible:ring-[3px] focus-visible:ring-ring/40 data-disabled:pointer-events-none data-disabled:opacity-64 [&>svg]:pointer-events-none [&>svg]:shrink-0 [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        underline:
          "-mb-px rounded-t-[var(--control-radius)] px-2.5 py-1.5 text-muted-foreground text-sm hover:text-foreground data-selected:text-foreground",
        segment:
          "rounded-[calc(var(--control-radius)-1px)] px-2.5 py-1 text-muted-foreground text-sm hover:text-foreground data-selected:text-foreground",
      },
    },
    defaultVariants: { variant: "underline" },
  },
);

const tabsIndicatorVariants = cva(
  // Both indicators read the active tab's measured box from Base UI. Only
  // transform and opacity animate, so the slide stays on the compositor.
  "absolute left-0 top-0 z-0 translate-x-[var(--active-tab-left)] transition-[translate,width,opacity] duration-(--duration-base) ease-(--ease-spring) data-[activation-direction=none]:duration-0",
  {
    variants: {
      variant: {
        underline: "bottom-0 h-px w-[var(--active-tab-width)] translate-y-0 bg-foreground",
        segment:
          "h-[var(--active-tab-height)] w-[var(--active-tab-width)] translate-y-[var(--active-tab-top)] rounded-[calc(var(--control-radius)-1px)] bg-card shadow-[var(--shadow-raised)]",
      },
    },
    defaultVariants: { variant: "underline" },
  },
);

type TabsVariant = NonNullable<VariantProps<typeof tabsListVariants>["variant"]>;

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      className={cn("flex min-h-0 flex-col", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

function TabsList({
  className,
  variant = "underline",
  children,
  ...props
}: TabsPrimitive.List.Props & { variant?: TabsVariant }) {
  return (
    <TabsPrimitive.List
      className={cn(tabsListVariants({ variant }), className)}
      data-slot="tabs-list"
      data-variant={variant}
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        className={tabsIndicatorVariants({ variant })}
        data-slot="tabs-indicator"
        renderBeforeHydration
      />
    </TabsPrimitive.List>
  );
}

function TabsTrigger({
  className,
  variant = "underline",
  ...props
}: TabsPrimitive.Tab.Props & { variant?: TabsVariant }) {
  return (
    <TabsPrimitive.Tab
      className={cn(tabsTriggerVariants({ variant }), className)}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      className={cn("min-h-0 flex-1 outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, tabsListVariants, TabsTrigger, tabsTriggerVariants };
export type { TabsVariant };

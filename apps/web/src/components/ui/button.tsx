"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A button is a fill and a hairline, and nothing else.
 *
 * The previous base stacked a `before:` pseudo-element carrying a 1px inner
 * highlight, a per-variant `inset-shadow`, and a drop shadow, to fake the
 * beveled plastic of a native control. Flat chrome does not need any of it:
 * state reads from the fill, so the only thing that transitions is color.
 *
 * The `pointer-coarse:after:` block is not decoration -- it grows the touch
 * target of the compact sizes to 44px without changing their painted size.
 *
 * `focus-ring` is the shared treatment from `styles/chrome.css`; it is this
 * button's former recipe, lifted out so the other controls cannot drift.
 */
const buttonVariants = cva(
  "[--control-icon-color:currentColor] [&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] border font-medium text-base transition-colors duration-(--duration-fast) ease-out pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-ring disabled:pointer-events-none disabled:opacity-64 sm:text-sm [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
        icon: "size-9 sm:size-8",
        "icon-lg": "size-10 sm:size-9",
        "icon-sm": "size-8 sm:size-7",
        "icon-xl":
          "size-11 sm:size-10 [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        "icon-xs":
          "size-7 sm:size-6 not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-4 sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 px-[calc(--spacing(3.5)-1px)] sm:h-9",
        sm: "h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7",
        xl: "h-11 px-[calc(--spacing(4)-1px)] text-lg sm:h-10 sm:text-base [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        xs: "h-7 gap-1 px-[calc(--spacing(2)-1px)] text-sm sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground [:hover,[data-pressed]]:bg-primary/88",
        destructive:
          "border-destructive bg-destructive text-white [:hover,[data-pressed]]:bg-destructive/88",
        // Outline variants carry no fill at rest: the hairline is the button.
        // A tinted rest fill would put a second surface tier back on screen,
        // which is the thing flat chrome is trying not to have.
        "destructive-outline":
          "border-input bg-transparent text-destructive-foreground [:hover,[data-pressed]]:border-destructive/40 [:hover,[data-pressed]]:bg-destructive/8",
        ghost:
          "[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent",
        link: "border-transparent underline-offset-4 [:hover,[data-pressed]]:underline",
        outline:
          "[--control-icon-color:var(--contrast-muted-foreground)] border-input bg-transparent text-foreground [:hover,[data-pressed]]:bg-accent",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [:hover,[data-pressed]]:bg-secondary/80",
      },
    },
  },
);

interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    "data-slot": "button",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export { Button, buttonVariants };

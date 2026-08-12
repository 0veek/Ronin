import type { LucideIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export interface ComposerSlashTargetOption<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export function ComposerSlashTargetPicker<T extends string>(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  options: ReadonlyArray<ComposerSlashTargetOption<T>>;
  onSelect: (id: T) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-2">
          {props.options.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                className={cn(
                  "flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-muted/15 px-4 py-3 text-left transition-colors",
                  "hover:border-border hover:bg-accent/70",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                )}
                onClick={() => {
                  props.onSelect(option.id);
                  props.onOpenChange(false);
                }}
              >
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{option.label}</span>
                  <span className="mt-0.5 block text-[12px] leading-4 text-secondary-label">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

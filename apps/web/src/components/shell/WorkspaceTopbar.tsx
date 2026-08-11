import type { ComponentProps } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

/**
 * The single strip of chrome across the top of every workspace surface: chat,
 * settings, project settings, usage.
 *
 * Four things vary and all of them are handled here rather than at the call
 * sites, which previously each rendered their own near-identical <header> twice
 * (once for Electron, once for the browser):
 *
 *  - **Height.** `--workspace-topbar-height`, which under `.wco` becomes the
 *    real `env(titlebar-area-height)` the OS reports. It is mirrored by
 *    TITLEBAR_HEIGHT in apps/desktop; the two must move together.
 *  - **Drag region.** Only in Electron, where this strip *is* the title bar.
 *  - **Window-control reservation.** On Windows/Linux the native minimise /
 *    maximise / close cluster overlays the right end of the strip.
 *  - **Sidebar-collapse inset.** With the sidebar closed the toggle button
 *    floats over the strip's left end, so the content slides clear of it.
 *
 * Structurally it is one hairline and nothing else — no fill tier, no shadow.
 */
export function WorkspaceTopbar({
  className,
  reserveNativeControls = isElectron,
  ...props
}: ComponentProps<"header"> & {
  /**
   * Reserve the right end for the OS window controls. Panels that own the
   * title bar themselves already account for them and pass `false`.
   */
  readonly reserveNativeControls?: boolean;
}) {
  return (
    <header
      data-workspace-topbar=""
      className={cn(
        "workspace-topbar border-b border-border bg-background",
        "transition-[padding-left] duration-(--duration-base) ease-out motion-reduce:transition-none",
        isElectron
          ? "drag-region px-3 sm:px-5"
          : "pl-[calc(env(safe-area-inset-left)+var(--space-3))] pr-[calc(env(safe-area-inset-right)+var(--space-3))] sm:pl-[calc(env(safe-area-inset-left)+var(--space-5))] sm:pr-[calc(env(safe-area-inset-right)+var(--space-5))]",
        reserveNativeControls && "wco:pr-[var(--workspace-native-controls-inset)]",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        className,
      )}
      {...props}
    />
  );
}

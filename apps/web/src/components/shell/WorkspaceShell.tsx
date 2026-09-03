import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { openCommandPalette } from "~/commandPaletteBus";
import { isElectron } from "~/env";
import { runKeybindingCommand } from "~/keybindingCommandBus";
import { getLocalStorageItem } from "~/hooks/useLocalStorage";
import { resolveShortcutCommand, shortcutLabelForCommand } from "~/keybindings";
import { cn, isMacPlatform } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useEnvironmentIdentificationMode } from "~/hooks/useSettings";
import { usePanelAnimationSettings } from "~/panelAnimations";
import ThreadSidebar from "../Sidebar";

// The settings nav only renders on settings routes; lazy-loading it keeps that
// subtree out of the startup chunk.
const SettingsSidebarNav = lazy(() =>
  import("../settings/SettingsSidebarNav").then((module) => ({
    default: module.SettingsSidebarNav,
  })),
);

import { SidebarChromeHeader } from "../sidebar/SidebarChrome";
import {
  resolveSidebarStageFocusRingOffsetClass,
  useSidebarStageBackdropVariant,
} from "../SidebarStageBackdrop";
import { useProjects } from "~/state/entities";
import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarMaximumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "../threadSidebarWidth";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The outermost frame of the workspace: the resizable left sidebar, the floating
 * sidebar toggle that sits in the topbar's left gutter, and whatever route
 * content is passed in.
 *
 * Layout stays with the `ui/sidebar` primitive kit (a fixed container plus an
 * inline gap element) rather than moving to a grid. The kit already owns the
 * offcanvas slide, the drag-to-resize rail, and the mobile sheet swap, and it is
 * covered by sidebar.test.tsx; a grid would have to re-implement all three to
 * arrive at the same pixels.
 */

// Clears the macOS traffic lights. Only applies when the window is not
// fullscreen -- fullscreen hides them and the gutter would read as a dent.
//
// The main process derives this from the same constants that position the
// buttons, so the gutter cannot drift from the cluster it is clearing. The
// fallback only matters if the bridge predates that getter.
const MACOS_TRAFFIC_LIGHTS_LEFT_INSET_FALLBACK = 90;

function resolveMacosTrafficLightInset(): string {
  const getTitlebarContentInset = window.desktopBridge?.getTitlebarContentInset;
  const inset = typeof getTitlebarContentInset === "function" ? getTitlebarContentInset() : null;
  return `${inset ?? MACOS_TRAFFIC_LIGHTS_LEFT_INSET_FALLBACK}px`;
}

function subscribeToViewportWidth(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
      window.innerWidth,
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null, window.innerWidth);
  }
}

function SidebarControl() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { toggleSidebar } = useSidebar();
  const isSidebarVisible = useSidebarVisibility();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (resolveShortcutCommand(event, keybindings) !== "sidebar.toggle") return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    // Capture before focused editors consume commands such as Mod+B for rich-text formatting.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, toggleSidebar]);

  return (
    // The right-side layout controls carry mr-px (border compensation inside
    // the panel), so the trigger mirrors it: both clusters sit one extra pixel
    // off their edge and the titlebar reads symmetric.
    <div
      className="pointer-events-none fixed left-[var(--workspace-controls-left)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center"
      data-sidebar-control=""
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              className={cn(
                "pointer-events-auto",
                isSidebarVisible &&
                  stageBackdropVariant &&
                  "focus-visible:ring-white/90 [&_svg]:stroke-white/90! [&_svg]:opacity-100! [&_svg]:hover:stroke-white! [:hover,[data-pressed]]:bg-white/15",
                isSidebarVisible &&
                  stageBackdropVariant &&
                  resolveSidebarStageFocusRingOffsetClass(stageBackdropVariant),
              )}
              aria-label="Toggle main sidebar"
            />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

// Settings swaps the thread sidebar out of the tree. Keep the lightweight
// project projection subscribed so returning to a draft never renders the
// zero-project state while the environment snapshot reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  // Settings routes show the settings nav in place of whichever thread
  // sidebar is active.
  const pathname = useLocation({ select: (location) => location.pathname });
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  // Subscribed rather than read once: the clamp must track live window size,
  // and a clamped drag ends with an unchanged width, which skips the re-render
  // that would otherwise refresh a render-time snapshot.
  const viewportWidth = useSyncExternalStore(subscribeToViewportWidth, readViewportWidth);
  const sidebarMaximumWidth = resolveThreadSidebarMaximumWidth(viewportWidth);
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  const sidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
    ...(isMacosDesktop && !isWindowFullscreen
      ? { "--workspace-controls-left": resolveMacosTrafficLightInset() }
      : {}),
  } as CSSProperties;

  useEffect(() => {
    if (!isMacosDesktop) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
    if (
      typeof getWindowFullscreenState !== "function" ||
      typeof onWindowFullscreenStateChange !== "function"
    ) {
      return;
    }

    const unsubscribe = onWindowFullscreenStateChange(setIsWindowFullscreen);
    setIsWindowFullscreen(getWindowFullscreenState());
    return unsubscribe;
  }, [isMacosDesktop]);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    /*
      Menu items are a third way into destinations the palette and the
      keybindings already reach, so they route through the same buses rather
      than re-implementing navigation. A menu item that drifts from its palette
      entry is the bug this avoids.
    */
    const unsubscribe = onMenuAction((action) => {
      switch (action) {
        case "open-settings": {
          const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
          if (!isSettingsRoute) {
            void navigate({ to: "/settings" });
          }
          return;
        }
        case "new-thread":
          openCommandPalette({ open: "new-thread-in" });
          return;
        case "open-command-palette":
          openCommandPalette();
          return;
        case "open-keyboard-shortcuts":
          runKeybindingCommand("shortcuts.toggle");
          return;
        case "go-threads":
          void navigate({ to: "/" });
          return;
        case "go-board":
          void navigate({ to: "/board" });
          return;
        case "go-pull-requests":
          // Same landing filters the sidebar's own entry point uses, so the two
          // routes into this page open the same list.
          void navigate({ to: "/pull-requests", search: { involvement: "all", state: "open" } });
          return;
        case "go-usage":
          void navigate({ to: "/usage" });
          return;
        default:
          return;
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  return (
    <SidebarProvider
      className="h-dvh! min-h-0!"
      data-panel-animations={panelAnimationsActive ? "true" : "false"}
      defaultOpen
      style={sidebarProviderStyle}
    >
      <ProjectProjectionRetention />
      <Sidebar
        side="left"
        collapsible="offcanvas"
        data-app-sidebar=""
        className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        resizable={{
          maxWidth: sidebarMaximumWidth,
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
            nextWidth <= currentWidth ||
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
          onResize: setSidebarWidth,
        }}
      >
        {isOnSettings ? (
          <>
            <SidebarChromeHeader isElectron={isElectron} />
            <Suspense fallback={null}>
              <SettingsSidebarNav pathname={pathname} />
            </Suspense>
          </>
        ) : (
          <ThreadSidebar />
        )}
        <SidebarRail />
      </Sidebar>
      {children}
      <SidebarControl />
    </SidebarProvider>
  );
}

import { ChartNoAxesColumnIcon, GitPullRequestIcon, SettingsIcon } from "lucide-react";
import { memo, useCallback } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { usePrimaryEnvironment } from "../../state/environments";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUsageMeter } from "./SidebarUsageMeter";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <SidebarHeader
      className={cn(
        // Three columns rather than a row, so the masthead sits on the
        // sidebar's centre line instead of trailing the toggle. The toggle
        // itself is position:fixed and lives outside this element, so the side
        // columns floor at the width it occupies: on a platform where that
        // floor never binds the masthead is exactly centred, and on macOS --
        // where the traffic lights push the toggle to 90px -- the left column
        // wins and the masthead slides clear rather than under it.
        //
        // The 0px fallback is for the mobile sidebar: it renders through a
        // portalled Sheet, outside the wrapper that defines the token, and an
        // unresolved var would invalidate the whole track list and collapse
        // the header into a single stacked column.
        "@container/sidebar-header relative grid h-[var(--workspace-topbar-height)] shrink-0 grid-cols-[minmax(var(--workspace-titlebar-content-left,0px),1fr)_auto_minmax(var(--workspace-titlebar-content-left,0px),1fr)] items-center border-b border-sidebar-border px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <SidebarTrigger
        className={cn(
          "relative z-10 md:hidden",
          backdropVariant &&
            "[:hover,[data-pressed]]:bg-white/15 focus-visible:ring-white/90 focus-visible:ring-offset-blue-700 [&_svg]:stroke-white/90! [&_svg]:opacity-100! [&_svg]:hover:stroke-white!",
        )}
      />
      {/* Explicit column: the trigger above is md:hidden, and a display:none
          grid item is skipped by auto-placement, which would otherwise drag
          the masthead into the first column on desktop. */}
      <div className="col-start-2 flex min-w-0 items-center gap-1">
        <SidebarBrand onBackdrop={backdropVariant !== null} />
        {pillLabel ? (
          <Badge
            className="relative z-10 rounded-full px-1.5 text-muted-foreground"
            data-environment-identification="pill"
            size="sm"
            variant="secondary"
          >
            {pillLabel}
          </Badge>
        ) : null}
      </div>
    </SidebarHeader>
  );
});

function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <Link
      aria-label="Go to threads"
      className={cn(
        // No left margin any more: the header grid places it, not this.
        "sidebar-brand relative z-10 h-7 w-fit min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-(--control-radius) outline-hidden ring-ring focus-visible:ring-2",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      to="/"
    >
      <RoninAppIcon />
      {/* Set as a masthead rather than a UI label: mono small-caps at the same
          weight as every other structural label in the shell. */}
      <span className={cn("label-meta truncate", onBackdrop ? "text-white/80" : "text-foreground")}>
        Ronin
      </span>
    </Link>
  );
}

/**
 * The generated app icon rather than a tinted mark, so the sidebar badge is the
 * same artwork as the dock and the browser tab. The build copies the icons for
 * the active channel into the web root, so this one file is the blue dev icon,
 * the night-sky nightly icon, or the black release icon without any branching
 * here. Corners are already rounded in the export.
 *
 * Decorative: the adjacent "Ronin" text already names the link.
 */
function RoninAppIcon() {
  return <img alt="" className="size-5 shrink-0" src="/apple-touch-icon.png" />;
}

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const primaryEnvironment = usePrimaryEnvironment();
  const pullRequestsSupported =
    primaryEnvironment?.serverConfig?.environment.capabilities.pullRequests === true;
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
  const handlePullRequestsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/pull-requests", search: { involvement: "all", state: "open" } });
  }, [closeMobileSidebar, navigate]);
  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  }, [closeMobileSidebar, navigate]);

  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    // The footer owns no padding of its own: the meter is a full-bleed region
    // divided off by a hairline, so it has to reach both edges while the nav
    // below keeps the standard content inset.
    <SidebarFooter className="gap-0 p-0">
      <div className="flex flex-col gap-2 p-[var(--sidebar-content-inset)]">
        <SidebarProviderUpdatePill />
        <SidebarUpdatePill />
        <SidebarMenu>
          {pullRequestsSupported ? (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handlePullRequestsClick}>
                <GitPullRequestIcon />
                <span>Pull Requests</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleUsageClick}>
              <ChartNoAxesColumnIcon />
              <span>Stats</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSettingsClick}>
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
      {/* Last thing in the sidebar. It is a readout rather than a control, so
          it sits below the navigation and its top hairline closes the column
          off, instead of splitting the footer in two above the links. */}
      <SidebarUsageMeter />
    </SidebarFooter>
  );
});

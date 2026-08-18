import { RotateCcwIcon } from "lucide-react";
import {
  Outlet,
  createFileRoute,
  redirect,
  useCanGoBack,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { useSettingsRestore } from "../components/settings/SettingsPanels";
import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { WorkspaceTopbar } from "../components/shell/WorkspaceTopbar";
import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";

function isSettingsTextEditingTarget(target: Element): boolean {
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLSelectElement) return !target.disabled;
  if (target instanceof HTMLInputElement) {
    if (target.readOnly || target.disabled) return false;
    return !["button", "submit", "checkbox", "radio", "file", "reset", "hidden"].includes(
      target.type,
    );
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

function shouldIgnoreSettingsEscape(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-keybinding-capture]")) return true;
  return Boolean(
    target.closest(
      "[role='dialog'], [role='menu'], [role='listbox'], [data-slot='dialog-popup'], [data-slot='menu-popup'], [data-slot='select-popup']",
    ),
  );
}

function RestoreDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);

  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={changedSettingLabels.length === 0}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="mx-1 size-3.5" />
      Restore defaults
    </Button>
  );
}

function SettingsContentLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const [restoreSignal, setRestoreSignal] = useState(0);
  const showRestoreDefaults =
    location.pathname === "/settings/general" || location.pathname === "/settings/skills";
  const handleRestored = () => setRestoreSignal((value) => value + 1);
  const navigateBackWithinApp = useCallback(() => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      if (shouldIgnoreSettingsEscape(event)) return;

      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && isSettingsTextEditingTarget(activeElement)) {
        event.preventDefault();
        activeElement.blur();
        return;
      }

      event.preventDefault();
      if (activeElement instanceof HTMLElement) {
        activeElement.blur();
      }
      navigateBackWithinApp();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navigateBackWithinApp]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspaceTopbar>
          <div className="flex w-full items-center gap-2">
            <SettingsBreadcrumb pathname={location.pathname} />
            {showRestoreDefaults ? (
              <div className="ms-auto flex items-center gap-2">
                <RestoreDefaultsButton onRestored={handleRestored} />
              </div>
            ) : null}
          </div>
        </WorkspaceTopbar>

        <div key={restoreSignal} className="min-h-0 flex flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </SidebarInset>
  );
}

function SettingsRouteLayout() {
  return <SettingsContentLayout />;
}

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }

    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsRouteLayout,
});

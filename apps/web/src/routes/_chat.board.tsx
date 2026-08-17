import { createFileRoute, redirect } from "@tanstack/react-router";

import { BoardView } from "../components/board/BoardView";
import { WorkspaceTopbar } from "../components/shell/WorkspaceTopbar";
import { SidebarInset } from "../components/ui/sidebar";

function BoardRouteView() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspaceTopbar className="flex items-center">
          <h1 className="text-sm font-medium text-foreground">Board</h1>
        </WorkspaceTopbar>
        <BoardView />
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/board")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: BoardRouteView,
});

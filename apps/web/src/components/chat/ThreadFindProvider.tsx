import { ThreadFindBarContext, ThreadFindTimelineContext } from "./threadFindContext";
import { use, useImperativeHandle, type ReactNode, type Ref } from "react";
import { useThreadFind } from "./useThreadFind";
import { ThreadFindBar } from "./ThreadFindBar";
import { MarkdownFindContext } from "./markdownFindContext";

type Find = ReturnType<typeof useThreadFind>;
export type ThreadFindControls = Pick<Find, "open" | "close"> & { isOpen: () => boolean };
/** Owns search updates below the chat view so cycling does not rerender the composer and panels. */
export function ThreadFindProvider({
  controlsRef,
  children,
  ...options
}: Parameters<typeof useThreadFind>[0] & {
  controlsRef: Ref<ThreadFindControls>;
  children: ReactNode;
}) {
  const find = useThreadFind(options);
  useImperativeHandle(
    controlsRef,
    () => ({ open: find.open, close: find.close, isOpen: () => find.isOpen }),
    [find.open, find.close, find.isOpen],
  );
  return (
    <ThreadFindBarContext value={find.barProps}>
      <ThreadFindTimelineContext value={find.timelineProps}>
        <MarkdownFindContext value={find.timelineProps.findExpanded}>
          {children}
        </MarkdownFindContext>
      </ThreadFindTimelineContext>
    </ThreadFindBarContext>
  );
}

export function ThreadFind({ onClose }: { onClose: () => void }) {
  const bar = use(ThreadFindBarContext);
  if (!bar) return null;
  return (
    <ThreadFindBar
      {...bar}
      onClose={() => {
        bar.onClose();
        onClose();
      }}
    />
  );
}

/** Keeps the live-edge affordance from competing with find navigation. */
export function HideDuringThreadFind({ children }: { children: ReactNode }) {
  const find = use(ThreadFindTimelineContext);
  return find?.findOpen ? null : <>{children}</>;
}

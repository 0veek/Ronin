/**
 * The digest: what changed since this device last looked.
 *
 * Three sections in the order the reader can act on them — blocked first,
 * because that is the only part nothing else will resolve; then what is still
 * running, so you know whether to wait; then what finished, which is news
 * rather than work.
 *
 * Reading the digest is what advances the mark. It is set when the dialog
 * closes rather than when it opens, so a digest glanced at and dismissed does
 * not silently discard the thing you meant to come back to.
 *
 * @module DigestDialog
 */
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { CheckCircle2Icon, CircleDotIcon, HandIcon } from "lucide-react";
import type { ReactNode } from "react";

import { formatWaitedLabel, summarizeDigest, type Digest, type DigestEntry } from "~/digest";

import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";

function DigestSection({
  entries,
  icon,
  onOpenThread,
  showWait,
  title,
}: {
  readonly entries: ReadonlyArray<DigestEntry>;
  readonly icon: ReactNode;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly showWait: boolean;
  readonly title: string;
}) {
  if (entries.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
        {icon}
        {title}
        <span className="tabular-nums">({entries.length})</span>
      </h3>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li key={`${entry.thread.environmentId}:${entry.thread.id}`}>
            <button
              type="button"
              className="flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
              onClick={() => onOpenThread(entry.thread)}
            >
              <span className="min-w-0 flex-1 truncate text-sm">{entry.thread.title}</span>
              {showWait ? (
                <span className="shrink-0 tabular-nums text-2xs text-muted-foreground">
                  {formatWaitedLabel(entry.waitedMs)}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DigestDialog({
  digest,
  onOpenChange,
  onOpenThread,
  open,
}: {
  readonly digest: Digest;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>Since you last looked</DialogTitle>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <p className="text-muted-foreground text-sm">{summarizeDigest(digest)}</p>
          {digest.isEmpty ? null : (
            <>
              <DigestSection
                entries={digest.needsYou}
                icon={<HandIcon aria-hidden className="size-3.5" />}
                onOpenThread={onOpenThread}
                showWait
                title="Waiting on you"
              />
              <DigestSection
                entries={digest.working}
                icon={<CircleDotIcon aria-hidden className="size-3.5" />}
                onOpenThread={onOpenThread}
                showWait={false}
                title="Still working"
              />
              <DigestSection
                entries={digest.finished}
                icon={<CheckCircle2Icon aria-hidden className="size-3.5" />}
                onOpenThread={onOpenThread}
                showWait={false}
                title="Finished"
              />
            </>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

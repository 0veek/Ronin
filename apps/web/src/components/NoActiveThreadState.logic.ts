import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import { sortThreads, type ThreadSortInput } from "../lib/threadSort";

/** How many threads the empty state offers to resume. Enough to cover "the one
    I was just in and the couple either side of it", short enough that the
    screen stays a landing pad rather than a second sidebar. */
export const RESUMABLE_THREAD_LIMIT = 3;

/**
 * The threads worth offering on a screen that exists because nothing is open.
 *
 * Archived threads are excluded for the same reason the sidebar hides them:
 * this list is "carry on where you left off", and an archived thread is
 * explicitly somewhere the user chose to stop. Ordering follows the user's own
 * sidebar preference so the shortlist reads in the order they already know.
 */
export function selectResumableThreads<
  TThread extends { readonly id: string; readonly archivedAt: unknown } & ThreadSortInput,
>(input: {
  readonly threads: ReadonlyArray<TThread>;
  readonly sortOrder: SidebarThreadSortOrder;
  readonly limit?: number;
}): TThread[] {
  return sortThreads(
    input.threads.filter((thread) => thread.archivedAt === null),
    input.sortOrder,
  ).slice(0, input.limit ?? RESUMABLE_THREAD_LIMIT);
}

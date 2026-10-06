import { OrchestrationThreadShell, type OrchestrationShellStreamItem } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

const sameThreadShell = Schema.toEquivalence(OrchestrationThreadShell);
const UNCHANGED_THREAD_SHELL_RESEND_MS = 5_000;

/** Keeps live shell payloads quiet while bounding the cursor's replay gap to five seconds. */
export function skipUnchangedThreadShells<A extends OrchestrationShellStreamItem, E, R>(
  stream: Stream.Stream<A, E, R>,
): Stream.Stream<A, E, R> {
  return Stream.suspend(() => {
    const lastSent = new Map<
      OrchestrationThreadShell["id"],
      { readonly thread: OrchestrationThreadShell; readonly sentAt: number }
    >();
    return stream.pipe(
      Stream.filterEffect((item) =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          if (item.kind === "thread-removed") {
            lastSent.delete(item.threadId);
            return true;
          }
          if (item.kind !== "thread-upserted") return true;
          const previous = lastSent.get(item.thread.id);
          if (
            previous !== undefined &&
            now - previous.sentAt < UNCHANGED_THREAD_SHELL_RESEND_MS &&
            sameThreadShell(
              { ...item.thread, updatedAt: previous.thread.updatedAt },
              previous.thread,
            )
          )
            return false;
          lastSent.set(item.thread.id, { thread: item.thread, sentAt: now });
          return true;
        }),
      ),
    );
  });
}

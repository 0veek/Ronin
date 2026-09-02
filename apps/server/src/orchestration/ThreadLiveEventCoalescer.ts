/**
 * Live tool-update coalescing for a thread's event stream.
 *
 * A running tool emits an update per output chunk. Every one of those becomes a
 * socket frame the client folds away on arrival, so the wire carries roughly ten
 * frames for every row the user sees. Retaining only the newest update per
 * in-flight tool call inside a batching window keeps the row current and drops
 * the rest.
 *
 * The window itself lives in `ws.ts`, which already batches the shell stream the
 * same way; this module is the pure reducer that batch runs through.
 *
 * @module ThreadLiveEventCoalescer
 */
import type { OrchestrationEvent } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";

export function isToolUpdatedEvent(event: OrchestrationEvent): boolean {
  return (
    event.type === "thread.activity-appended" && event.payload.activity.kind === "tool.updated"
  );
}

function asTrimmedString(value: unknown): string | null {
  if (!Predicate.isString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stableToolCallIdentity(event: OrchestrationEvent): string | null {
  if (event.type !== "thread.activity-appended") {
    return null;
  }
  const payload = event.payload.activity.payload;
  if (!Predicate.isObject(payload)) {
    return null;
  }
  const data = Predicate.isObject(payload.data) ? payload.data : null;
  return asTrimmedString(payload.toolCallId) ?? asTrimmedString(data?.toolCallId);
}

/**
 * Retain only the latest in-flight update for each stable tool-call id in a
 * live run. Anonymous calls pass through because labels are not unique when
 * tools execute in parallel. Survivors remain in sequence order.
 */
export function coalesceLiveToolUpdatedEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): ReadonlyArray<OrchestrationEvent> {
  const survivors: Array<OrchestrationEvent> = [];
  let pendingUpdates: Array<OrchestrationEvent> = [];

  const flushUpdates = () => {
    const seen = new Set<string>();
    const latestUpdates: Array<OrchestrationEvent> = [];
    for (let index = pendingUpdates.length - 1; index >= 0; index -= 1) {
      const event = pendingUpdates[index]!;
      const identity = stableToolCallIdentity(event);
      const activity =
        event.type === "thread.activity-appended" ? event.payload.activity : undefined;
      const key = identity ? `${activity?.turnId ?? ""}\u0000${identity}` : null;
      if (key && seen.has(key)) {
        continue;
      }
      if (key) {
        seen.add(key);
      }
      latestUpdates.push(event);
    }
    latestUpdates.reverse();
    survivors.push(...latestUpdates);
    pendingUpdates = [];
  };

  for (const event of events) {
    if (isToolUpdatedEvent(event)) {
      pendingUpdates.push(event);
      continue;
    }
    flushUpdates();
    survivors.push(event);
  }
  flushUpdates();
  return survivors;
}

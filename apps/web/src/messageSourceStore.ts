/**
 * Which assistant messages are showing their markdown source instead of the rendered answer.
 *
 * It lives outside the row because the timeline is virtualized: a row that scrolls out unmounts,
 * and local state would silently snap the message back to rendered on the way in. Deliberately not
 * persisted -- this is a look at one answer, not a preference.
 */

import type { MessageId } from "@t3tools/contracts";
import { create } from "zustand";

interface MessageSourceStoreState {
  readonly sourceMessageIds: ReadonlySet<MessageId>;
  readonly toggleMessageSource: (messageId: MessageId) => void;
}

export const useMessageSourceStore = create<MessageSourceStoreState>()((set) => ({
  sourceMessageIds: new Set<MessageId>(),
  toggleMessageSource: (messageId) =>
    set((state) => {
      const next = new Set(state.sourceMessageIds);
      if (!next.delete(messageId)) next.add(messageId);
      return { sourceMessageIds: next };
    }),
}));

export function selectShowsMessageSource(
  state: MessageSourceStoreState,
  messageId: MessageId,
): boolean {
  return state.sourceMessageIds.has(messageId);
}

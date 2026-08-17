import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { BoardLaneKey } from "./components/board/board.logic";
import { resolveStorage } from "./lib/storage";

/**
 * Board chrome the user arranges and expects to find again: which project the
 * board is scoped to, which lanes are collapsed, and the Draft lane's manual
 * card order (the one lane with no server-side ordering to inherit).
 *
 * Nothing here is thread lifecycle state — that all lives on the server and
 * arrives through the shell snapshot. This store only remembers how the board
 * was left looking.
 */
interface BoardUiStoreState {
  /** Sidebar-style project scope key; null means "All projects". */
  scopeKey: string | null;
  setScopeKey: (scopeKey: string | null) => void;
  collapsedLanes: Partial<Record<BoardLaneKey, boolean>>;
  toggleLaneCollapsed: (lane: BoardLaneKey) => void;
  /** Manual Draft-lane card order, per project scope key ("all" when unscoped). */
  draftOrderByScopeKey: Record<string, string[]>;
  setDraftOrder: (scopeKey: string, order: readonly string[]) => void;
  /** Drops orders for scopes that no longer exist, so the payload can't grow forever. */
  pruneDraftOrders: (knownScopeKeys: ReadonlySet<string>) => void;
}

// Stale card ids are harmless — ordering ignores ids it doesn't recognise —
// but the persisted payload shares a ~5MB origin-wide quota, so it is capped.
const MAX_DRAFT_ORDER_LENGTH = 200;

function sanitizeOrder(order: readonly string[]): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];
  for (const cardId of order) {
    if (typeof cardId !== "string" || cardId.length === 0 || seen.has(cardId)) continue;
    seen.add(cardId);
    sanitized.push(cardId);
    if (sanitized.length >= MAX_DRAFT_ORDER_LENGTH) break;
  }
  return sanitized;
}

export const BOARD_UI_STORAGE_KEY = "t3code:board-ui:v1";

export const useBoardUiStore = create<BoardUiStoreState>()(
  persist(
    (set) => ({
      scopeKey: null,
      setScopeKey: (scopeKey) => set({ scopeKey }),
      collapsedLanes: {},
      toggleLaneCollapsed: (lane) =>
        set((state) => ({
          collapsedLanes: { ...state.collapsedLanes, [lane]: !state.collapsedLanes[lane] },
        })),
      draftOrderByScopeKey: {},
      setDraftOrder: (scopeKey, order) =>
        set((state) => {
          const sanitized = sanitizeOrder(order);
          const current = state.draftOrderByScopeKey[scopeKey];
          // Identical order: return the same state so subscribers don't rerender.
          if (
            current &&
            current.length === sanitized.length &&
            current.every((cardId, index) => cardId === sanitized[index])
          ) {
            return state;
          }
          return {
            draftOrderByScopeKey: { ...state.draftOrderByScopeKey, [scopeKey]: sanitized },
          };
        }),
      pruneDraftOrders: (knownScopeKeys) =>
        set((state) => {
          const next: Record<string, string[]> = {};
          let changed = false;
          for (const [scopeKey, order] of Object.entries(state.draftOrderByScopeKey)) {
            if (knownScopeKeys.has(scopeKey)) next[scopeKey] = order;
            else changed = true;
          }
          return changed ? { draftOrderByScopeKey: next } : state;
        }),
    }),
    {
      name: BOARD_UI_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        scopeKey: state.scopeKey,
        collapsedLanes: state.collapsedLanes,
        draftOrderByScopeKey: state.draftOrderByScopeKey,
      }),
    },
  ),
);

/** The scope key a draft order is filed under; "all" stands in for unscoped. */
export function boardDraftOrderScopeKey(scopeKey: string | null): string {
  return scopeKey ?? "all";
}

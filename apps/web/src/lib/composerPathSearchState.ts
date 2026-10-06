import {
  type ComposerPathSearchState,
  type ComposerPathSearchTarget,
} from "@t3tools/client-runtime/state/threads";

import { useComposerPathSearch as useComposerPathSearchQuery } from "../state/queries";
import { useMemo } from "react";

export function useComposerPathSearch(target: ComposerPathSearchTarget): ComposerPathSearchState {
  const state = useComposerPathSearchQuery(target);
  const entries = useMemo(
    () => state.entries.map((entry) => ({ path: entry.path, kind: entry.kind })),
    [state.entries],
  );
  return {
    entries,
    error: state.error,
    isPending: state.isPending,
  };
}

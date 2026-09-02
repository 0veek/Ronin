import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { primaryServerConfigAtom } from "~/state/server";

import { filterAvailableSettingsSearchItems } from "./settingsSearch";

/**
 * The searchable catalog narrowed to the rows this environment actually
 * renders. A result that scrolls to an anchor nothing mounted reads as a bug,
 * so conditional settings are filtered out before the search runs.
 */
export function useAvailableSettingsSearchItems() {
  const primaryServerConfig = useAtomValue(primaryServerConfigAtom);

  return useMemo(
    () =>
      filterAvailableSettingsSearchItems({
        hasThreadAutoSettlement:
          primaryServerConfig?.environment.capabilities.threadAutoSettlement === true,
      }),
    [primaryServerConfig],
  );
}

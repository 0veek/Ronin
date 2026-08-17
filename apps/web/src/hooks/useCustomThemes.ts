import { useSyncExternalStore } from "react";

import { EMPTY_CUSTOM_THEMES, getCustomThemes, subscribeToCustomThemes } from "../themePalette";

export function useCustomThemes() {
  return useSyncExternalStore(subscribeToCustomThemes, getCustomThemes, () => EMPTY_CUSTOM_THEMES);
}

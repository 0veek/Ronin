import { createContext } from "react";
import type { useThreadFind } from "./useThreadFind";
type Find = ReturnType<typeof useThreadFind>;
export const ThreadFindTimelineContext = createContext<Find["timelineProps"] | null>(null);
export const ThreadFindBarContext = createContext<Find["barProps"] | null>(null);

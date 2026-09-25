import { useAtomMount } from "@effect/atom-react";

import { runningThreadKeepAliveAtom } from "../../state/threads";

/** Keeps running desktop threads subscribed without re-rendering on their updates. */
export function RunningThreadKeepAlive() {
  useAtomMount(runningThreadKeepAliveAtom);
  return null;
}

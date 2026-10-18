import type { EnvironmentId } from "@t3tools/contracts";
import { createContext } from "react";

/** Where the guide's prose renders from: the pull request's environment and checkout. */
export const GuideProseContext = createContext<{
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
} | null>(null);

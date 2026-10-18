import { createMcpAppEnvironmentAtoms } from "@t3tools/client-runtime/state/mcpApps";
import { connectionAtomRuntime } from "../connection/runtime";

export const mcpAppEnvironment = createMcpAppEnvironmentAtoms(connectionAtomRuntime);

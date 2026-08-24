import type { ProviderInstanceEnvironment } from "@t3tools/contracts";

/**
 * Builds the environment one provider instance runs under.
 *
 * Always a copy, even when the instance overrides nothing: returning `baseEnv`
 * itself hands every caller a live reference to `process.env`, so anything that
 * mutated what it thought was its own environment would change the server's and
 * every other instance's along with it.
 */
export function mergeProviderInstanceEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const variable of environment ?? []) {
    next[variable.name] = variable.value;
  }
  return next;
}

import type { ProviderInstanceEnvironment } from "@t3tools/contracts";

/**
 * Builds the environment one provider instance runs under.
 *
 * An instance with no overrides gets `baseEnv` itself rather than a copy. Every
 * driver calls this while being created, and spreading `process.env` — where
 * each read crosses into the host — is real work to repeat nine times per
 * reconcile for a result nobody writes to. Callers treat the value as
 * read-only; one that needs to mutate should copy at its own call site.
 */
export function mergeProviderInstanceEnvironment(
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!environment || environment.length === 0) {
    return baseEnv;
  }

  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const variable of environment) {
    next[variable.name] = variable.value;
  }
  return next;
}

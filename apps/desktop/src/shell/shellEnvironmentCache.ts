/**
 * Last known-good login-shell environment, remembered across launches.
 *
 * The probe that produces it spawns the user's login shell and waits up to five
 * seconds for it to finish sourcing rc files. That happens before Electron is
 * ready, so on a machine with a heavy shell profile -- nvm, conda, rbenv, a
 * corporate rc -- the window does not exist yet and the user is looking at
 * nothing.
 *
 * Caching turns that into a first-launch-only cost. A later launch applies the
 * remembered values immediately and re-probes in the background, so the answer
 * stays fresh without anybody waiting for it.
 *
 * @module shellEnvironmentCache
 */

/**
 * Bumped when the meaning of a cached entry changes, so an older file is
 * ignored rather than misread. Rejecting an unknown version costs one slow
 * launch; trusting it could hand Electron the wrong password store.
 */
export const SHELL_ENVIRONMENT_CACHE_VERSION = 1 as const;

export interface ShellEnvironmentCache {
  readonly version: number;
  /** Milliseconds since the epoch, for staleness reporting only. */
  readonly capturedAt: number;
  /** The probed platform. A cache from another OS means nothing. */
  readonly platform: string;
  /** Login shell the values came from; a different shell invalidates them. */
  readonly shell: string | null;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Values worth remembering.
 *
 * Only what the probe itself sets, and only strings: an entry that arrives as
 * anything else is dropped rather than coerced, because these end up in
 * `process.env` where a stringified object would be worse than a gap.
 */
export function selectCacheableEnv(
  env: Readonly<Record<string, unknown>>,
  names: ReadonlyArray<string>,
): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const name of names) {
    const value = env[name];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    selected[name] = trimmed;
  }
  return selected;
}

/**
 * Whether a decoded cache may be applied to this process.
 *
 * A cache from a different platform or a different login shell describes an
 * environment this launch is not in, and an empty one has nothing to say.
 */
export function isApplicableCache(
  cache: ShellEnvironmentCache,
  input: { readonly platform: string; readonly shell: string | null },
): boolean {
  if (cache.version !== SHELL_ENVIRONMENT_CACHE_VERSION) return false;
  if (cache.platform !== input.platform) return false;
  if (cache.shell !== input.shell) return false;
  return Object.keys(cache.env).length > 0;
}

/**
 * Parses a cache file.
 *
 * Every failure mode -- unreadable, not JSON, wrong shape -- resolves to null.
 * A corrupt cache should cost a slow launch, never a crash on startup.
 */
export function parseShellEnvironmentCache(raw: string): ShellEnvironmentCache | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record["version"] !== SHELL_ENVIRONMENT_CACHE_VERSION) return null;
  if (typeof record["platform"] !== "string") return null;

  const env = record["env"];
  if (typeof env !== "object" || env === null) return null;

  const shell = record["shell"];
  const capturedAt = record["capturedAt"];

  return {
    version: SHELL_ENVIRONMENT_CACHE_VERSION,
    capturedAt: typeof capturedAt === "number" && Number.isFinite(capturedAt) ? capturedAt : 0,
    platform: record["platform"],
    shell: typeof shell === "string" ? shell : null,
    // Re-selected rather than trusted: the file is user-writable, and these
    // values are about to become process.env for every child we spawn.
    env: selectCacheableEnv(env as Record<string, unknown>, Object.keys(env)),
  };
}

export function serializeShellEnvironmentCache(cache: ShellEnvironmentCache): string {
  return `${JSON.stringify(cache, null, 2)}\n`;
}

/**
 * Applies cached values to an environment, filling gaps only.
 *
 * Same rule the live probe follows: a variable the real environment already
 * carries is authoritative, because it came from the actual session rather than
 * from a shell started to imitate one. Returns the names it filled.
 */
export function applyCachedEnv(
  target: Record<string, string | undefined>,
  cached: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  const applied: string[] = [];
  for (const [name, value] of Object.entries(cached)) {
    const existing = target[name];
    if (typeof existing === "string" && existing.trim().length > 0) continue;
    target[name] = value;
    applied.push(name);
  }
  return applied;
}

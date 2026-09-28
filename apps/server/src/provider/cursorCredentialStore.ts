import * as NodeModule from "node:module";

const CACHE_MS = 5 * 60_000;

const requireForKeyring = NodeModule.createRequire(import.meta.url);

export class CursorKeychainTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for Keychain access.");
  }
}

/** Share one Keychain request across usage history and limits in this server process. */
export function makeCachedCursorAccessTokenReader(
  read: () => Promise<string | null>,
  now: () => number = Date.now,
  timeoutMs = 30_000,
): () => Promise<string | null> {
  let cached: { token: string; until: number } | null = null;
  let pending: Promise<string | null> | null = null;
  return () => {
    if (cached && cached.until > now()) return Promise.resolve(cached.token);
    pending ??= read()
      .then((token) => {
        cached = token ? { token, until: now() + CACHE_MS } : null;
        return token;
      })
      .finally(() => {
        pending = null;
      });
    const deadline = AbortSignal.timeout(timeoutMs);
    return Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        deadline.addEventListener("abort", () => reject(new CursorKeychainTimeoutError()), {
          once: true,
        });
      }),
    ]);
  };
}

/** Read the Cursor CLI's default macOS credential without invoking the shared security binary. */
export const readMacCursorAccessToken = makeCachedCursorAccessTokenReader(async () => {
  const { AsyncEntry } = requireForKeyring("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
  return (await new AsyncEntry("cursor-access-token", "cursor-user").getPassword()) ?? null;
});

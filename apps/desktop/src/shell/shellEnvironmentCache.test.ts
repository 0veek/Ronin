import { describe, expect, it } from "vite-plus/test";

import {
  applyCachedEnv,
  isApplicableCache,
  parseShellEnvironmentCache,
  selectCacheableEnv,
  serializeShellEnvironmentCache,
  SHELL_ENVIRONMENT_CACHE_VERSION,
  type ShellEnvironmentCache,
} from "./shellEnvironmentCache.ts";

function cache(overrides: Partial<ShellEnvironmentCache> = {}): ShellEnvironmentCache {
  return {
    version: SHELL_ENVIRONMENT_CACHE_VERSION,
    capturedAt: 1_770_000_000_000,
    platform: "linux",
    shell: "/bin/zsh",
    env: { PATH: "/opt/homebrew/bin:/usr/bin" },
    ...overrides,
  };
}

describe("selectCacheableEnv", () => {
  it("keeps only non-empty strings", () => {
    // These become process.env for every child process we spawn, so a
    // stringified object or a blank would be worse than the gap it fills.
    const selected = selectCacheableEnv(
      { PATH: " /usr/bin ", EMPTY: "   ", NUMBER: 42, MISSING: undefined },
      ["PATH", "EMPTY", "NUMBER", "MISSING", "ABSENT"],
    );

    expect(selected).toEqual({ PATH: "/usr/bin" });
  });
});

describe("isApplicableCache", () => {
  it("accepts a cache from the same platform and shell", () => {
    expect(isApplicableCache(cache(), { platform: "linux", shell: "/bin/zsh" })).toBe(true);
  });

  it("rejects a cache captured under a different shell", () => {
    // Switching from zsh to fish changes PATH wholesale; carrying the old
    // answer forward would point at tools the new shell never sets up.
    expect(isApplicableCache(cache(), { platform: "linux", shell: "/usr/bin/fish" })).toBe(false);
  });

  it("rejects a cache from another platform or another version", () => {
    expect(isApplicableCache(cache(), { platform: "darwin", shell: "/bin/zsh" })).toBe(false);
    expect(
      isApplicableCache(cache({ version: 99 }), { platform: "linux", shell: "/bin/zsh" }),
    ).toBe(false);
  });

  it("rejects a cache with nothing in it", () => {
    expect(isApplicableCache(cache({ env: {} }), { platform: "linux", shell: "/bin/zsh" })).toBe(
      false,
    );
  });
});

describe("parseShellEnvironmentCache", () => {
  it("round-trips a cache it wrote", () => {
    const parsed = parseShellEnvironmentCache(serializeShellEnvironmentCache(cache()));

    expect(parsed).toEqual(cache());
  });

  it("returns null for anything it cannot trust", () => {
    // A corrupt cache should cost one slow launch, never a crash before the
    // window exists.
    expect(parseShellEnvironmentCache("not json")).toBeNull();
    expect(parseShellEnvironmentCache("null")).toBeNull();
    expect(parseShellEnvironmentCache('{"version":99}')).toBeNull();
    expect(parseShellEnvironmentCache('{"version":1,"platform":"linux"}')).toBeNull();
  });

  it("re-filters the stored env rather than trusting the file", () => {
    // The file sits in the user's home and is theirs to edit; these values are
    // about to become process.env.
    const parsed = parseShellEnvironmentCache(
      JSON.stringify({
        version: SHELL_ENVIRONMENT_CACHE_VERSION,
        capturedAt: 1,
        platform: "linux",
        shell: null,
        env: { PATH: "/usr/bin", HOSTILE: { toString: "nope" }, BLANK: "" },
      }),
    );

    expect(parsed?.env).toEqual({ PATH: "/usr/bin" });
  });
});

describe("applyCachedEnv", () => {
  it("fills gaps and leaves the live environment alone", () => {
    // A variable the process already has came from the real session; the cache
    // came from a shell started to imitate one, so the live value wins.
    const target: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      XDG_CURRENT_DESKTOP: "",
    };

    const applied = applyCachedEnv(target, {
      PATH: "/cached/bin",
      XDG_CURRENT_DESKTOP: "GNOME",
      SSH_AUTH_SOCK: "/run/keyring/ssh",
    });

    expect(target.PATH).toBe("/usr/bin");
    expect(target.XDG_CURRENT_DESKTOP).toBe("GNOME");
    expect(target.SSH_AUTH_SOCK).toBe("/run/keyring/ssh");
    expect([...applied].sort()).toEqual(["SSH_AUTH_SOCK", "XDG_CURRENT_DESKTOP"]);
  });
});

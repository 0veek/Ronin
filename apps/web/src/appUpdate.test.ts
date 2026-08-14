import { describe, expect, it, vi } from "vite-plus/test";

import { APP_LATEST_RELEASE_API_URL } from "./branding";
import { fetchLatestAppRelease, isAppUpdateAvailable, parseLatestAppRelease } from "./appUpdate";

const releasePayload = {
  tag_name: "v0.6.6",
  html_url: "https://github.com/0veek/Ronin/releases/tag/v0.6.6",
  draft: false,
  prerelease: false,
};

describe("app update releases", () => {
  it("reads the version and page from GitHub's latest stable release", () => {
    expect(parseLatestAppRelease(releasePayload)).toEqual({
      version: "0.6.6",
      url: "https://github.com/0veek/Ronin/releases/tag/v0.6.6",
    });
  });

  it("rejects drafts, prereleases, malformed versions, and non-Ronin links", () => {
    expect(parseLatestAppRelease({ ...releasePayload, draft: true })).toBeNull();
    expect(parseLatestAppRelease({ ...releasePayload, prerelease: true })).toBeNull();
    expect(parseLatestAppRelease({ ...releasePayload, tag_name: "latest" })).toBeNull();
    expect(
      parseLatestAppRelease({ ...releasePayload, html_url: "https://example.com/release" }),
    ).toBeNull();
  });

  it("only reports versions newer than the running app", () => {
    const latestRelease = parseLatestAppRelease(releasePayload)!;

    expect(isAppUpdateAvailable("0.6.5", latestRelease)).toBe(true);
    expect(isAppUpdateAvailable("0.6.6", latestRelease)).toBe(false);
    expect(isAppUpdateAvailable("0.7.0", latestRelease)).toBe(false);
    expect(isAppUpdateAvailable("development", latestRelease)).toBe(false);
  });

  it("fetches only release metadata from GitHub", async () => {
    const fetcher = vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(releasePayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(fetchLatestAppRelease(fetcher)).resolves.toEqual({
      version: "0.6.6",
      url: "https://github.com/0veek/Ronin/releases/tag/v0.6.6",
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(APP_LATEST_RELEASE_API_URL, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
    });
  });
});

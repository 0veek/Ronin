import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";

import { APP_LATEST_RELEASE_API_URL, APP_REPOSITORY_URL } from "./branding";

export interface AppRelease {
  readonly version: string;
  readonly url: string;
}

export type AppUpdateState =
  | { readonly status: "unavailable" }
  | { readonly status: "checking" }
  | { readonly status: "up-to-date"; readonly latestRelease: AppRelease }
  | { readonly status: "available"; readonly latestRelease: AppRelease }
  | { readonly status: "error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRoninReleaseUrl(value: string): boolean {
  try {
    const repositoryUrl = new URL(APP_REPOSITORY_URL);
    const releaseUrl = new URL(value);
    return (
      releaseUrl.protocol === "https:" &&
      releaseUrl.origin === repositoryUrl.origin &&
      releaseUrl.pathname
        .toLowerCase()
        .startsWith(`${repositoryUrl.pathname.toLowerCase()}/releases/tag/`)
    );
  } catch {
    return false;
  }
}

/** The small, trusted part of GitHub's release payload that the client needs. */
export function parseLatestAppRelease(value: unknown): AppRelease | null {
  if (!isRecord(value) || value.draft === true || value.prerelease === true) {
    return null;
  }

  const rawTag = typeof value.tag_name === "string" ? value.tag_name.trim() : "";
  const version = rawTag.replace(/^v/, "");
  const url = typeof value.html_url === "string" ? value.html_url.trim() : "";
  if (!parseSemver(version) || !isRoninReleaseUrl(url)) {
    return null;
  }

  return { version, url };
}

export function isAppUpdateAvailable(currentVersion: string, latestRelease: AppRelease): boolean {
  if (!parseSemver(currentVersion)) {
    return false;
  }
  return compareSemverVersions(latestRelease.version, currentVersion) > 0;
}

export async function fetchLatestAppRelease(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<AppRelease> {
  const response = await fetcher(APP_LATEST_RELEASE_API_URL, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub release check failed with status ${response.status}.`);
  }

  const release = parseLatestAppRelease(await response.json());
  if (!release) {
    throw new Error("GitHub returned an invalid release.");
  }
  return release;
}

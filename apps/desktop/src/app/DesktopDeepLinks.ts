import { DESKTOP_HOST } from "../electron/ElectronProtocol.ts";

export function parseDesktopAppUrl(rawUrl: string, scheme: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${scheme}:` || parsed.host !== DESKTOP_HOST) {
    return null;
  }

  return parsed;
}

export function findDesktopProtocolUrl(argv: ReadonlyArray<string>, scheme: string): string | null {
  for (const argument of argv) {
    const parsed = parseDesktopAppUrl(argument, scheme);
    if (parsed) {
      return parsed.href;
    }
  }
  return null;
}
